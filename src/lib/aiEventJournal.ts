/**
 * A bounded, ordered event journal with acknowledged cursors.
 *
 * `docs/LOCAL_AI_BACKGROUND_WORKER.md` section 4.1: "Each AI review receives an
 * inclusive start cursor and returns an acknowledged end cursor. Events remain
 * available until acknowledgment. On timeout, crash, or cancellation, the
 * cursor is not advanced."
 *
 * # Why this is not gameLink's buffer
 *
 * `gameLink.ts` already holds the live line buffer, and it is the right shape
 * for what it does: a 20,000-line ring for a text pane, which drops its oldest
 * lines when full and counts them in `dropped`. A display can lose the top of
 * the scrollback and still be correct.
 *
 * A delivery guarantee cannot. This journal is a different responsibility over
 * the same capture path - it is fed *from* the established stream owner rather
 * than tapping the socket a second time, so there is still exactly one place
 * where game text becomes events.
 *
 * # What "no loss" actually means here
 *
 * Reading does not consume. `readFrom` is a pure query; only `acknowledge`
 * moves the committed cursor, and only a consumer that finished its work
 * should call it. A worker that times out, is cancelled, or dies between the
 * two simply reads the same events again on its next attempt.
 *
 * Retention is bounded, because an unbounded journal is a memory leak with a
 * schedule. But when the bound forces a drop, that is *reported* rather than
 * silent: `pendingLoss` names how many acknowledged-but-unread events were
 * discarded, and it is a fact a caller can act on. A journal that quietly ate
 * events under load would be indistinguishable from one that was working.
 */

/** Monotonic, stable, never reused within a session. `0` is "before the first
 * event", which is why sequence numbers start at 1: a cursor of 0 is a
 * meaningful "nothing acknowledged yet" rather than an ambiguous default. */
export type Cursor = number

export const BEFORE_FIRST_EVENT: Cursor = 0

/**
 * One normalized thing that happened. Deliberately not a game line: the
 * journal carries whatever the established parser already decided, so this
 * layer never re-interprets game text.
 */
export interface JournalEvent {
  /** Stable sequence id. Strictly increasing, no gaps within a session. */
  seq: number
  /** Milliseconds since epoch, supplied by the caller so tests are
   * deterministic and so a replayed event keeps its original time. */
  at: number
  /** What kind of thing this is, in the vocabulary the caller already uses. */
  kind: string
  /** Already-normalized payload. Opaque here on purpose - this module must not
   * grow a second opinion about what game text means. */
  payload: unknown
}

export interface JournalRead {
  /** Events strictly after the requested cursor, in order. */
  events: JournalEvent[]
  /**
   * The cursor a consumer should acknowledge *if* it successfully consumed
   * every event in `events`. Returned rather than inferred so a caller cannot
   * acknowledge more than it actually read.
   */
  nextCursor: Cursor
  /**
   * Events that were dropped by the retention bound before this read could
   * see them. Non-zero means real loss and the caller has an incomplete
   * picture - it must not be treated as zero.
   */
  lost: number
}

export interface JournalStats {
  appended: number
  retained: number
  acknowledged: Cursor
  /** Total events discarded by the bound before being read. */
  lost: number
  oldestRetained: Cursor
  newestAppended: Cursor
}

export interface JournalOptions {
  /** How many events to retain. The journal is bounded on purpose. */
  capacity?: number
}

/** Enough to hold several minutes of busy combat at the ~5s review cadence the
 * architecture targets, while staying far below `gameLink`'s 20,000-line
 * display ring. Retention here is measured in *unreviewed* events, which is a
 * much smaller number than lines on screen. */
export const DEFAULT_CAPACITY = 5000

/**
 * A journal instance. Constructed rather than module-global so tests get a
 * clean one per case and so a future second consumer cannot silently share
 * one consumer's cursor.
 */
export class EventJournal {
  private events: JournalEvent[] = []
  private nextSeq = 1
  private committed: Cursor = BEFORE_FIRST_EVENT
  private appendedCount = 0
  private lostCount = 0
  private readonly capacity: number

  constructor(options: JournalOptions = {}) {
    const capacity = options.capacity ?? DEFAULT_CAPACITY
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`Journal capacity must be a positive integer, got ${capacity}`)
    }
    this.capacity = capacity
  }

  /**
   * Record an event. Never blocked by a busy consumer - capture continues
   * while the worker is occupied, which is the whole point of journaling
   * rather than polling.
   */
  append(kind: string, payload: unknown, at: number): JournalEvent {
    const event: JournalEvent = { seq: this.nextSeq++, at, kind, payload }
    this.events.push(event)
    this.appendedCount += 1

    if (this.events.length > this.capacity) {
      const overflow = this.events.splice(0, this.events.length - this.capacity)
      // Only count events the consumer had not yet acknowledged. Discarding
      // something already consumed is ordinary retention, not loss, and
      // conflating the two would cry wolf on every long session.
      const unread = overflow.filter((e) => e.seq > this.committed).length
      this.lostCount += unread
    }
    return event
  }

  /**
   * Events after `cursor`, in order. A pure query: calling it twice returns
   * the same events, and calling it never advances anything.
   */
  readFrom(cursor: Cursor, limit = Number.MAX_SAFE_INTEGER): JournalRead {
    if (!Number.isFinite(cursor) || cursor < 0) {
      throw new Error(`Cursor must be a non-negative number, got ${cursor}`)
    }
    const after = this.events.filter((e) => e.seq > cursor)
    const events = limit === Number.MAX_SAFE_INTEGER ? after : after.slice(0, Math.max(0, limit))

    // Loss is reported relative to what this cursor asked for: if the oldest
    // event still retained is newer than cursor+1, the gap between them is
    // gone and this reader will never see it.
    const oldest = this.events.length > 0 ? this.events[0].seq : this.nextSeq
    const lost = cursor + 1 < oldest ? oldest - (cursor + 1) : 0

    return {
      events,
      // The cursor of the last event actually handed over - never further.
      nextCursor: events.length > 0 ? events[events.length - 1].seq : cursor,
      lost,
    }
  }

  /**
   * Commit consumption up to and including `cursor`.
   *
   * Refuses to move backwards, and refuses to move past what has actually been
   * appended. Both would be a consumer claiming to have handled events that
   * either it already released or that do not exist, and a journal that
   * accepted either would report progress it cannot support.
   */
  acknowledge(cursor: Cursor): Cursor {
    if (!Number.isFinite(cursor) || cursor < 0) {
      throw new Error(`Cursor must be a non-negative number, got ${cursor}`)
    }
    if (cursor > this.nextSeq - 1) {
      throw new Error(
        `Cannot acknowledge ${cursor}: only ${this.nextSeq - 1} events have been appended.`
      )
    }
    // Backwards is a no-op rather than an error: a retried consumer honestly
    // re-acknowledging an older cursor is not a bug, it just makes no progress.
    if (cursor > this.committed) this.committed = cursor
    return this.committed
  }

  /** The last successfully consumed cursor. Survives failed reads untouched. */
  acknowledged(): Cursor {
    return this.committed
  }

  /** How many appended events have not yet been acknowledged. */
  pending(): number {
    return this.nextSeq - 1 - this.committed
  }

  stats(): JournalStats {
    return {
      appended: this.appendedCount,
      retained: this.events.length,
      acknowledged: this.committed,
      lost: this.lostCount,
      oldestRetained: this.events.length > 0 ? this.events[0].seq : BEFORE_FIRST_EVENT,
      newestAppended: this.nextSeq - 1,
    }
  }
}
