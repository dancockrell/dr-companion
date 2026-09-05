/**
 * The one place a model-authored command can become a command the game runs.
 *
 * Everything else in Lane G produces *candidates*: claims, patches, tether
 * proposals, notes. None of them can reach `gameActions.ts`, and each of their
 * tests reads its own module's source to prove it. This module is the single
 * deliberate exception, and it exists so that the exception is one function in
 * one file with one import rather than a habit spread across the worker.
 *
 * The record is the 5 September implementation handoff's §36. Its shape is
 * kept, including the names: `requestSuggestionExecution` becomes
 * `requestExecution` on the store, `userConfirmation` becomes
 * `SuggestionConfirmation`, and every `REQUIRE` there is a refusal here.
 *
 * # What the gate actually promises
 *
 * A string reaches `send` only when **all** of these were true at the moment
 * of the call, checked here rather than in the panel:
 *
 * 1. the suggestion exists and is `pending`;
 * 2. `expiresAt` is still in the future;
 * 3. the confirmation names this suggestion's id;
 * 4. `confirmation.commandText` is byte-identical to `exactCommand` - the
 *    player confirms the literal command, never a summary of it;
 * 5. the authoritative state version is still the one the suggestion was
 *    based on;
 * 6. nothing else is already `awaiting_result`;
 * 7. the command policy admits this `commandType` in this context, which
 *    includes not being paused.
 *
 * The panel checks none of these on the gate's behalf. A UI check is a
 * convenience for the player; this is the check, and `tools/ai-suggestions-test.mjs`
 * exercises every refusal with the panel absent entirely.
 *
 * # Why the policy defaults to observation only
 *
 * `defaultCommandPolicy` admits `look`, `assess`, `appraise`, `analyze` and
 * `inventory`, and nothing else. That is not a guess at what is safe: it is
 * exactly the class of command the client already sends without any
 * confirmation at all, from the item rows in `InventoryPanel.tsx`, the actor
 * cards in `CombatRadar.tsx` and the ground list in `FloorItems.tsx`. A model
 * proposal that can do no more than those buttons can do is a proposal whose
 * worst case the app already accepts. Movement, combat and trade are in the
 * vocabulary so a producer can declare them honestly and the gate can refuse
 * them by name; widening the policy is a separate, visible decision.
 *
 * # Pause is checked here because it is not checked below here
 *
 * `src-tauri/src/pause.rs` says it plainly: the gate is in the script-API
 * dispatch path only, and `game_link::game_send` called from the frontend is
 * untouched. That is right for what the player types. It means a confirmed
 * suggestion would sail past Pause, so the policy refuses while paused and a
 * test holds it to that.
 *
 * # Nothing here is persisted, on purpose
 *
 * A suggestion is valid for seconds and is bound to a state version that does
 * not survive a reload. Writing one to storage would mean a command proposed
 * before a restart could be sitting on screen after it, which is the one thing
 * expiry exists to prevent. The store is in memory and starts empty.
 */
import { requestGameAction } from './gameActions.ts'
import { validateGameActionCommand } from './gameCommand.ts'
import { isAutomationPaused, onStopAll } from './flowStop.ts'
import { currentStateVersion, onStateVersionChange } from './stateVersion.ts'

export type SuggestionStatus =
  | 'pending'
  | 'confirmed'
  | 'expired'
  | 'rejected'
  | 'awaiting_result'
  | 'resolved'

/**
 * The command classes a producer may declare.
 *
 * Declaring one is not permission to run it - `defaultCommandPolicy` decides
 * that. The vocabulary is wider than the policy so a refusal can name what was
 * proposed instead of reporting an unrecognised string.
 */
export type CommandType =
  | 'look'
  | 'assess'
  | 'appraise'
  | 'analyze'
  | 'inventory'
  | 'movement'
  | 'combat'
  | 'trade'
  | 'other'

export const COMMAND_TYPES: readonly CommandType[] = [
  'look',
  'assess',
  'appraise',
  'analyze',
  'inventory',
  'movement',
  'combat',
  'trade',
  'other',
]

/**
 * The command classes the shipped policy admits.
 *
 * See the header: these are the commands the client's own buttons already send
 * with no confirmation, so a suggestion limited to them cannot do anything the
 * app does not already do on a single click.
 */
export const OBSERVATION_COMMAND_TYPES: readonly CommandType[] = [
  'look',
  'assess',
  'appraise',
  'analyze',
  'inventory',
]

/**
 * The verb each declared type must actually begin with.
 *
 * Without this, `{commandType:'look', exactCommand:'sell my ring'}` passes a
 * policy that admits `look`: the declaration and the string would be free to
 * disagree, and the policy would be reading the half a producer controls
 * rather than the half that gets sent. Types with no entry here are refused by
 * the default policy anyway, so they have no verb to pin.
 */
const REQUIRED_VERB: Partial<Record<CommandType, string>> = {
  look: 'look',
  assess: 'assess',
  appraise: 'appraise',
  analyze: 'analyze',
  inventory: 'inventory',
}

export interface Suggestion {
  schemaVersion: 1
  id: string
  /** Sent verbatim or not at all. Never re-rendered, re-cased or trimmed
   * between the panel and the wire. */
  exactCommand: string
  commandType: CommandType
  /** The authoritative state version this proposal was reasoned from. */
  basedOnStateVersion: number
  /** Epoch ms. Past this, the proposal is about a world that has moved on. */
  expiresAt: number
  status: SuggestionStatus
  /** `event:<seq>` refs, non-empty. A proposal with no provenance is not
   * reviewable, and a reviewer who cannot see why cannot judge whether. */
  evidenceRefs: string[]
  createdAt: number
  /** Why it ended where it did, for anything that has to report rather than
   * guess. Null while pending. */
  reason: string | null
}

/** What the player hands back. It carries the command text so the confirmation
 * is *of a string*, not of an id whose string may have changed underneath it. */
export interface SuggestionConfirmation {
  suggestionId: string
  commandText: string
}

export interface SuggestionResult {
  ok: boolean
  suggestion?: Suggestion
  /** Present whenever `ok` is false. A refusal nobody can read is a refusal
   * nobody can act on. */
  reason?: string
}

/** The context a policy judges against. Deliberately small: everything in it
 * is a fact about the client at the moment of the confirmation. */
export interface CommandContext {
  paused: boolean
}

export interface CommandPolicy {
  allows(commandType: CommandType, context: CommandContext): { ok: boolean; reason?: string }
}

/**
 * The shipped policy: observation commands, and not while paused.
 *
 * Exported so a test can show that the gate consults it rather than
 * reimplementing it, and so that widening it later is one obvious edit in one
 * obvious place with its own diff.
 */
export const defaultCommandPolicy: CommandPolicy = {
  allows(commandType, context) {
    if (context.paused) {
      return { ok: false, reason: 'automation is paused, so no proposed command is sent' }
    }
    if (!OBSERVATION_COMMAND_TYPES.includes(commandType)) {
      return {
        ok: false,
        reason: `the command policy admits only ${OBSERVATION_COMMAND_TYPES.join(', ')}; “${commandType}” is refused`,
      }
    }
    return { ok: true }
  },
}

const ALLOWED: Record<SuggestionStatus, readonly SuggestionStatus[]> = {
  pending: ['confirmed', 'expired', 'rejected'],
  confirmed: ['awaiting_result', 'rejected'],
  awaiting_result: ['resolved'],
  expired: [],
  rejected: [],
  resolved: [],
}

export function canTransitionSuggestion(from: SuggestionStatus, to: SuggestionStatus): boolean {
  return ALLOWED[from].includes(to)
}

export const TERMINAL_SUGGESTION_STATUSES: readonly SuggestionStatus[] = [
  'expired',
  'rejected',
  'resolved',
]

export interface CreateSuggestionParams {
  exactCommand: string
  commandType: CommandType
  basedOnStateVersion: number
  expiresAt: number
  evidenceRefs: string[]
}

/**
 * What the store needs from the rest of the app.
 *
 * Injected rather than imported for the same reason `ClaimStore` injects its
 * storage: the import list of this file is short enough to be worth asserting,
 * and a test that wants to watch the boundary needs a sink it can watch. The
 * production wiring is `suggestionStore()` below, and it is the only place in
 * `src/` that constructs one - `tools/ai-suggestions-test.mjs` counts the
 * constructions to keep that true.
 */
export interface SuggestionDeps {
  /** The command boundary. Production passes `requestGameAction`. */
  send(command: string, label: string): void
  /** Epoch ms. */
  now(): number
  /** The authoritative state version, read at the moment of the check rather
   * than captured, so a version that moved during a confirmation dialog is
   * seen. */
  stateVersion(): number
  isPaused(): boolean
  policy?: CommandPolicy
}

export class SuggestionStore {
  private items = new Map<string, Suggestion>()
  private nextId = 1
  private revision = 0
  private readonly listeners = new Set<() => void>()
  private readonly deps: SuggestionDeps
  private readonly policy: CommandPolicy

  constructor(deps: SuggestionDeps) {
    this.deps = deps
    this.policy = deps.policy ?? defaultCommandPolicy
  }

  /** Changes on every write, so `useSyncExternalStore` has a primitive
   * snapshot rather than a store identity that never changes. */
  currentRevision(): number {
    return this.revision
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private publish(): void {
    this.revision += 1
    for (const listener of [...this.listeners]) listener()
  }

  get(id: string): Suggestion | undefined {
    return this.items.get(id)
  }

  all(): Suggestion[] {
    return [...this.items.values()]
  }

  byStatus(status: SuggestionStatus): Suggestion[] {
    return this.all().filter((s) => s.status === status)
  }

  /** The one a panel should render, or null. Expiry is applied first, so a
   * card cannot linger past its own deadline just because nothing polled. */
  live(): Suggestion | null {
    this.sweepExpired()
    return this.byStatus('pending')[0] ?? this.byStatus('awaiting_result')[0] ?? null
  }

  /**
   * Record a proposal. This writes data and can send nothing.
   *
   * Refusals here are about whether the proposal is *reviewable*: a command
   * the boundary would throw on, a declaration that disagrees with the string,
   * no provenance, an expiry already past, or a second proposal while one is
   * still live. Whether it may *run* is `requestExecution`'s question and is
   * asked again there.
   */
  create(params: CreateSuggestionParams): SuggestionResult {
    try {
      validateGameActionCommand(params.exactCommand)
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
    if (!COMMAND_TYPES.includes(params.commandType)) {
      return { ok: false, reason: `“${String(params.commandType)}” is not a command type` }
    }
    const verb = REQUIRED_VERB[params.commandType]
    if (verb !== undefined && params.exactCommand.trim().split(/\s+/)[0]?.toLowerCase() !== verb) {
      return {
        ok: false,
        reason: `a “${params.commandType}” suggestion must begin with “${verb}”, and this one does not`,
      }
    }
    if (params.evidenceRefs.length === 0) {
      return { ok: false, reason: 'a suggestion must cite at least one piece of evidence' }
    }
    if (!Number.isFinite(params.basedOnStateVersion)) {
      return { ok: false, reason: 'a suggestion must name the state version it was based on' }
    }
    const now = this.deps.now()
    if (params.expiresAt <= now) {
      return { ok: false, reason: 'a suggestion cannot be created already expired' }
    }
    this.sweepExpired()
    // Pending only, deliberately. §36 puts the one-at-a-time rule on
    // `awaiting_result` and puts it in the gate, not here - so a proposal made
    // while an earlier command is still in flight is *recorded* and *refused
    // at confirmation*. Refusing to record it instead would make that gate
    // check unreachable, and a branch nobody can execute on purpose is a
    // branch nobody can prove still works.
    if (this.byStatus('pending').length > 0) {
      return {
        ok: false,
        reason: 'one suggestion is already pending; a second cannot be proposed until it is answered',
      }
    }

    const suggestion: Suggestion = {
      schemaVersion: 1,
      id: `suggestion:${this.nextId++}`,
      exactCommand: params.exactCommand,
      commandType: params.commandType,
      basedOnStateVersion: params.basedOnStateVersion,
      expiresAt: params.expiresAt,
      status: 'pending',
      evidenceRefs: [...params.evidenceRefs],
      createdAt: now,
      reason: null,
    }
    this.items.set(suggestion.id, suggestion)
    this.publish()
    return { ok: true, suggestion }
  }

  private settle(suggestion: Suggestion, to: SuggestionStatus, reason: string): Suggestion {
    const next: Suggestion = { ...suggestion, status: to, reason }
    this.items.set(next.id, next)
    return next
  }

  /**
   * Move every pending suggestion whose deadline has passed to `expired`.
   *
   * Called by `live()`, by `create` and by `requestExecution`, so a client that
   * never runs a timer still cannot confirm a stale card: expiry is a fact
   * about the clock, not about whether anything looked.
   */
  sweepExpired(): number {
    const now = this.deps.now()
    let moved = 0
    for (const suggestion of this.all()) {
      if (suggestion.status !== 'pending') continue
      if (suggestion.expiresAt > now) continue
      this.settle(suggestion, 'expired', 'the suggestion expired before it was confirmed')
      moved += 1
    }
    if (moved > 0) this.publish()
    return moved
  }

  /**
   * The gate. Nothing else in this file calls `send`.
   *
   * Every refusal returns `{ok:false, reason}` and leaves the boundary
   * untouched. Refusals that mean the proposal can never become valid again -
   * expiry, a state version that moved - settle it, so a panel does not offer
   * a button that will refuse forever.
   */
  requestExecution(id: string, confirmation: SuggestionConfirmation): SuggestionResult {
    this.sweepExpired()

    const suggestion = this.items.get(id)
    if (!suggestion) return { ok: false, reason: 'no such suggestion' }

    if (suggestion.status !== 'pending') {
      return { ok: false, reason: `this suggestion is ${suggestion.status}, not pending` }
    }

    // Re-read rather than trust the sweep above: the sweep is a convenience,
    // and a gate whose expiry check lives in another method is a gate that
    // stops checking the day that method is refactored.
    if (suggestion.expiresAt <= this.deps.now()) {
      const expired = this.settle(suggestion, 'expired', 'the suggestion expired before it was confirmed')
      this.publish()
      return { ok: false, suggestion: expired, reason: 'the suggestion has expired' }
    }

    if (confirmation.suggestionId !== suggestion.id) {
      return { ok: false, reason: 'the confirmation names a different suggestion' }
    }

    if (confirmation.commandText !== suggestion.exactCommand) {
      return {
        ok: false,
        reason: 'the confirmed text is not the suggested command, so nothing was sent',
      }
    }

    if (this.deps.stateVersion() !== suggestion.basedOnStateVersion) {
      const stale = this.settle(
        suggestion,
        'rejected',
        'the game state changed after this was proposed, so it was not sent'
      )
      this.publish()
      return { ok: false, suggestion: stale, reason: 'the state it was based on is no longer current' }
    }

    if (this.byStatus('awaiting_result').length > 0) {
      return { ok: false, reason: 'another confirmed command is still awaiting its result' }
    }

    const verdict = this.policy.allows(suggestion.commandType, { paused: this.deps.isPaused() })
    if (!verdict.ok) {
      return { ok: false, reason: verdict.reason ?? 'the command policy refused this command' }
    }

    // Marked before the send, not after: if the boundary throws, the record
    // must show that this client had committed to sending it. A suggestion
    // left in `confirmed` is exactly that fact and is not silently retried.
    const confirmed = this.settle(suggestion, 'confirmed', 'confirmed by the player')
    try {
      this.deps.send(suggestion.exactCommand, 'Confirmed AI suggestion')
    } catch (error) {
      const failed = this.settle(
        confirmed,
        'rejected',
        error instanceof Error ? error.message : String(error)
      )
      this.publish()
      return { ok: false, suggestion: failed, reason: failed.reason ?? 'the command boundary refused it' }
    }
    const awaiting = this.settle(confirmed, 'awaiting_result', 'sent; awaiting the game’s own answer')
    this.publish()
    return { ok: true, suggestion: awaiting }
  }

  /** The player said no. */
  dismiss(id: string, reason = 'dismissed'): SuggestionResult {
    const suggestion = this.items.get(id)
    if (!suggestion) return { ok: false, reason: 'no such suggestion' }
    if (!canTransitionSuggestion(suggestion.status, 'rejected')) {
      return { ok: false, reason: `a ${suggestion.status} suggestion cannot be dismissed` }
    }
    const next = this.settle(suggestion, 'rejected', reason)
    this.publish()
    return { ok: true, suggestion: next }
  }

  /**
   * The authoritative state moved.
   *
   * This is the only thing that resolves a sent suggestion: the model never
   * marks its own proposal successful, and neither does the panel. A pending
   * suggestion whose basis has moved is rejected here as well, so a card the
   * gate would refuse anyway stops being offered - but the refusal the safety
   * argument rests on is the one inside `requestExecution`, which does not
   * depend on anyone having called this.
   */
  onStateVersion(version: number): void {
    let changed = false
    for (const suggestion of this.all()) {
      if (suggestion.status === 'awaiting_result') {
        this.settle(suggestion, 'resolved', 'the game answered; the authoritative state has moved on')
        changed = true
      } else if (suggestion.status === 'pending' && suggestion.basedOnStateVersion !== version) {
        this.settle(suggestion, 'rejected', 'the game state changed after this was proposed')
        changed = true
      }
    }
    if (changed) this.publish()
  }

  /**
   * Stop was pressed.
   *
   * Every pending suggestion is rejected. Anything already `awaiting_result`
   * is left alone and says so: that command is on the wire, and a record that
   * claimed Stop had recalled it would be a record of something that did not
   * happen. Stop kills the task processes; it cannot unsend a sent line.
   */
  cancelAll(reason = 'stopped by the player'): number {
    let cancelled = 0
    for (const suggestion of this.byStatus('pending')) {
      this.settle(suggestion, 'rejected', reason)
      cancelled += 1
    }
    if (cancelled > 0) this.publish()
    return cancelled
  }
}

/**
 * The one store the app uses, and the only place `requestGameAction` is wired
 * to a suggestion.
 *
 * Built lazily so that importing this module costs nothing on an install with
 * no model, and so the Stop subscription is registered exactly once, by the
 * first caller that actually needs a store.
 */
let store: SuggestionStore | null = null

export function suggestionStore(): SuggestionStore {
  if (store) return store
  store = new SuggestionStore({
    send: (command, label) => requestGameAction(command, label),
    now: () => Date.now(),
    stateVersion: () => currentStateVersion(),
    isPaused: () => isAutomationPaused(),
  })

  // Both subscriptions are made here, and neither is wiring a host could
  // forget. A gate whose freshness check depends on somebody remembering to
  // call an `attach()` is a gate that stops checking the day they do not — and
  // it would fail *closed*, which is safe and completely invisible.
  onStateVersionChange((version) => {
    store?.onStateVersion(version)
  })
  // `flowStop.ts` publishes Stop; this module consumes it. The dependency runs
  // this way round on purpose: the kill switch must load with every AI module
  // absent, and `tools/kill-switch-test.mjs` holds it to that.
  onStopAll(() => {
    store?.cancelAll()
  })

  return store
}
