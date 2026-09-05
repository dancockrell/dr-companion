/**
 * The host's decisions, apart from the host's wiring: turning the app's own
 * already-parsed state into journal events, alerts and one worker turn.
 *
 * Split from `aiWorkerHost.ts` so it can be tested without React, without a
 * socket, and without dragging the Tauri client chain into a unit test - the
 * same reason `shouldPublish` sits apart from the hook that calls it. That is
 * not a stylistic preference here: `aiWorkerHost.ts` imports `useAppStore`,
 * which reaches `src/bridge/` through a directory import Node refuses, so
 * anything left in that file can only ever be checked by reading it as text.
 * Everything with a decision in it therefore lives here, and the hook keeps
 * only what genuinely needs React.
 *
 * Every decision here fails silently when wrong. Ingesting from the wrong
 * offset duplicates every line or skips a batch with nothing thrown, a
 * disconnect alert that fires at startup teaches a player to ignore the one
 * priority that must never be ignored, and a turn that advances the cursor on
 * a failed generation loses events with nothing to show for it.
 */
import type { AlertBroker } from './aiAlertBroker.ts'
import type { EventJournal } from './aiEventJournal.ts'
import type { JobStore } from './aiJobStore.ts'
import type { ModelProvider } from './aiModelProvider.ts'
import type { Activity } from './aiReviewScheduler.ts'
import { runWorkerOnce, type WorkerOutcome } from './aiWorker.ts'

/** Situation flags that mean something is wrong right now. Taken from the
 * game's own already-parsed indicator set, not inferred from text. */
const URGENT_SITUATIONS = ['stunned', 'webbed', 'immobilized', 'dying'] as const

export interface IngestResult {
  appended: number
  /** Lines the display buffer discarded before this host could journal them.
   * Reported rather than absorbed: a silent gap here is indistinguishable
   * from a quiet game. */
  missed: number
  ingested: number
}

/**
 * Append whatever is new since `alreadyIngested`.
 *
 * Pure enough to test directly, which is the point: the subtle part is not
 * the React wiring but deciding which lines are new, and getting that wrong
 * either duplicates events or loses them silently.
 */
export function ingestLines(
  journal: EventJournal,
  lines: ReadonlyArray<{ text: string; stream: string; at?: number }>,
  alreadyIngested: number,
  dropped = 0,
  droppedAlreadySeen = 0
): IngestResult {
  const missed = Math.max(0, dropped - droppedAlreadySeen)
  const start = Math.max(0, Math.min(alreadyIngested, lines.length))
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]
    journal.append('line', { text: line.text, stream: line.stream }, line.at ?? 0)
  }
  return { appended: lines.length - start, missed, ingested: lines.length }
}

/**
 * Turn already-parsed state into alerts.
 *
 * Returns what should be raised rather than raising it, so the mapping can be
 * tested without a broker and so the caller keeps control of ordering.
 */
export function deriveAlerts(state: {
  situation: readonly string[] | undefined
  bridgeConnected: boolean
  everConnected: boolean
}): Array<{ priority: 'critical' | 'urgent'; key: string; detail: unknown }> {
  const out: Array<{ priority: 'critical' | 'urgent'; key: string; detail: unknown }> = []

  // Only after a connection has existed. A client that has not connected yet
  // is not disconnected, and starting up in a permanent critical alert would
  // train a player to ignore the one state that must never be ignored.
  if (state.everConnected && !state.bridgeConnected) {
    out.push({ priority: 'critical', key: 'bridge-disconnected', detail: {} })
  }

  for (const flag of state.situation ?? []) {
    if ((URGENT_SITUATIONS as readonly string[]).includes(flag)) {
      out.push({ priority: 'urgent', key: `situation:${flag}`, detail: { flag } })
    }
  }
  return out
}

/**
 * What the host is doing, and every way it is currently failing.
 *
 * Declared here rather than beside the hook because `runHostTick` produces it
 * and this module is the one that can be tested; `aiWorkerHost.ts` re-exports
 * it so consumers still have one name to import.
 */
export interface AiWorkerStatus {
  /** What the provider says about itself. Absent is the ordinary case. */
  available: boolean
  providerReason?: string
  journalPending: number
  journalLost: number
  /** Lines the display buffer dropped before they were journalled. */
  missedLines: number
  pendingAlerts: number
  jobs: Record<string, number>
  lastOutcome: string | null
  lastFailure: string | null
  /**
   * Turns taken since the app started.
   *
   * The only field that proves the host is alive. Every other number here can
   * legitimately sit at zero forever on an install with no model and a quiet
   * game, so a block of zeroes is otherwise indistinguishable from a host
   * that was never mounted - which is the state this feature used to ship in.
   */
  ticks: number
}

/**
 * The already-parsed app state one turn needs, read by the caller.
 *
 * Passed in rather than read from the store here for two reasons that point
 * the same way: the store is not importable outside Vite, and a turn that
 * read live state in the middle of itself could act on two different worlds
 * either side of an await.
 */
export interface HostAppState {
  situation: readonly string[] | undefined
  roundtime: number | undefined
  bridgeConnected: boolean
}

/**
 * What the host remembers between turns.
 *
 * Mutated by `runHostTick`, and owned by the caller - in the app it is a ref,
 * in a test it is an object literal. Keeping it out of module scope is what
 * lets two turns in a test not contaminate each other.
 */
export interface HostMemory {
  lastReviewAt: number | null
  lastReviewedHash: string | null
  ticks: number
  /** Lines the display buffer discarded before the host could journal them.
   * Accumulated by the caller's ingestion pass, reported by every turn. */
  missedLines: number
}

export interface HostTickInput {
  journal: EventJournal
  alerts: AlertBroker
  jobs: JobStore
  provider: ModelProvider
  app: HostAppState
  memory: HostMemory
  now: number
  /** ISO timestamp for job records, kept separate from the millisecond clock
   * so both stay deterministic in tests. */
  nowIso: string
  signal?: AbortSignal
}

/** Stable instruction prefix. Here rather than in the provider so the prompt's
 * unchanging half really is unchanging, which is what prefix caching needs. */
const INSTRUCTIONS = 'Review the recent event delta and report notable changes.'

/**
 * One turn of the host: decide the activity, ask the worker, report status.
 *
 * Separate from the effect that calls it because the effect is the part that
 * cannot be tested and this is the part that can. It also settles the trap
 * that made the extraction necessary: the effect that owns the timer must not
 * depend on state that changes every tick, or the abort in its cleanup fires
 * on every unrelated update and kills whatever generation was in flight. The
 * changing state arrives here as an argument instead, and
 * `tools/ai-worker-host-test.mjs` asserts that dependency array by reading it.
 */
export async function runHostTick(input: HostTickInput): Promise<AiWorkerStatus> {
  const { journal, alerts, jobs, provider, app, memory, now, nowIso, signal } = input
  memory.ticks += 1

  const situation = app.situation ?? []
  const activity: Activity = !app.bridgeConnected
    ? 'disconnected'
    : situation.includes('in_combat')
      ? 'combat'
      : 'active'

  const hash = JSON.stringify({ s: situation, r: app.roundtime ?? 0 })

  const outcome: WorkerOutcome = await runWorkerOnce(
    {
      journal,
      alerts,
      jobs,
      provider,
      activity,
      now,
      nowIso,
      lastReviewAt: memory.lastReviewAt,
      stateHash: hash,
      lastReviewedHash: memory.lastReviewedHash,
      instructions: INSTRUCTIONS,
    },
    signal
  )

  if (outcome.did === 'review') {
    memory.lastReviewAt = now
    // Only a successful review may mark this state as reviewed. Recording it
    // on a failure would suppress every later attempt at the same state,
    // which is the one thing the scheduler's hash rule must never do.
    if (outcome.result.ok) memory.lastReviewedHash = hash
  }

  const health = provider.describe()
  const byStatus: Record<string, number> = {}
  for (const job of jobs.all()) byStatus[job.status] = (byStatus[job.status] ?? 0) + 1
  const failure =
    outcome.did === 'review' || outcome.did === 'background-job'
      ? outcome.result.ok
        ? null
        : `${outcome.result.failure}: ${outcome.result.message}`
      : null

  return {
    available: health.available,
    providerReason: health.reason,
    journalPending: journal.pending(),
    journalLost: journal.stats().lost,
    missedLines: memory.missedLines,
    pendingAlerts: alerts.pendingCount(),
    jobs: byStatus,
    lastOutcome: outcome.did,
    lastFailure: failure,
    ticks: memory.ticks,
  }
}
