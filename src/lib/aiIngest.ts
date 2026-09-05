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
import { saveJournalCursor, type EventJournal } from './aiEventJournal.ts'
import type { JobStore } from './aiJobStore.ts'
import type { ModelProvider, ProviderFailure } from './aiModelProvider.ts'
import type { Activity } from './aiReviewScheduler.ts'
import { runWorkerOnce, type WorkerDeps, type WorkerOutcome } from './aiWorker.ts'

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
   * The failure kind on its own, beside the human sentence above.
   *
   * `lastFailure` is `"timeout: No result within the 5s budget."` - fine to
   * read once, useless to branch on. A panel that wanted to say something
   * different for out-of-memory than for absence had to match on the prefix
   * of a message, which breaks the first time somebody rewords it. The kind
   * is a closed set, so it is carried as one.
   */
  lastFailureKind: ProviderFailure | null
  /** The most recent live review the model actually produced, and when. Null
   * until one arrives, which on an install with no model is forever. */
  lastReview: { notable: string[]; question?: string; at: string } | null
  /**
   * Turns taken since the app started.
   *
   * The only field that proves the host is alive. Every other number here can
   * legitimately sit at zero forever on an install with no model and a quiet
   * game, so a block of zeroes is otherwise indistinguishable from a host
   * that was never mounted - which is the state this feature used to ship in.
   */
  ticks: number
  /**
   * Events captured but never reviewed because there is no model to review
   * them with, including any the retention bound has already dropped.
   *
   * Separate from `journalLost` because they are different facts. An install
   * with no model journals every line and acknowledges none, so the bound is
   * reached and events fall off the back - working exactly as designed.
   * Reporting that as loss would put a permanent red warning on a client
   * that has nothing wrong with it, and a warning that is always on is one
   * nobody reads on the day it means something.
   */
  unreviewedWithoutModel: number
}

/**
 * Whether two statuses say the same thing, ignoring the tick count.
 *
 * The host publishes on a change rather than on every turn, so this decides
 * how often anybody watching re-renders. Getting it wrong in the strict
 * direction costs a render a second forever on an idle client; getting it
 * wrong in the loose direction hides a real change, which is worse, so
 * anything not compared here has to be a field that genuinely does not matter
 * - `ticks` is the only one, and it has its own schedule.
 */
export function sameStatus(a: AiWorkerStatus, b: AiWorkerStatus): boolean {
  if (
    a.available !== b.available ||
    a.providerReason !== b.providerReason ||
    a.journalPending !== b.journalPending ||
    a.journalLost !== b.journalLost ||
    a.missedLines !== b.missedLines ||
    a.pendingAlerts !== b.pendingAlerts ||
    a.lastOutcome !== b.lastOutcome ||
    a.lastFailure !== b.lastFailure ||
    a.lastFailureKind !== b.lastFailureKind ||
    a.lastReview?.at !== b.lastReview?.at ||
    a.unreviewedWithoutModel !== b.unreviewedWithoutModel
  ) {
    return false
  }
  // `jobs` is rebuilt every turn, so its reference always differs and only its
  // contents mean anything. Over the union of both key sets: a status gaining
  // a job and a status losing one are both changes, and iterating one side
  // would see only half of that.
  for (const key of new Set([...Object.keys(a.jobs), ...Object.keys(b.jobs)])) {
    if (a.jobs[key] !== b.jobs[key]) return false
  }
  return true
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
  /** `CharacterStatus.location.roomId` - where the character is, as Lich
   * reports it rather than as the map guessed it. */
  roomId: string | null | undefined
  /** `CharacterStatus.roomCombatants`. Only the two fields the hash counts
   * are required, so a test does not have to build a whole combatant. */
  roomCombatants: ReadonlyArray<{ hostile: boolean; dead: boolean }> | undefined
  /** `CharacterStatus.location.isTown`. Undefined on a bridge that predates
   * the field, which reads the same as "not a town" - the cautious way round,
   * since it costs a faster cadence rather than a slower one. */
  isTown: boolean | undefined
}

/**
 * The state the scheduler compares between turns.
 *
 * The scheduler's rule is absolute - equal hashes mean no inference at all,
 * however long it has been - so what goes in here decides both what wakes the
 * model and what can never wake it. Four fields, each for a reason:
 *
 * - `roomId`, because a new room is the single most review-worthy change and
 *   nothing else in this list moves when you walk through a door;
 * - `situation`, sorted, because the bridge's flag order is not stable and an
 *   unsorted array would make an identical world hash differently;
 * - `inRoundtime` as a boolean, not the number: roundtime counts down every
 *   second, so hashing the number meant every second of every swing was a
 *   fresh review of an unchanged world. What matters is whether you can act;
 * - `hostiles`, living and hostile only, because a corpse in the room is not
 *   a threat and a count that included one would keep the model busy after a
 *   fight had ended.
 *
 * Vitals are deliberately absent. Health ticking 84 to 83 is not a change
 * worth a model call; the situation flags carry the states that are.
 */
export function reviewHash(state: {
  roomId: string | null | undefined
  situation: readonly string[] | undefined
  roundtime: number | undefined
  roomCombatants: ReadonlyArray<{ hostile: boolean; dead: boolean }> | undefined
}): string {
  return JSON.stringify({
    roomId: state.roomId ?? null,
    situation: [...(state.situation ?? [])].sort(),
    // `??` rather than `||`: a roundtime of 0 is a real value and the reason
    // this field exists, so it must not be replaced by the default.
    inRoundtime: (state.roundtime ?? 0) > 0,
    hostiles: (state.roomCombatants ?? []).filter((c) => c.hostile && !c.dead).length,
  })
}

/** A room counts as newly entered for this long. Long enough to cover the
 * pause between two moves at a walk, short enough that standing still in a
 * new room returns to the ordinary cadence rather than staying urgent. */
const TRAVEL_WINDOW_MS = 10_000

/** Silence this long is a character nobody is playing. Live review is
 * suspended entirely at that point, not merely slowed. */
const IDLE_AFTER_MS = 120_000

/**
 * Which cadence the scheduler should be running at.
 *
 * The order is the whole of it, and it is a priority list rather than a set
 * of independent tests - every frame satisfies several of these at once. A
 * character fighting in a doorway is in combat *and* has just changed room;
 * calling that travel would review at a travel cadence while something was
 * trying to kill them. So combat outranks travel, and disconnection outranks
 * both, because a client with no bridge has no state worth reviewing at all.
 *
 * `isTown` is the only field here that is not about time, and it is last for
 * the same reason: a safe town is quiet only when nothing else is happening.
 */
export function deriveActivity(state: {
  bridgeConnected: boolean
  situation: readonly string[] | undefined
  /** When the character last entered a different room, or null if never. */
  roomChangedAt: number | null
  /** When the journal last actually took a line, or null if it never has. */
  lastAppendAt: number | null
  isTown: boolean | undefined
  now: number
}): Activity {
  if (!state.bridgeConnected) return 'disconnected'
  if ((state.situation ?? []).includes('in_combat')) return 'combat'
  if (state.roomChangedAt !== null && state.now - state.roomChangedAt < TRAVEL_WINDOW_MS) {
    return 'travel'
  }
  // A journal that has never taken a line is idle by definition rather than
  // by arithmetic: `now - null` is `now`, which would be a silent accident
  // producing the right answer for the wrong reason.
  if (state.lastAppendAt === null || state.now - state.lastAppendAt > IDLE_AFTER_MS) return 'idle'
  return state.isTown === true ? 'quiet' : 'active'
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
  /** When the character last entered a different room. Maintained by the
   * caller, which is the only side that can see the map change. */
  roomChangedAt: number | null
  /** When ingestion last actually appended something. Maintained by the
   * caller's ingestion pass; the difference between a quiet game and a dead
   * one is entirely in this number. */
  lastAppendAt: number | null
}

export interface HostTickInput {
  journal: EventJournal
  alerts: AlertBroker
  jobs: JobStore
  provider: ModelProvider
  /**
   * Where candidate claims go, and what the tether validator checks against.
   *
   * Threaded through rather than reached for, so a turn cannot acquire a
   * claim store the caller did not give it - and optional, because a host
   * without one produces no claims rather than crashing. The worker's own
   * deps document why these three travel together.
   */
  claims?: WorkerDeps['claims']
  evidence?: WorkerDeps['evidence']
  knownRoom?: WorkerDeps['knownRoom']
  app: HostAppState
  memory: HostMemory
  now: number
  /** ISO timestamp for job records, kept separate from the millisecond clock
   * so both stay deterministic in tests. */
  nowIso: string
  signal?: AbortSignal
  /** The status this turn is replacing. Only `lastReview` is read from it: a
   * turn that produced no review must keep showing the last one rather than
   * blanking the panel once a second. */
  previous?: AiWorkerStatus
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
  const { journal, alerts, jobs, provider, app, memory, now, nowIso, signal, previous } = input
  memory.ticks += 1

  const activity = deriveActivity({
    bridgeConnected: app.bridgeConnected,
    situation: app.situation,
    roomChangedAt: memory.roomChangedAt,
    lastAppendAt: memory.lastAppendAt,
    isTown: app.isTown,
    now,
  })

  const hash = reviewHash(app)
  const cursorBefore = journal.acknowledged()

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
      claims: input.claims,
      evidence: input.evidence,
      knownRoom: input.knownRoom,
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

  // Only when it actually moved. A write every tick would be a storage write
  // per second for a number that had not changed, and the cursor moving is
  // the only event this record exists to survive.
  if (journal.acknowledged() !== cursorBefore) saveJournalCursor(journal)

  const health = provider.describe()
  const byStatus: Record<string, number> = {}
  for (const job of jobs.all()) byStatus[job.status] = (byStatus[job.status] ?? 0) + 1
  const failure =
    outcome.did === 'review' || outcome.did === 'background-job'
      ? outcome.result.ok
        ? null
        : `${outcome.result.failure}: ${outcome.result.message}`
      : null
  const failureKind =
    (outcome.did === 'review' || outcome.did === 'background-job') && !outcome.result.ok
      ? outcome.result.failure
      : null
  const review =
    outcome.did === 'review' && outcome.review
      ? { notable: outcome.review.notable, question: outcome.review.question, at: nowIso }
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
    lastFailureKind: failureKind,
    // Held rather than replaced when a turn produces none: the last thing the
    // model said stays on screen until it says something else. A field that
    // blanked on every idle tick would flicker once a second and be unreadable.
    lastReview: review ?? previous?.lastReview ?? null,
    ticks: memory.ticks,
    // Only meaningful while there is no model. With one available these
    // same events are a backlog being worked through, and journalLost is
    // then the honest place for anything the bound dropped.
    unreviewedWithoutModel: health.available ? 0 : journal.pending() + journal.stats().lost,
  }
}
