/**
 * The effectful half of running a flow.
 *
 * flowRunner.ts is the state machine and has no timers or I/O in it. This is
 * everything that machine deliberately does not know about: sending a step,
 * waiting out its settle time, and stopping cleanly when the player says so or
 * when the bridge goes away.
 *
 * Kept out of the store because a driver holding a live timer is the part that
 * leaks. One instance owns one timer, `dispose` always clears it, and there is
 * exactly one place that can schedule the next step.
 */
import {
  advance,
  begin,
  currentStep,
  fail,
  isFinished,
  stop,
  waiting,
  type FlowState,
} from './flowRunner.ts'
import type { TaskFlow } from '../data/taskFlows'

export interface FlowDriverHooks {
  /** Send a step's commands. Returns false if it could not go out. */
  send: (commands: string[]) => boolean
  /** Called on every state change, for the UI. */
  onChange: (state: FlowState) => void
  /** For the log. */
  log: (line: string) => void
}

export class FlowDriver {
  private state: FlowState | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  // Declared rather than a constructor parameter property: the project builds
  // with erasableSyntaxOnly, which rules those out because they emit code.
  private hooks: FlowDriverHooks

  constructor(hooks: FlowDriverHooks) {
    this.hooks = hooks
  }

  start(flow: TaskFlow): void {
    // Starting a flow while one runs replaces it rather than stacking. Two
    // flows driving one character is never what anybody meant, and the second
    // press is a correction, not a request for both.
    this.dispose()
    this.state = begin(flow)
    this.hooks.log(`Flow: ${flow.title} started`)
    this.push()
  }

  stop(): void {
    if (!this.state || isFinished(this.state)) return
    this.clearTimer()
    this.state = stop(this.state)
    this.hooks.log(`Flow: ${this.state.flow.title} stopped`)
    this.hooks.onChange(this.state)
  }

  /**
   * The bridge went away mid-flow.
   *
   * A failure rather than a stop, because the player did not ask for this and
   * the difference is the whole content of the message they need to read.
   */
  interrupt(reason: string): void {
    if (!this.state || isFinished(this.state)) return
    this.clearTimer()
    this.state = fail(this.state, reason)
    this.hooks.log(`Flow: ${this.state.flow.title} stopped — ${reason}`)
    this.hooks.onChange(this.state)
  }

  current(): FlowState | null {
    return this.state
  }

  /** Always clears the timer. Called on stop, on replace, and on unmount. */
  dispose(): void {
    this.clearTimer()
    this.state = null
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /** Send the current step, then schedule the next. */
  private push(): void {
    if (!this.state) return
    const step = currentStep(this.state)
    if (!step) {
      this.hooks.onChange(this.state)
      return
    }

    this.hooks.onChange(this.state)

    const ok = this.hooks.send(step.commands)
    if (!ok) {
      this.state = fail(this.state, 'the bridge would not take the commands')
      this.hooks.log(`Flow: ${this.state.flow.title} stopped — bridge refused`)
      this.hooks.onChange(this.state)
      return
    }

    // The bridge waits out roundtime for the commands themselves, so the only
    // wait owned here is the step's own settle time. A floor of 600ms keeps a
    // loop of instant steps from spinning faster than the game can answer.
    const delay = Math.max(600, (step.settle ?? 0) * 1000)
    this.state = waiting(this.state)
    this.timer = setTimeout(() => {
      this.timer = null
      if (!this.state || isFinished(this.state)) return
      this.state = advance(this.state)
      if (isFinished(this.state)) {
        this.hooks.log(`Flow: ${this.state.flow.title} finished`)
        this.hooks.onChange(this.state)
        return
      }
      this.push()
    }, delay)
  }
}
