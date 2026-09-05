/**
 * The caller. Feeds the journal from the live stream, derives alerts from
 * state the app has already parsed, and runs the worker on a timer.
 *
 * Without this file the previous two slices were unreachable code: a journal,
 * broker, job store, scheduler, provider boundary and worker that nothing in
 * `src/` imported. `AGENTS.md` forbids exactly that - "no unused scaffolds,
 * orphaned modules, speculative adapters ... without a current caller and an
 * explicit product purpose". This is the current caller.
 *
 * # The host runs at the app root, and the panel only watches
 *
 * The first version of this hook was called by `AiWorkerPanel`, which lives
 * inside the Settings sheet. So the worker existed only while Settings was
 * open: opening the sheet started a journal, a job store and a one-second
 * loop, and closing it destroyed all three and abandoned the cursor. A
 * background worker that only runs while you are looking at its status page
 * is not a background worker.
 *
 * So `App.tsx` calls the hook once, beside `usePresentationBridgePublisher`
 * and for the same reason - one window hosts it - and the status is published
 * to the module-level store below. `AiWorkerPanel` subscribes to that store
 * and never calls the hook.
 *
 * Nothing here reads app state through a selector hook. At the root a selector
 * subscription re-renders the whole tree every time it fires, and `character`
 * is replaced on every status frame, so that would be a re-render of the
 * entire app roughly once a second. State is read inside the effects through
 * `useAppStore.getState()`, which is also what keeps the tick effect from
 * restarting on every unrelated update (trap 6).
 *
 * # Ingestion follows useGameLines.ts's rule rather than working around it
 *
 * `gameLines()` returns the live buffer and `push` mutates it in place, so its
 * array reference never changes and anything comparing that reference
 * concludes "nothing happened" forever. That defect has shipped three times in
 * this repo, most expensively as every alert sound silently never playing.
 *
 * So this subscribes to `gameVersion` - the counter that does change - and
 * reads the buffer only inside the effect body, never as a dependency.
 * `tools/gamelines-test.mjs` bans the raw accessors in `src/components`; this
 * is `src/lib`, which that check deliberately allows for non-component code,
 * and it follows the rule the check exists to enforce rather than relying on
 * being out of scope.
 *
 * The ingested count is tracked against `gameDropped()` so a buffer that
 * discarded lines under load is reported rather than silently skipped.
 *
 * # Alerts come from parsed state, never from a second pass over the text
 *
 * `CharacterStatus.situation` already carries `stunned`, `webbed`,
 * `immobilized` and the rest, parsed once by the bridge. Re-deriving them here
 * from line text would be a second classifier free to disagree with the first,
 * which is the defect this whole architecture is arranged to avoid. Disconnect
 * comes from `bridgeConnected` for the same reason.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { gameDropped, gameLines, gameVersion, subscribeGame } from './gameLink'
import { useAppStore } from '../store/useAppStore'
import { AlertBroker } from './aiAlertBroker.ts'
import { EventJournal } from './aiEventJournal.ts'
import { JobStore } from './aiJobStore.ts'
import { absentProvider, type ModelProvider } from './aiModelProvider.ts'
import { deriveAlerts, ingestLines } from './aiIngest.ts'
import type { Activity } from './aiReviewScheduler.ts'
import { runWorkerOnce, type WorkerOutcome } from './aiWorker.ts'

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
   * game, so a status block of zeroes is indistinguishable from a host that
   * was never mounted - which is exactly the state this file used to ship in.
   */
  ticks: number
}

const INITIAL_STATUS: AiWorkerStatus = {
  available: false,
  journalPending: 0,
  journalLost: 0,
  missedLines: 0,
  pendingAlerts: 0,
  jobs: {},
  lastOutcome: null,
  lastFailure: null,
  ticks: 0,
}

let currentStatus: AiWorkerStatus = INITIAL_STATUS
const statusListeners = new Set<() => void>()

/**
 * Watch the host's status.
 *
 * Shaped for `useSyncExternalStore`, and module-level rather than React
 * context so a panel mounting long after the host started sees the current
 * status immediately instead of a freshly zeroed one.
 */
export function subscribeAiStatus(listener: () => void): () => void {
  statusListeners.add(listener)
  return () => {
    statusListeners.delete(listener)
  }
}

/** The current status. A stable reference between publications, which is what
 * `useSyncExternalStore` requires of a snapshot. */
export function getAiStatus(): AiWorkerStatus {
  return currentStatus
}

function publishStatus(next: AiWorkerStatus): void {
  currentStatus = next
  // Copied before iterating: a listener that unsubscribes while being notified
  // would otherwise mutate the set mid-loop.
  for (const listener of [...statusListeners]) listener()
}

/** How often the host wakes to ask the scheduler. The scheduler, not this
 * timer, decides whether anything actually happens - so a short tick is cheap
 * and an unchanged world still costs no inference. */
const TICK_MS = 1000

/**
 * The default provider, created once.
 *
 * A default parameter of `absentProvider()` builds a new object on every
 * render, and the tick effect depends on the provider, so the effect tore down
 * and rebuilt itself - aborting any generation in flight - every time the
 * hosting component rendered. Trap 6 arriving through a default argument
 * rather than through a dependency array.
 */
const DEFAULT_PROVIDER: ModelProvider = absentProvider()

/**
 * Run the worker for as long as the hosting component is mounted.
 *
 * `enabled` rather than a conditional call, for the same reason
 * `usePresentationBridgePublisher` takes one: hooks cannot be called
 * conditionally, and only one window should host the worker.
 *
 * Returns nothing. Status goes to the module store above, which is the read
 * path for every consumer; returning it here would re-render the root on
 * every tick to deliver a number only the Settings panel reads.
 */
export function useAiWorkerHost(enabled: boolean, provider: ModelProvider = DEFAULT_PROVIDER): void {
  const version = useSyncExternalStore(subscribeGame, gameVersion, gameVersion)

  const journal = useRef<EventJournal>(null as unknown as EventJournal)
  const alerts = useRef<AlertBroker>(null as unknown as AlertBroker)
  const jobs = useRef<JobStore>(null as unknown as JobStore)
  if (journal.current === null) {
    journal.current = new EventJournal()
    alerts.current = new AlertBroker()
    jobs.current = new JobStore()
    jobs.current.load()
    // Anything left running belonged to a process that is gone. Resolving it
    // here, once, is what keeps a restart honest rather than leaving records
    // claiming a worker that does not exist.
    jobs.current.recoverInterrupted(new Date().toISOString())
  }

  const ingested = useRef(0)
  const seenDropped = useRef(0)
  const missed = useRef(0)
  const everConnected = useRef(false)
  const lastReviewAt = useRef<number | null>(null)
  const lastHash = useRef<string | null>(null)
  const running = useRef(false)
  const ticks = useRef(0)

  // Ingestion. Keyed on the version counter; the buffer is read inside the
  // effect and never appears in the dependency array.
  useEffect(() => {
    if (!enabled) return
    const lines = gameLines()
    const dropped = gameDropped()
    const result = ingestLines(journal.current, lines, ingested.current, dropped, seenDropped.current)
    ingested.current = result.ingested
    seenDropped.current = dropped
    missed.current += result.missed
  }, [enabled, version])

  // Alerts from parsed state. Subscribed to the store rather than selected
  // out of it: this runs at the app root, where a selector would re-render the
  // whole tree on every status frame.
  useEffect(() => {
    if (!enabled) return
    const pass = () => {
      const { character, bridgeConnected } = useAppStore.getState()
      if (bridgeConnected) everConnected.current = true
      const now = Date.now()
      for (const a of deriveAlerts({
        situation: character?.situation,
        bridgeConnected,
        everConnected: everConnected.current,
      })) {
        alerts.current.raise(a.priority, a.key, a.detail, now)
      }
    }
    pass()
    return useAppStore.subscribe(pass)
  }, [enabled])

  // The turn loop.
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const controller = new AbortController()

    const tick = async () => {
      // One turn at a time. Overlapping turns would let two workers read the
      // same cursor and one of them acknowledge work the other did.
      if (running.current || cancelled) return
      running.current = true
      ticks.current += 1
      try {
        const { character, bridgeConnected } = useAppStore.getState()
        const situation = character?.situation ?? []
        const activity: Activity = !bridgeConnected
          ? 'disconnected'
          : situation.includes('in_combat')
            ? 'combat'
            : 'active'

        const hash = JSON.stringify({ s: situation, r: character?.roundtime ?? 0 })
        const outcome: WorkerOutcome = await runWorkerOnce(
          {
            journal: journal.current,
            alerts: alerts.current,
            jobs: jobs.current,
            provider,
            activity,
            now: Date.now(),
            nowIso: new Date().toISOString(),
            lastReviewAt: lastReviewAt.current,
            stateHash: hash,
            lastReviewedHash: lastHash.current,
            instructions: 'Review the recent event delta and report notable changes.',
          },
          controller.signal
        )

        if (outcome.did === 'review') {
          lastReviewAt.current = Date.now()
          if (outcome.result.ok) lastHash.current = hash
        }

        if (cancelled) return
        const health = provider.describe()
        const byStatus: Record<string, number> = {}
        for (const job of jobs.current.all()) byStatus[job.status] = (byStatus[job.status] ?? 0) + 1
        const failure =
          outcome.did === 'review' || outcome.did === 'background-job'
            ? outcome.result.ok
              ? null
              : `${outcome.result.failure}: ${outcome.result.message}`
            : null

        publishStatus({
          available: health.available,
          providerReason: health.reason,
          journalPending: journal.current.pending(),
          journalLost: journal.current.stats().lost,
          missedLines: missed.current,
          pendingAlerts: alerts.current.pendingCount(),
          jobs: byStatus,
          lastOutcome: outcome.did,
          lastFailure: failure,
          ticks: ticks.current,
        })
      } finally {
        running.current = false
      }
    }

    const timer = setInterval(() => void tick(), TICK_MS)
    return () => {
      cancelled = true
      // Cancels any generation in flight. The worker treats that as
      // `cancelled`, which never advances a cursor or completes a job.
      controller.abort()
      clearInterval(timer)
    }
  }, [enabled, provider])
}
