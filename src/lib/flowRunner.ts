/**
 * Running a task flow, as a state machine with nothing in it.
 *
 * No timers, no bridge, no React. Every transition is a function from one
 * state to the next, which is what makes a looping flow testable at all: the
 * interesting behaviour is what happens on the fortieth iteration, when a step
 * fails, or when Stop lands between two steps, and none of that is reachable
 * if the logic only exists inside a setTimeout.
 *
 * The caller owns the effects. It asks what to send, sends it, and reports
 * back what happened.
 */
import type { TaskFlow } from '../data/taskFlows'

export interface FlowState {
  flow: TaskFlow
  /** Index into flow.steps. */
  step: number
  /** Completed passes. Only meaningful for a looping flow. */
  pass: number
  status: 'running' | 'waiting' | 'paused' | 'done' | 'stopped' | 'failed'
  /** Why it stopped, when that was not the player's doing. */
  reason?: string
  /** Steps sent this run, for the progress line. */
  sent: number
}

export function begin(flow: TaskFlow): FlowState {
  return { flow, step: 0, pass: 0, status: 'running', sent: 0 }
}

/** The step about to run, or null when there is nothing left. */
export function currentStep(s: FlowState) {
  if (s.status === 'done' || s.status === 'stopped' || s.status === 'failed') return null
  return s.flow.steps[s.step] ?? null
}

/**
 * Move past the step that just completed.
 *
 * A looping flow returns to the start and counts a pass. A finite one ends,
 * and ending is a real state rather than a silent stall, because a flow that
 * quietly stops looks exactly like a flow that is stuck.
 */
export function advance(s: FlowState): FlowState {
  if (s.status !== 'running' && s.status !== 'waiting') return s

  const next = s.step + 1
  const sent = s.sent + 1

  if (next < s.flow.steps.length) return { ...s, step: next, status: 'running', sent }
  if (s.flow.loops) return { ...s, step: 0, pass: s.pass + 1, status: 'running', sent }
  return { ...s, step: s.flow.steps.length, status: 'done', sent }
}

/** The player pressed Stop. Always allowed, from any state. */
export function stop(s: FlowState): FlowState {
  if (s.status === 'done' || s.status === 'stopped') return s
  return { ...s, status: 'stopped' }
}

/**
 * A step failed.
 *
 * The whole flow stops rather than skipping on. A flow is a sequence because
 * the order matters — looting before skinning, stowing before walking — so
 * continuing past a failure runs the rest against a state that is not the one
 * the remaining steps were written for.
 */
export function fail(s: FlowState, reason: string): FlowState {
  if (s.status === 'stopped' || s.status === 'done') return s
  return { ...s, status: 'failed', reason }
}

/** Marks the flow as waiting out a step's settle time. */
export function waiting(s: FlowState): FlowState {
  return s.status === 'running' ? { ...s, status: 'waiting' } : s
}

/**
 * Held on the step it is on. Only from running or waiting — pausing a
 * flow that already finished, or is already paused, changes nothing.
 */
export function pause(s: FlowState): FlowState {
  if (s.status !== 'running' && s.status !== 'waiting') return s
  return { ...s, status: 'paused' }
}

/**
 * Carries on from the step it was held on. A no-op on anything that was not
 * paused — the caller (FlowDriver) is what turns that into "nothing to
 * resume" rather than this function pretending something happened.
 */
export function resume(s: FlowState): FlowState {
  if (s.status !== 'paused') return s
  return { ...s, status: 'running' }
}

export const isFinished = (s: FlowState) =>
  s.status === 'done' || s.status === 'stopped' || s.status === 'failed'

/**
 * The progress line.
 *
 * The thing the Activities panel never had: which part of the loop it is in.
 * A looping flow shows its pass count, because "step 2 of 4" on its own looks
 * identical on the first pass and the fortieth.
 */
export function describeFlow(s: FlowState): string {
  if (s.status === 'stopped') return `${s.flow.title} — stopped`
  if (s.status === 'failed') return `${s.flow.title} — stopped: ${s.reason ?? 'a step failed'}`
  if (s.status === 'done') return `${s.flow.title} — done`

  const step = s.flow.steps[s.step]
  const where = `${step?.label ?? 'working'} (${s.step + 1} of ${s.flow.steps.length})`
  const line = s.flow.loops ? `${where}, pass ${s.pass + 1}` : where
  // Paused reads as its own thing rather than indistinguishable from running
  // — the whole point of the bug this fixes is a bar that cannot tell the
  // player which one is actually true.
  return s.status === 'paused' ? `${line} — paused` : line
}
