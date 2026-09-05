/**
 * One turn of the worker: ask the scheduler what should happen, do that, and
 * report honestly what did.
 *
 * This is the first consumer of the event journal. The previous slice left it
 * unwired on purpose rather than shipping a producer with no reader; this is
 * the reader.
 *
 * # The rule the whole file exists to enforce
 *
 * **The cursor advances only after the work actually succeeded.** A model that
 * times out, is cancelled, returns nothing usable, or is not installed at all
 * leaves the cursor exactly where it was, so the next turn sees the same
 * events again. Every failure path below returns without acknowledging, and
 * the tests break each one in turn to prove it.
 *
 * # It cannot reach the game
 *
 * No import from `gameActions.ts`, `gameCommand.ts` or `gameLink.ts`. A model
 * result reaches this module as text and stops here. Section 2's "one command
 * path" is a structural fact about what this file can call, not a promise
 * about how carefully it was written - a future live-suggestion tool (section
 * 13.9) has to go through the existing typed boundary, and it will be visible
 * as a new import when somebody writes it.
 *
 * # It also cannot promote anything
 *
 * A background result is a candidate. This turn records that a job produced
 * output and moves it to `awaiting_review`; it does not write to the map, the
 * knowledge base, or any canonical record. Section 7's promotion lifecycle is
 * a separate slice with its own evidence and review requirements.
 */
import type { AlertBroker } from './aiAlertBroker.ts'
import type { EventJournal } from './aiEventJournal.ts'
import type { JobStore } from './aiJobStore.ts'
import type { ModelProvider, ModelResult } from './aiModelProvider.ts'
import { generateWithinBudget } from './aiModelProvider.ts'
import type { Activity } from './aiReviewScheduler.ts'
import { decideReview } from './aiReviewScheduler.ts'

export interface WorkerDeps {
  journal: EventJournal
  alerts: AlertBroker
  jobs: JobStore
  provider: ModelProvider
  activity: Activity
  now: number
  /** ISO timestamp for job records, kept separate from the millisecond clock
   * the scheduler uses so both stay deterministic in tests. */
  nowIso: string
  lastReviewAt: number | null
  stateHash: string
  lastReviewedHash: string | null
  /** Stable instruction prefix. Supplied by the caller so this module does not
   * own prompt content. */
  instructions: string
}

export type WorkerOutcome =
  | { did: 'nothing'; reason: string }
  | { did: 'background-idle'; reason: string }
  /** A live review ran. `acknowledged` says whether the cursor moved, which is
   * the only durable evidence the events were actually consumed. */
  | {
      did: 'review'
      reason: string
      result: ModelResult
      acknowledged: boolean
      cursorAfter: number
      alertKey: string | null
    }
  /** A background job was preempted by an alert. */
  | { did: 'preempted'; reason: string; jobId: string; cursorAfter: number }
  | {
      did: 'background-job'
      reason: string
      jobId: string
      result: ModelResult
      status: string
    }

/**
 * Run one turn. Returns rather than loops: the caller owns the timer, which
 * keeps this testable without one and means a stuck turn cannot wedge a loop
 * nobody can see into.
 */
export async function runWorkerOnce(
  deps: WorkerDeps,
  signal?: AbortSignal
): Promise<WorkerOutcome> {
  const { journal, alerts, jobs, provider, nowIso } = deps

  const decision = decideReview({
    journal,
    alerts,
    activity: deps.activity,
    now: deps.now,
    lastReviewAt: deps.lastReviewAt,
    stateHash: deps.stateHash,
    lastReviewedHash: deps.lastReviewedHash,
    backgroundRunning: jobs.byStatus('running').length > 0,
  })

  if (decision.action === 'idle') return { did: 'nothing', reason: decision.reason }

  if (decision.action === 'review') {
    // Preemption first, and before any model call: a running job is stopped
    // because an alert arrived, not because the model said so.
    if (decision.preempt) {
      const running = jobs.byStatus('running')[0]
      if (running) {
        jobs.transition(running.jobId, 'cancelled', {
          now: nowIso,
          note: `preempted by ${decision.priority ?? 'alert'} ${decision.alertKey ?? ''}`.trim(),
        })
        return {
          did: 'preempted',
          reason: decision.reason,
          jobId: running.jobId,
          // Unchanged, and asserted by the caller's tests: preemption is not
          // consumption.
          cursorAfter: journal.acknowledged(),
        }
      }
    }

    const read = journal.readFrom(decision.fromCursor)
    const result = await generateWithinBudget(
      provider,
      {
        instructions: deps.instructions,
        // Compact suffix, section 5. References and counts, never a transcript.
        state: JSON.stringify({
          events: read.events.map((e) => ({ seq: e.seq, kind: e.kind })),
          lost: read.lost,
          alert: decision.alertKey,
        }),
        allowedTools: [],
        budget: { maxTokens: 256, maxSeconds: 5 },
      },
      signal
    )

    // The one place the cursor may move, and only here.
    let acknowledged = false
    if (result.ok && read.events.length > 0) {
      journal.acknowledge(read.nextCursor)
      acknowledged = true
    }

    // An answered alert is retired only on success, for the same reason: a
    // failed review has not dealt with the condition that raised it.
    if (result.ok && decision.alertKey) alerts.acknowledge(decision.alertKey)

    return {
      did: 'review',
      reason: decision.reason,
      result,
      acknowledged,
      cursorAfter: journal.acknowledged(),
      alertKey: decision.alertKey,
    }
  }

  // Idle capacity: advance one background job, if there is one to advance.
  const next = jobs.byStatus('queued')[0] ?? jobs.byStatus('checkpointed')[0]
  if (!next) return { did: 'background-idle', reason: decision.reason }

  const started = jobs.transition(next.jobId, 'running', { now: nowIso })
  if (!started.ok) {
    return { did: 'background-idle', reason: started.reason ?? 'could not start the job' }
  }

  const result = await generateWithinBudget(
    provider,
    {
      instructions: deps.instructions,
      state: JSON.stringify({ jobId: next.jobId, kind: next.kind, scope: next.scope }),
      allowedTools: next.allowedTools,
      budget: next.budget,
    },
    signal
  )

  // Success is a candidate awaiting review, never a completion: nothing here
  // has validated the output or promoted anything.
  //
  // Failure keeps whatever checkpoint the job already had. Cancellation is
  // recorded as cancelled rather than failed, because a preempted job did not
  // go wrong.
  const to = result.ok ? 'awaiting_review' : result.failure === 'cancelled' ? 'cancelled' : 'failed'
  jobs.transition(next.jobId, to, {
    now: nowIso,
    note: result.ok ? 'produced a candidate; not yet reviewed' : `${result.failure}: ${result.message}`,
  })

  return {
    did: 'background-job',
    reason: decision.reason,
    jobId: next.jobId,
    result,
    status: jobs.get(next.jobId)?.status ?? 'unknown',
  }
}
