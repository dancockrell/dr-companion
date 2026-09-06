/**
 * The frontend's half of the outbound command lane.
 *
 * The lane itself is `src-tauri/src/command_gate.rs`: every command bound for
 * the game enters it, is ordered by who asked, is paced against the roundtime
 * the game reports, and can be flushed by Stop. This file is three things the
 * window needs from it — the vocabulary of sources, a subscription to its
 * state, and Stop's outbound half.
 *
 * # Why Stop subscribes from here
 *
 * `flowStop.ts` publishes a signal rather than calling its consumers, for the
 * reason its own header states at length: the kill switch has to load and work
 * with every optional subsystem absent, so it must not import them. Flushing
 * the lane is a consumer like the AI gate is, and it registers the same way.
 *
 * Stop already killed two task processes and rejected every unconfirmed
 * suggestion. What it could not do was reach commands those producers had
 * *already handed over* — a walk loop's next four steps were on their way to
 * the socket and nothing could call them back. That is what this closes.
 * Player-typed commands are deliberately not flushed: Stop is a control over
 * automation, and a person who types `stand` and then presses Stop still meant
 * to stand.
 */
import { invokeTauri, listenTauri } from './tauri.ts'
import { onStopAll } from './flowStop.ts'

/**
 * Who asked for a command. The wire form the Rust side parses.
 *
 * Ordered here as the lane orders them, highest priority first, so the list
 * reads as the rule rather than as an alphabet. There is no default: see
 * `command_gate::Source::parse` for why guessing breaks one invariant or the
 * other whichever way it guesses, and `tools/command-lane-test.mjs` for the
 * check that every caller in this tree names one.
 */
export type CommandSource =
  | 'player'
  | 'ui-action'
  | 'keybind'
  | 'macro'
  | 'ai-suggestion'
  | 'script'

export interface CommandLaneStatus {
  /** Commands waiting to go out. */
  queued: number
  /** Epoch ms the roundtime hold ends, or 0 when the wire is free. */
  holdingUntilMs: number
  lastSent: string
  lastSentAtMs: number
  sent: number
  /** Duplicate movement dropped, counted rather than forgotten. */
  coalesced: number
  /** Dropped by Stop. */
  flushed: number
  /** Dropped because the queue was full. */
  overflowed: number
  paused: boolean
}

export const EMPTY_LANE_STATUS: CommandLaneStatus = {
  queued: 0,
  holdingUntilMs: 0,
  lastSent: '',
  lastSentAtMs: 0,
  sent: 0,
  coalesced: 0,
  flushed: 0,
  overflowed: 0,
  paused: false,
}

function asStatus(v: unknown): CommandLaneStatus | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.queued !== 'number') return null
  return {
    queued: o.queued,
    // A typed check rather than `||`: 0 is the ordinary value of every one
    // of these, and `||` would replace a real zero with the fallback.
    holdingUntilMs: typeof o.holdingUntilMs === 'number' ? o.holdingUntilMs : 0,
    lastSent: typeof o.lastSent === 'string' ? o.lastSent : '',
    lastSentAtMs: typeof o.lastSentAtMs === 'number' ? o.lastSentAtMs : 0,
    sent: typeof o.sent === 'number' ? o.sent : 0,
    coalesced: typeof o.coalesced === 'number' ? o.coalesced : 0,
    flushed: typeof o.flushed === 'number' ? o.flushed : 0,
    overflowed: typeof o.overflowed === 'number' ? o.overflowed : 0,
    paused: o.paused === true,
  }
}

let status: CommandLaneStatus = EMPTY_LANE_STATUS
const listeners = new Set<(s: CommandLaneStatus) => void>()
let wired = false

function publish(next: CommandLaneStatus) {
  status = next
  for (const l of [...listeners]) l(next)
}

function wire() {
  if (wired) return
  wired = true
  void listenTauri('game:lane', (payload: unknown) => {
    const next = asStatus(payload)
    if (next) publish(next)
  })
  // Asked once on mount as well as listened for, because an event fires and is
  // gone: a window opened after a queue formed would otherwise show an empty
  // lane over a real one.
  void refreshCommandLane()
}

export async function refreshCommandLane(): Promise<CommandLaneStatus> {
  const next = asStatus(await invokeTauri('game_lane_status'))
  if (next) publish(next)
  return status
}

export function commandLaneStatus(): CommandLaneStatus {
  wire()
  return status
}

export function onCommandLane(listener: (s: CommandLaneStatus) => void): () => void {
  wire()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Drop every queued automation command. Returns how many went. */
export async function flushAutomationCommands(): Promise<number> {
  const dropped = await invokeTauri('game_lane_flush')
  void refreshCommandLane()
  return typeof dropped === 'number' ? dropped : 0
}

// Registered at import, exactly once, alongside the type it belongs to.
// `SafetyFooter.tsx` is always mounted and imports this module for its lane
// readout, so the subscription is made in every window that has a Stop button;
// `tools/kill-switch-test.mjs` names this file in EXPECTED_STOP_CONSUMERS, so
// a version of it that quietly stopped subscribing fails the build rather than
// leaving Stop one consumer short in silence.
onStopAll(() => {
  void flushAutomationCommands().catch(() => {})
})
