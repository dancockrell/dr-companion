/**
 * Deterministic alert priority, deduplication, acknowledgement, and the one
 * question background work has to ask: should I stop right now?
 *
 * Priorities are `docs/LOCAL_AI_BACKGROUND_WORKER.md` section 4.3, unchanged:
 *
 *   critical   stop request, disconnect, runaway loop, credential exposure
 *   urgent     death, stun, unexpected combat, route divergence
 *   normal     new room, unfamiliar object, script warning
 *   background missing metadata, map conflict, undocumented behaviour
 *
 * # This is not alertGate
 *
 * `alertGate.ts` already owns whether a *sound* plays, and throttles by
 * channel so a client that pings constantly does not train the player to
 * ignore it. That is a presentation decision about noise.
 *
 * This is a scheduling decision about work: which pending alert the worker
 * should look at next, and whether it must abandon what it is doing. The two
 * answer different questions and must not be merged - a player muting a sound
 * must never stop a critical alert from cancelling background work, which is
 * exactly what sharing a throttle would do.
 *
 * # Ordering is total and deterministic
 *
 * Priority first, then sequence. Never wall-clock time and never insertion
 * order alone: two alerts raised in the same millisecond must still have one
 * defined winner, or the same input produces different behaviour on different
 * runs and no test of it means anything.
 *
 * # Nothing here sends a command
 *
 * The broker classifies and orders. Deterministic protection - emergency stop,
 * command cancellation, disconnect handling - is owned by the existing
 * deterministic paths and must not wait for this or for any model. A critical
 * alert recorded here is a *notification that protection already acted*, not
 * the actor.
 */

export type AlertPriority = 'critical' | 'urgent' | 'normal' | 'background'

/** Lower sorts first. Explicit table rather than array position so adding a
 * priority cannot silently reorder the existing ones. */
const RANK: Record<AlertPriority, number> = {
  critical: 0,
  urgent: 1,
  normal: 2,
  background: 3,
}

/**
 * Priorities that must interrupt background work immediately.
 *
 * Critical and urgent only. `normal` explicitly does not preempt - the
 * architecture puts a new room or a script warning in "include in the next
 * heartbeat", and a client that abandoned a research job every time the player
 * walked through a door would never finish one.
 */
const PREEMPTING: ReadonlySet<AlertPriority> = new Set<AlertPriority>(['critical', 'urgent'])

export interface Alert {
  /** Stable sequence id, assigned by the broker. Ties are broken by this. */
  seq: number
  priority: AlertPriority
  /**
   * Deduplication identity. Two alerts with the same key are the same ongoing
   * condition, not two events - "you are stunned" arriving on three
   * consecutive rounds is one alert the worker should look at once.
   */
  key: string
  at: number
  detail: unknown
  /** How many times this condition has been raised since it was acknowledged.
   * Kept because "stunned three rounds running" is worth more than "stunned",
   * and collapsing duplicates would otherwise throw that away. */
  occurrences: number
}

export interface RaiseResult {
  alert: Alert
  /** True when this collapsed into an existing pending alert rather than
   * creating a new one. */
  deduplicated: boolean
  /** True when this alert requires background work to stop now. */
  preempts: boolean
}

export function preemptsBackgroundWork(priority: AlertPriority): boolean {
  return PREEMPTING.has(priority)
}

export class AlertBroker {
  private pending = new Map<string, Alert>()
  /**
   * Conditions that have been dealt with and have not yet gone away.
   *
   * `acknowledge` used to delete the key outright, and the host re-derives
   * `situation:stunned` from character state on every update - so a stun
   * lasting four rounds became four urgent reviews, one a second with a real
   * provider, each answering a question already answered.
   *
   * A map rather than the set of keys the design called for, because the
   * point of keeping the record is `occurrences`: "stunned four rounds
   * running" is worth more than "stunned", and a set would throw that away at
   * exactly the moment it began to matter.
   */
  private handled = new Map<string, Alert>()
  private nextSeq = 1
  private raisedCount = 0
  private acknowledgedCount = 0

  /**
   * Record an alert.
   *
   * A duplicate of a still-pending condition increments its count and keeps
   * its original sequence, so a repeating condition cannot starve older alerts
   * by continuously jumping the queue. Its priority is *raised* if the new
   * report is more severe - a condition that escalates must not stay filed
   * under the calmer classification it happened to arrive with first.
   */
  raise(priority: AlertPriority, key: string, detail: unknown, at: number): RaiseResult {
    if (!key) throw new Error('An alert needs a deduplication key.')
    if (!(priority in RANK)) throw new Error(`Unknown alert priority: ${priority}`)
    this.raisedCount += 1

    const existing = this.pending.get(key)
    if (existing) {
      existing.occurrences += 1
      existing.at = at
      existing.detail = detail
      if (RANK[priority] < RANK[existing.priority]) existing.priority = priority
      return {
        alert: existing,
        deduplicated: true,
        preempts: preemptsBackgroundWork(existing.priority),
      }
    }

    const alreadyHandled = this.handled.get(key)
    if (alreadyHandled) {
      alreadyHandled.occurrences += 1
      alreadyHandled.at = at
      alreadyHandled.detail = detail

      // Critical is exempt, and deliberately so. A disconnect that has been
      // looked at once and is still happening is not noise to be filed away;
      // the one priority that must never be suppressed must not be
      // suppressible by having been acknowledged.
      if (priority !== 'critical') {
        return { alert: alreadyHandled, deduplicated: true, preempts: false }
      }
      this.handled.delete(key)
      alreadyHandled.priority = priority
      this.pending.set(key, alreadyHandled)
      return { alert: alreadyHandled, deduplicated: true, preempts: true }
    }

    const alert: Alert = { seq: this.nextSeq++, priority, key, at, detail, occurrences: 1 }
    this.pending.set(key, alert)
    return { alert, deduplicated: false, preempts: preemptsBackgroundWork(priority) }
  }

  /**
   * Tell the broker which conditions are still true.
   *
   * This is what separates "handled" from "over". A handled key stays
   * suppressed only while its condition is still being reported; once it
   * stops appearing here it is forgotten, so the next occurrence is a fresh
   * alert with a fresh count rather than a suppressed repeat of something
   * that ended minutes ago.
   *
   * Called by the host with the keys `deriveAlerts` produced this pass, so
   * the definition of "still true" stays with the code that decides what an
   * alert is, not with the broker.
   */
  reconcile(activeKeys: Iterable<string>): string[] {
    const active = new Set(activeKeys)
    const cleared: string[] = []
    for (const key of this.handled.keys()) {
      if (!active.has(key)) {
        this.handled.delete(key)
        cleared.push(key)
      }
    }
    return cleared
  }

  /** How many handled conditions are still being reported. Exposed because a
   * number that only ever goes up is the first sign `reconcile` is not being
   * called. */
  handledCount(): number {
    return this.handled.size
  }

  /**
   * The alert a worker should handle next, without removing it. Peeking and
   * consuming are separate for the same reason reading and acknowledging are
   * separate in the journal: a worker that dies mid-handling must not have
   * silently discarded the thing it was handling.
   */
  next(): Alert | null {
    let best: Alert | null = null
    for (const alert of this.pending.values()) {
      if (best === null) {
        best = alert
        continue
      }
      const byPriority = RANK[alert.priority] - RANK[best.priority]
      if (byPriority < 0 || (byPriority === 0 && alert.seq < best.seq)) best = alert
    }
    return best
  }

  /** Every pending alert in the order a worker should take them. */
  drain(): Alert[] {
    return [...this.pending.values()].sort(
      (a, b) => RANK[a.priority] - RANK[b.priority] || a.seq - b.seq
    )
  }

  /**
   * Retire a handled alert. Returns false when the key was not pending, so a
   * double-acknowledge is visible rather than looking like success.
   */
  acknowledge(key: string): boolean {
    const alert = this.pending.get(key)
    if (!alert) return false
    this.pending.delete(key)
    // Retired from the queue, remembered as handled. Forgetting it here is
    // what made a four-round stun four separate urgent reviews; `reconcile`
    // is what eventually forgets it, once the condition has actually stopped.
    this.handled.set(key, alert)
    this.acknowledgedCount += 1
    return true
  }

  /** Does anything pending require background work to stop? */
  hasPreempting(): boolean {
    for (const alert of this.pending.values()) {
      if (preemptsBackgroundWork(alert.priority)) return true
    }
    return false
  }

  pendingCount(): number {
    return this.pending.size
  }

  stats(): { raised: number; acknowledged: number; pending: number } {
    return {
      raised: this.raisedCount,
      acknowledged: this.acknowledgedCount,
      pending: this.pending.size,
    }
  }
}
