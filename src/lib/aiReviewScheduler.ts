/**
 * When the worker should look, and what it should look at.
 *
 * A pure decision function over the journal, the alert broker and the clock.
 * It calls nothing, starts nothing, and cannot send a command - it returns
 * what *ought* to happen and leaves acting to the caller. That is what makes
 * the cadence rules in `docs/LOCAL_AI_BACKGROUND_WORKER.md` section 4.2
 * testable without a model, a socket, or a timer.
 *
 * # The rule that saves the most work
 *
 * "No relevant state change -> skip inference." Not a rate limit: a genuinely
 * unchanged world produces *no* model call at all, however long it has been.
 * The scheduler compares a caller-supplied stable hash of the AI-relevant
 * state, so what counts as relevant stays owned by the caller that knows -
 * this module must not grow its own opinion about which fields matter.
 *
 * # Preemption is not a cadence
 *
 * A preempting alert is answered immediately regardless of when the last
 * review ran. Deterministic protection has already acted by then; this only
 * decides that the worker stops what it is doing and looks.
 */
import type { AlertBroker, AlertPriority } from './aiAlertBroker.ts'
import { preemptsBackgroundWork } from './aiAlertBroker.ts'
import type { Cursor, EventJournal } from './aiEventJournal.ts'

export type Activity = 'combat' | 'travel' | 'active' | 'quiet' | 'idle' | 'disconnected'

/**
 * Target gap between reviews, in milliseconds, by activity. Section 4.2's
 * table, which calls five seconds "the normal-play target, not a hard timer".
 *
 * `idle` and `disconnected` are `Infinity`: live review is suspended entirely,
 * which is not the same as a very long interval - no elapsed time will ever
 * trigger one, and only an alert or background work happens there.
 */
export const REVIEW_INTERVAL_MS: Record<Activity, number> = {
  combat: 1500,
  travel: 1500,
  active: 5000,
  quiet: 15000,
  idle: Number.POSITIVE_INFINITY,
  disconnected: Number.POSITIVE_INFINITY,
}

export type ReviewAction =
  /** Nothing to do. */
  | { action: 'idle'; reason: string }
  /** Answer an alert now, interrupting background work if any is running. */
  | {
      action: 'review'
      reason: string
      priority: AlertPriority
      alertKey: string
      fromCursor: Cursor
      preempt: boolean
    }
  /** Ordinary heartbeat review of the accumulated delta. */
  | { action: 'review'; reason: string; priority: null; alertKey: null; fromCursor: Cursor; preempt: false }
  /** No live work is needed; idle inference time may go to background jobs. */
  | { action: 'background'; reason: string }

export interface SchedulerInput {
  journal: EventJournal
  alerts: AlertBroker
  activity: Activity
  now: number
  /** When a review last *started*. Null when none ever has. */
  lastReviewAt: number | null
  /**
   * Stable hash of the AI-relevant state as of now, supplied by the caller.
   * Equal hashes mean nothing worth reviewing changed.
   */
  stateHash: string
  /** The hash at the last review, or null if none. */
  lastReviewedHash: string | null
  /** Whether a background job is currently running, so preemption can be
   * reported rather than assumed. */
  backgroundRunning: boolean
}

/**
 * Decide the next action. Order matters and is deliberate:
 *
 * 1. A preempting alert wins over everything, including an unchanged hash -
 *    the alert *is* the change, and a critical condition must never be
 *    suppressed by a state hash that happens to match.
 * 2. Unchanged relevant state suppresses inference entirely.
 * 3. Otherwise the activity cadence decides whether enough time has passed.
 * 4. With nothing live to do, idle capacity goes to background work.
 */
export function decideReview(input: SchedulerInput): ReviewAction {
  const {
    journal,
    alerts,
    activity,
    now,
    lastReviewAt,
    stateHash,
    lastReviewedHash,
    backgroundRunning,
  } = input

  const cursor = journal.acknowledged()

  const alert = alerts.next()
  if (alert && preemptsBackgroundWork(alert.priority)) {
    return {
      action: 'review',
      reason: `${alert.priority} alert ${alert.key} requires immediate review`,
      priority: alert.priority,
      alertKey: alert.key,
      fromCursor: cursor,
      preempt: backgroundRunning,
    }
  }

  // Suppression comes after preemption and before the clock. An unchanged
  // world is not reviewed however long it has been - the architecture's "no
  // relevant state change -> skip inference" is absolute, not a longer timer.
  if (lastReviewedHash !== null && stateHash === lastReviewedHash) {
    return backgroundRunning || journal.pending() === 0
      ? { action: 'background', reason: 'relevant state unchanged since the last review' }
      : { action: 'background', reason: 'relevant state unchanged; events pending but not relevant' }
  }

  const interval = REVIEW_INTERVAL_MS[activity]
  if (!Number.isFinite(interval)) {
    return {
      action: 'background',
      reason: `live review suspended while ${activity}`,
    }
  }

  const due = lastReviewAt === null || now - lastReviewAt >= interval
  if (!due) {
    return {
      action: 'idle',
      reason: `next ${activity} review in ${interval - (now - lastReviewAt!)}ms`,
    }
  }

  if (journal.pending() === 0) {
    return { action: 'background', reason: 'no unreviewed events' }
  }

  return {
    action: 'review',
    reason: `${journal.pending()} unreviewed events at ${activity} cadence`,
    priority: null,
    alertKey: null,
    fromCursor: cursor,
    preempt: false,
  }
}
