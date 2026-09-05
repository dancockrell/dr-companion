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
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import {
  gameDropped,
  gameLines,
  gameVersion,
  streamCharacterState,
  subscribeGame,
} from './gameLink'
import { useAppStore } from '../store/useAppStore'
import { AlertBroker } from './aiAlertBroker.ts'
import { EventJournal, seedJournalCursor } from './aiEventJournal.ts'
import { ClaimStore } from './aiClaimStore.ts'
import { EvidenceStore } from './aiEvidenceStore.ts'
import { detectExitDivergence, proposeMapReconciliation } from './aiJobProducers.ts'
import { JobStore } from './aiJobStore.ts'
import { readJSON, writeJSON } from './storage.ts'
import { publishPresentationEvent } from './viewerClient.ts'
import { absentProvider, type ModelHealth, type ModelProvider } from './aiModelProvider.ts'
import { localProvider, type LocalModelProvider } from './aiLocalProvider.ts'
import {
  deriveAlerts,
  ingestLines,
  situationChanges,
  readPrivacyOptIn,
  runHostTick,
  sameStatus,
  type AiWorkerStatus,
  type HostMemory,
} from './aiIngest.ts'

export type { AiWorkerStatus } from './aiIngest.ts'

const INITIAL_STATUS: AiWorkerStatus = {
  available: false,
  lastFailureKind: null,
  lastReview: null,
  journalPending: 0,
  journalLost: 0,
  missedLines: 0,
  pendingAlerts: 0,
  jobs: {},
  lastOutcome: null,
  lastFailure: null,
  ticks: 0,
  unreviewedWithoutModel: 0,
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

/**
 * How often a tick count alone is worth telling anybody about.
 *
 * `ticks` changes every second by definition, so publishing it unconditionally
 * would re-render every watcher once a second forever on a client with nothing
 * happening - which is the ordinary state. It is still published periodically
 * because it is the only field that can distinguish a live host from a dead
 * one, and a number that stopped moving is exactly what somebody debugging
 * this needs to see.
 */
const TICKS_PER_IDLE_PUBLISH = 5

function publishStatus(next: AiWorkerStatus): void {
  if (sameStatus(currentStatus, next) && next.ticks % TICKS_PER_IDLE_PUBLISH !== 0) return
  currentStatus = next
  // Copied before iterating: a listener that unsubscribes while being notified
  // would otherwise mutate the set mid-loop.
  for (const listener of [...statusListeners]) listener()
}

/**
 * The claim store the host built, for anything that needs to read or review
 * candidates.
 *
 * Module-level and single, for the same reason the status store above is: a
 * panel that built its own `ClaimStore` over the same key would be a second
 * in-memory copy of one record set, and the two would disagree the moment
 * either wrote. One store, one owner, and a subscription so a reviewer's
 * Accept is visible without polling.
 *
 * Null until a host has mounted. A panel must render that as "not running
 * yet" rather than as "no claims", because those are different facts.
 */
let claimStore: ClaimStore | null = null
const claimListeners = new Set<() => void>()
let claimRevision = 0

export function getAiClaimStore(): ClaimStore | null {
  return claimStore
}

/** Changes with every claim write, so `useSyncExternalStore` has a snapshot
 * that is a primitive rather than a store whose identity never changes. */
export function aiClaimRevision(): number {
  return claimRevision
}

export function subscribeAiClaims(listener: () => void): () => void {
  claimListeners.add(listener)
  return () => {
    claimListeners.delete(listener)
  }
}

/** Say that the claims changed. Called by the host after a turn that produced
 * any, and by a reviewer after Accept, Reject, Promote or Revert. */
export function publishAiClaimsChanged(): void {
  claimRevision += 1
  for (const listener of [...claimListeners]) listener()
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
 * Where the model server address lives.
 *
 * One string, written only when a person types one in. An install that never
 * touches it has no such key, which is exactly the state `absentProvider()`
 * describes and the state almost every install stays in.
 */
const PROVIDER_URL_KEY = 'drc.ai-provider.v1'

/** The stored address, or null. Trimmed, because a pasted URL usually has a
 * space on the end and a stored empty string is not a configuration. */
export function readProviderUrl(): string | null {
  try {
    const raw = globalThis.localStorage?.getItem(PROVIDER_URL_KEY)
    const trimmed = raw?.trim()
    return trimmed ? trimmed : null
  } catch {
    // Storage can be unavailable, and an AI setting is never a reason to
    // take the client down.
    return null
  }
}

/**
 * Store, or clear when given nothing.
 *
 * Returns the value that is now stored so a caller does not have to re-read
 * to find out what its own write did.
 */
export function writeProviderUrl(url: string | null): string | null {
  const trimmed = url?.trim() ?? ''
  try {
    if (trimmed) globalThis.localStorage?.setItem(PROVIDER_URL_KEY, trimmed)
    else globalThis.localStorage?.removeItem(PROVIDER_URL_KEY)
  } catch {
    return readProviderUrl()
  }
  providerRevision++
  for (const listener of [...providerListeners]) listener()
  return trimmed ? trimmed : null
}

/**
 * A counter that changes when the stored address does.
 *
 * The panel writes the address and the host builds the provider, and they are
 * in different components with no parent between them, so the host has to
 * hear about the write. Subscribing to a revision number rather than to the
 * string keeps `useSyncExternalStore`'s snapshot stable - a getter returning a
 * fresh string every call is an infinite render loop.
 */
let providerRevision = 0
const providerListeners = new Set<() => void>()

export function subscribeProviderUrl(listener: () => void): () => void {
  providerListeners.add(listener)
  return () => {
    providerListeners.delete(listener)
  }
}

export function getProviderRevision(): number {
  return providerRevision
}

/**
 * Build the provider the stored setting asks for.
 *
 * No address means `absentProvider()`, which is the default and stays the
 * default: this function is the only thing in the app that can produce
 * anything else, and it needs a person to have typed a URL first. `allowRemote`
 * is deliberately not passed - a stored address off this machine is refused by
 * `localProvider` itself, with a reason the panel shows.
 */
export function buildProvider(url: string | null): ModelProvider {
  if (!url) return DEFAULT_PROVIDER
  return localProvider({ baseUrl: url })
}

/**
 * The provider the host is currently running, for the panel's "Test
 * connection" button.
 *
 * The button has to probe the same object the worker uses, or it would report
 * on a second provider built for the occasion - which could answer while the
 * real one was pointed somewhere else, and a test that passes for a thing
 * nobody is using is worse than no test.
 */
let activeProvider: ModelProvider = DEFAULT_PROVIDER

export function getActiveProvider(): ModelProvider {
  return activeProvider
}

/**
 * Probe now and publish the result.
 *
 * Asynchronous on purpose and never called from a render: `describe()` is the
 * render path and stays synchronous. A provider with no `refresh` - the
 * absent one - simply reports what it already says.
 */
export async function testProviderConnection(): Promise<ModelHealth> {
  const provider = activeProvider as Partial<LocalModelProvider> & ModelProvider
  const health = typeof provider.refresh === 'function' ? await provider.refresh() : provider.describe()
  publishStatus({ ...currentStatus, available: health.available, providerReason: health.reason })
  return health
}

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
export function useAiWorkerHost(enabled: boolean, override?: ModelProvider): void {
  const version = useSyncExternalStore(subscribeGame, gameVersion, gameVersion)

  // Rebuilt only when the stored address changes, never on a render: the tick
  // effect depends on the provider, and a new object each render tore the
  // effect down and aborted any generation in flight (trap 6).
  const revision = useSyncExternalStore(
    subscribeProviderUrl,
    getProviderRevision,
    getProviderRevision
  )
  const derived = useMemo(
    () => (override ? null : buildProvider(readProviderUrl())),
    // `revision` is the dependency that matters; reading the URL inside keeps
    // the snapshot a stable number rather than a fresh string every call.
    [override, revision]
  )
  const provider = override ?? derived ?? DEFAULT_PROVIDER
  activeProvider = provider

  // A replaced provider owns a probe interval. Stopping it here rather than
  // leaving it to be collected is the difference between one timer and one
  // per address the person tried.
  useEffect(
    () => () => {
      ;(derived as Partial<LocalModelProvider> | null)?.stop?.()
    },
    [derived]
  )

  const journal = useRef<EventJournal>(null as unknown as EventJournal)
  const alerts = useRef<AlertBroker>(null as unknown as AlertBroker)
  const jobs = useRef<JobStore>(null as unknown as JobStore)
  const evidence = useRef<EvidenceStore>(null as unknown as EvidenceStore)
  const claims = useRef<ClaimStore>(null as unknown as ClaimStore)
  if (journal.current === null) {
    journal.current = new EventJournal()
    // A remount inside one run must not re-review everything already seen.
    // Ignored outright when the stored cursor belongs to a previous process,
    // because sequence numbers restart and that cursor names other events.
    seedJournalCursor(journal.current)
    alerts.current = new AlertBroker()
    // Constructed before the job store, because that store pins through it.
    // Without this the evidence store would be a module nothing builds, and a
    // job's inputRefs would go on dangling the moment the journal evicted -
    // which is the defect G0 exists to close, not a feature waiting for a
    // caller.
    evidence.current = new EvidenceStore({ source: journal.current })
    evidence.current.load()
    jobs.current = new JobStore({ evidence: evidence.current })
    jobs.current.load()
    // Candidates, kept where they cannot become canonical data. The storage
    // functions are handed in rather than imported by that module, so its own
    // import list stays short enough for its source check to be worth
    // asserting - see aiClaimStore.ts's constructor comment.
    claims.current = new ClaimStore({
      evidence: evidence.current,
      storage: { read: readJSON, write: writeJSON },
    })
    claims.current.load()
    claimStore = claims.current
    publishAiClaimsChanged()
    // Anything left running belonged to a process that is gone. Resolving it
    // here, once, is what keeps a restart honest rather than leaving records
    // claiming a worker that does not exist.
    jobs.current.recoverInterrupted(new Date().toISOString())
  }

  const ingested = useRef(0)
  const seenDropped = useRef(0)
  const everConnected = useRef(false)
  const running = useRef(false)
  // What the host remembers between turns. A ref rather than state: nothing
  // here should cause a render, and `runHostTick` owns advancing it.
  const memory = useRef<HostMemory>({
    lastReviewAt: null,
    lastReviewedHash: null,
    ticks: 0,
    missedLines: 0,
    roomChangedAt: null,
    lastAppendAt: null,
  })
  const lastRoomId = useRef<number | null>(null)
  /** The situation flags the viewer has already been told about. Compared
   * rather than re-published, because an event stream that repeated itself
   * every pass would be a status change per store update. */
  const lastSituation = useRef<readonly string[]>([])
  /** The room-and-compass pair the exit check last saw. Its only job is to
   * keep that check off the hot path of a store subscription that fires
   * several times a second. */
  const lastExitSignature = useRef<string | null>(null)

  // Ingestion. Keyed on the version counter; the buffer is read inside the
  // effect and never appears in the dependency array.
  useEffect(() => {
    if (!enabled) return
    const lines = gameLines()
    const dropped = gameDropped()
    const result = ingestLines(journal.current, lines, ingested.current, dropped, seenDropped.current)
    ingested.current = result.ingested
    seenDropped.current = dropped
    memory.current.missedLines += result.missed
    // Only a real append counts. A version bump with nothing new in it is a
    // buffer that trimmed or a stream that reconnected, and treating either
    // as activity would keep a dead session out of `idle` forever.
    if (result.appended > 0) memory.current.lastAppendAt = Date.now()
  }, [enabled, version])

  // Alerts from parsed state. Subscribed to the store rather than selected
  // out of it: this runs at the app root, where a selector would re-render the
  // whole tree on every status frame.
  useEffect(() => {
    if (!enabled) return
    const pass = () => {
      const { character, bridgeConnected, mapHere } = useAppStore.getState()
      if (bridgeConnected) everConnected.current = true
      const now = Date.now()

      // The map is the honest source for "somewhere else": location.roomId can
      // be absent on rooms the map does not know, and a null-to-null step
      // would then read as movement. First sighting is not a change.
      const roomId = mapHere?.id ?? null
      if (roomId !== lastRoomId.current) {
        if (lastRoomId.current !== null) memory.current.roomChangedAt = now
        lastRoomId.current = roomId
      }

      // What the viewer is told, from the same already-parsed flags the alerts
      // come from. `publish_presentation_event` has existed on the Rust side
      // since the bridge was written and nothing called it; this is the
      // caller. Fire-and-forget on purpose: a viewer that is not running
      // makes the native call throw, and a status change nobody can see must
      // not break the host's pass over the alerts.
      const situation = character?.situation ?? []
      for (const change of situationChanges(lastSituation.current, situation)) {
        void publishPresentationEvent({
          kind: 'status-change',
          roomId: roomId === null ? '' : `room:${roomId}`,
          authoritativeText: change.flag,
        }).catch(() => {})
      }
      lastSituation.current = situation

      const derived = deriveAlerts({
        situation: character?.situation,
        bridgeConnected,
        everConnected: everConnected.current,
      })
      for (const a of derived) {
        alerts.current.raise(a.priority, a.key, a.detail, now)
      }
      // What is still true, told to the broker on every pass. Without this a
      // handled condition stays suppressed after it has ended, so its next
      // occurrence - a second stun, minutes later - would never be raised.
      alerts.current.reconcile(derived.map((a) => a.key))

      // Does the map agree with the game about the way out of here?
      //
      // Both sides are already parsed by their own owners: `mapHere.moves` is
      // the cartographer's own list, and the compass is the game telling a
      // frontend that declared the `xml` capability which bearings exist.
      // Guarded on the pair actually changing, because this pass runs on every
      // store update and re-deciding an unchanged room several times a second
      // is work with no possible new answer in it.
      const compass = streamCharacterState().compass?.value ?? null
      const signature = `${roomId ?? 'none'}|${compass ? compass.join(',') : 'none'}`
      if (signature !== lastExitSignature.current) {
        lastExitSignature.current = signature
        const newest = journal.current.stats().newestAppended
        if (mapHere && roomId !== null && compass) {
          proposeMapReconciliation({
            jobs: jobs.current,
            roomId: `room:${roomId}`,
            divergence: detectExitDivergence(
              { exits: (mapHere.moves ?? []).map((move) => ({ move })) },
              compass
            ),
            // The newest event stands for "the state at the moment this was
            // noticed". Omitted rather than faked when nothing has been
            // journalled yet: `event:0` names no event, and a job citing it
            // would carry provenance that cannot resolve.
            evidenceSeqs: newest > 0 ? [newest] : [],
            now: new Date().toISOString(),
          })
        }
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
      try {
        // Read once, here, and hand the turn a snapshot. The turn awaits a
        // generation, and state read on the far side of that await would
        // belong to a different world than the decision that started it.
        const claimsBefore = claims.current.all().length
        const { character, bridgeConnected } = useAppStore.getState()
        const status = await runHostTick({
          journal: journal.current,
          alerts: alerts.current,
          jobs: jobs.current,
          provider,
          app: {
            situation: character?.situation,
            roundtime: character?.roundtime,
            bridgeConnected,
            roomId: character?.location.roomId,
            roomCombatants: character?.roomCombatants,
            isTown: character?.location.isTown,
          },
          // Read per turn rather than once: a person turning a source on
          // should not have to restart the client to see it take effect.
          privacyOptIn: readPrivacyOptIn(),
          claims: claims.current,
          evidence: evidence.current,
          // The map's own answer to "is this a room", read at the moment the
          // turn starts. A model proposing a tether from a room the
          // cartographer has never heard of is proposing about nothing.
          knownRoom: (roomId) =>
            (useAppStore.getState().mapZone?.rooms ?? []).some(
              (room) => `room:${room.id}` === roomId
            ),
          memory: memory.current,
          now: Date.now(),
          nowIso: new Date().toISOString(),
          signal: controller.signal,
          previous: currentStatus,
        })

        if (cancelled) return
        publishStatus(status)
        // Only when a turn actually wrote one. A revision bump every second
        // would re-render the review panel forever on an idle client.
        if (claimsBefore !== claims.current.all().length) publishAiClaimsChanged()
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
