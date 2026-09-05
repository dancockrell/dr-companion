/**
 * Evidence that outlives the journal it was read from.
 *
 * A claim's `evidenceRefs` are `event:<seq>` strings and the journal retains
 * 5,000 events (`aiEventJournal.ts`, `DEFAULT_CAPACITY`). A busy hour of
 * combat is more than that, so a candidate claim reviewed later in the evening
 * can cite evidence nobody can read any more. The reference resolves to
 * nothing, the reviewer sees "3 events" and cannot open one, and a claim whose
 * provenance cannot be re-derived is a claim that has to be thrown away.
 *
 * `docs/LOCAL_AI_BACKGROUND_WORKER.md` section 16 states it from the tool
 * side: "a reference that dangles after journal eviction is a claim whose
 * provenance cannot be re-derived, so evidence has to outlive the journal or
 * the reference must not be issued." This module is the first half of that
 * choice. `observations.read(refs)` presumes durable observations; here they
 * become durable at the moment something cites them.
 *
 * # Why pinning happens at citation and not at capture
 *
 * Copying every event into a second store would be the journal again, twice
 * the size, with the same bound and the same eventual loss. What actually
 * needs to survive is the small subset something has pointed at: a job's
 * `inputRefs`, a claim's `evidenceRefs`. Those are a handful of events per
 * record, and they are exactly the ones a reviewer will want an hour later.
 *
 * # Three states, not two
 *
 * `resolve` returns what it found *and* what it could not, and a caller gets
 * both. A partial answer that looks complete is the failure this whole file
 * exists to prevent: a claim citing four events and shown two of them, with
 * nothing saying the other two are gone, is worse than one that refuses to
 * render. `missing` is never empty-by-omission.
 *
 * # Eviction cannot drop evidence something is standing on
 *
 * The store is bounded, because an unbounded one is a memory leak with a
 * schedule. But the bound evicts the oldest **uncited** entry, and an entry a
 * live claim or job still cites is never evicted. When everything retained is
 * cited and the bound is reached, the store goes over capacity and *says so*
 * in `stats().overCapacity` rather than quietly discarding the provenance of
 * a record that is still on file.
 */
import { readJSON, writeJSON } from './storage.ts'

/** The reference vocabulary claims and jobs already use. One prefix, one
 * numeric sequence, and nothing else parsed here - a ref this module cannot
 * read is reported as missing rather than guessed at. */
const EVENT_REF = /^event:(\d+)$/

export function eventRef(seq: number): string {
  return `event:${seq}`
}

/** The sequence a ref names, or null when the string is not an event ref at
 * all. Null and "the journal no longer has it" are deliberately different
 * facts, and both end up in `missing` with the ref itself as the evidence of
 * which one happened. */
export function refSeq(ref: string): number | null {
  const match = EVENT_REF.exec(ref)
  return match ? Number.parseInt(match[1], 10) : null
}

/**
 * One journal event, copied.
 *
 * The four fields `JournalEvent` carries plus when it was pinned. `payload` is
 * whatever the journal held: this module does not interpret game text any more
 * than the journal does.
 */
export interface PinnedEvidence {
  ref: string
  seq: number
  at: number
  kind: string
  payload: unknown
  pinnedAt: number
  /** Job and claim ids that depend on this entry. Non-empty means it may not
   * be evicted. Kept as a list rather than a count so a release names what it
   * is releasing and a stale citer cannot pin something forever unnoticed. */
  citedBy: string[]
}

export interface PinResult {
  pinned: string[]
  /** Refs the source could not produce. Already-pinned refs are *not* here -
   * re-citing something already held is an ordinary success. */
  missing: string[]
}

export interface ResolveResult {
  resolved: PinnedEvidence[]
  missing: string[]
}

export interface EvidenceStats {
  retained: number
  cited: number
  capacity: number
  /** How far past the bound the store is because everything retained is
   * cited. Zero in the ordinary case; non-zero is a fact a caller may act on,
   * never a silent overrun. */
  overCapacity: number
  evicted: number
}

/**
 * What a store reads events from.
 *
 * Structural rather than `EventJournal`, so the store can be fed from a
 * replay, a fixture, or a future second capture path without this module
 * knowing about any of them - and so a test does not have to build a journal
 * to check the pinning rules.
 */
export interface EvidenceSource {
  readFrom(cursor: number, limit?: number): { events: Array<{ seq: number; at: number; kind: string; payload: unknown }> }
}

export const EVIDENCE_KEY = 'drc.ai-evidence.v1'

/**
 * Far smaller than the journal's 5,000, and deliberately: this holds only what
 * has been cited, which is a few events per job or claim. If it ever fills,
 * something is citing far more than it reviews, and the honest answer is the
 * `overCapacity` report rather than a bigger number.
 */
export const DEFAULT_EVIDENCE_CAPACITY = 1000

interface StoredShape {
  schemaVersion: 1
  entries: PinnedEvidence[]
  evicted: number
}

export class EvidenceStore {
  private entries = new Map<string, PinnedEvidence>()
  private evictedCount = 0
  private readonly capacity: number
  private readonly source: EvidenceSource | null

  constructor(options: { source?: EvidenceSource; capacity?: number } = {}) {
    const capacity = options.capacity ?? DEFAULT_EVIDENCE_CAPACITY
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`Evidence capacity must be a positive integer, got ${capacity}`)
    }
    this.capacity = capacity
    this.source = options.source ?? null
  }

  load(): void {
    const stored = readJSON<StoredShape | null>(EVIDENCE_KEY, null)
    if (!stored || !Array.isArray(stored.entries)) return
    this.entries = new Map(stored.entries.map((e) => [e.ref, e]))
    this.evictedCount = Number.isInteger(stored.evicted) ? stored.evicted : 0
  }

  private persist(): ReturnType<typeof writeJSON> {
    const shape: StoredShape = {
      schemaVersion: 1,
      entries: [...this.entries.values()],
      evicted: this.evictedCount,
    }
    return writeJSON(EVIDENCE_KEY, shape)
  }

  /**
   * Copy the referenced events out of the source and hold them on behalf of
   * `citedBy`.
   *
   * Returns both halves. A caller that only reads `pinned` still cannot
   * mistake a partial pin for a complete one, because the counts differ from
   * the refs it asked for - but `missing` is there so nobody has to do that
   * arithmetic, and G5's claim store refuses a claim whose refs land in it.
   */
  pin(refs: readonly string[], citedBy: string, now = Date.now()): PinResult {
    const pinned: string[] = []
    const missing: string[] = []

    for (const ref of refs) {
      const held = this.entries.get(ref)
      if (held) {
        if (!held.citedBy.includes(citedBy)) held.citedBy.push(citedBy)
        pinned.push(ref)
        continue
      }

      const seq = refSeq(ref)
      const event = seq === null ? null : this.readEvent(seq)
      if (!event) {
        missing.push(ref)
        continue
      }

      this.entries.set(ref, {
        ref,
        seq: event.seq,
        at: event.at,
        kind: event.kind,
        payload: event.payload,
        pinnedAt: now,
        citedBy: [citedBy],
      })
      pinned.push(ref)
    }

    if (pinned.length > 0) {
      this.evict()
      this.persist()
    }
    return { pinned, missing }
  }

  /**
   * Read one event out of the source by sequence.
   *
   * The journal exposes "events after a cursor" rather than a lookup, so this
   * asks for the first event after `seq - 1` and checks that it is actually
   * the one wanted. Without that check a retention drop would hand back a
   * *later* event under the requested ref, which is the quietest way to
   * attach the wrong evidence to a claim.
   */
  private readEvent(seq: number): { seq: number; at: number; kind: string; payload: unknown } | null {
    if (!this.source || seq < 1) return null
    const read = this.source.readFrom(seq - 1, 1)
    const first = read.events[0]
    return first && first.seq === seq ? first : null
  }

  /** Everything asked for that is held, and everything that is not. */
  resolve(refs: readonly string[]): ResolveResult {
    const resolved: PinnedEvidence[] = []
    const missing: string[] = []
    for (const ref of refs) {
      const held = this.entries.get(ref)
      if (held) resolved.push(held)
      else missing.push(ref)
    }
    return { resolved, missing }
  }

  /** Whether every ref resolves. The single question G5 asks before accepting
   * a claim, named so the answer cannot be got by reading `resolved.length`
   * against the wrong denominator. */
  resolvesAll(refs: readonly string[]): boolean {
    return refs.length > 0 && refs.every((ref) => this.entries.has(ref))
  }

  /**
   * Drop a citer from every entry it holds.
   *
   * Called when a claim is rejected or a job ends: its evidence becomes
   * evictable again rather than pinning storage for the life of the install.
   * The entries themselves stay until the bound needs the room, so a
   * just-rejected claim can still show what it was based on.
   */
  release(citedBy: string): number {
    let released = 0
    for (const entry of this.entries.values()) {
      const index = entry.citedBy.indexOf(citedBy)
      if (index >= 0) {
        entry.citedBy.splice(index, 1)
        released += 1
      }
    }
    if (released > 0) this.persist()
    return released
  }

  /**
   * Evict oldest-uncited-first until the bound is met, or until nothing is
   * evictable.
   *
   * The second exit is the important one. A store where every entry is cited
   * stays over capacity and reports it; discarding a cited entry would break
   * exactly the guarantee this file exists to make.
   */
  private evict(): void {
    if (this.entries.size <= this.capacity) return
    const evictable = [...this.entries.values()]
      .filter((e) => e.citedBy.length === 0)
      .sort((a, b) => a.pinnedAt - b.pinnedAt || a.seq - b.seq)

    for (const entry of evictable) {
      if (this.entries.size <= this.capacity) break
      this.entries.delete(entry.ref)
      this.evictedCount += 1
    }
  }

  stats(): EvidenceStats {
    let cited = 0
    for (const entry of this.entries.values()) if (entry.citedBy.length > 0) cited += 1
    return {
      retained: this.entries.size,
      cited,
      capacity: this.capacity,
      overCapacity: Math.max(0, this.entries.size - this.capacity),
      evicted: this.evictedCount,
    }
  }

  /** Test and reset hook. Clears memory and storage together so the two
   * cannot disagree. */
  reset(): void {
    this.entries.clear()
    this.evictedCount = 0
    writeJSON(EVIDENCE_KEY, { schemaVersion: 1, entries: [], evicted: 0 })
  }
}

/**
 * What `JobStore.create` needs to pin its `inputRefs` without importing the
 * store itself.
 *
 * Narrow on purpose: the job store may pin, and may do nothing else with
 * evidence. It cannot resolve, release, or evict.
 */
export interface EvidencePinner {
  pin(refs: readonly string[], citedBy: string, now?: number): PinResult
}
