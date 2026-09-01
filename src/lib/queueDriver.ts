/**
 * The Quick Queue: cue a command or a script, in order, run them one at a
 * time — the "on the fly" complement to Task Flows. A Task Flow is a named,
 * saved, reusable sequence; a queue is thrown together in the moment for
 * this one situation and thrown away when it's done. Same underlying idea
 * (a list of things that happen in order, one at a time), deliberately not
 * the same machinery: FlowDriver's settle/condition model is built around a
 * *saved* step's author having decided those in advance, and a queue item
 * a player just typed has neither.
 *
 * Same ownership discipline as FlowDriver and the same reason: one instance
 * owns one timer, `dispose` always clears it, and there is exactly one place
 * that can schedule the next item. Kept out of the store for the same
 * reason a live timer never belongs there.
 */
export interface QueueItem {
  id: string
  label: string
  kind: 'command' | 'script'
  /** The raw command text (kind 'command') or the script's bare name (kind 'script'). */
  value: string
}

export interface QueueDriverHooks {
  /** Send one raw command down the same path the command line uses. */
  sendCommand: (command: string) => Promise<void>
  /** Launch a script by name. Fire-and-forget — the queue does not wait for
   *  it to finish before moving on; see the module comment on why. */
  startScript: (name: string) => void | Promise<void>
  /** Called whenever the running index or status changes, for the UI. */
  onChange: (state: QueueState) => void
  log: (line: string) => void
}

export type QueueStatus = 'idle' | 'running' | 'failed' | 'done' | 'stopped'

export interface QueueState {
  status: QueueStatus
  /** Index into the item list last acted on, or -1 before anything has run. */
  index: number
  total: number
  /** Present only while the current item is stopped on a dispatch failure. */
  error?: string
}

/** Floor between items, same value and same reason as FlowDriver's: nothing
 *  here waits out roundtime itself (script starts and raw sends both go
 *  through paths that already do, or do not need to), this only keeps a
 *  queue of instant items from firing faster than the game — or the
 *  player's own eyes — can keep up with. */
const STEP_DELAY_MS = 600

export class QueueDriver {
  private items: QueueItem[] = []
  private index = -1
  private status: QueueStatus = 'idle'
  private timer: ReturnType<typeof setTimeout> | null = null
  private hooks: QueueDriverHooks
  private generation = 0
  private error: string | undefined
  private stepDelayMs: number

  constructor(hooks: QueueDriverHooks, stepDelayMs = STEP_DELAY_MS) {
    this.hooks = hooks
    this.stepDelayMs = stepDelayMs
  }

  start(items: QueueItem[]): void {
    this.dispose()
    if (items.length === 0) return
    this.items = items
    this.index = -1
    this.status = 'running'
    this.error = undefined
    const generation = ++this.generation
    this.hooks.log(`Queue: ${items.length} item${items.length === 1 ? '' : 's'} started`)
    void this.advance(generation)
  }

  /**
   * Clearing the timer here and the `status !== 'running'` guard at the top
   * of `advance()` are deliberately redundant, not belt-and-suspenders for
   * its own sake — verified by sabotaging them one at a time (each alone
   * left the test green, since either one independently stops the leak) and
   * then together, which reproduced it: the remaining two items fired on
   * schedule after Stop. Removing the "redundant" one is removing real
   * coverage for the case the other one does not reach — e.g. a future
   * caller of `advance()` that does not come through the timer.
   */
  stop(): void {
    if (this.status !== 'running' && this.status !== 'failed') return
    this.generation++
    this.clearTimer()
    this.status = 'stopped'
    this.error = undefined
    this.hooks.log('Queue: stopped')
    this.notify()
  }

  current(): QueueState {
    return { status: this.status, index: this.index, total: this.items.length, ...(this.error ? { error: this.error } : {}) }
  }

  currentItem(): QueueItem | null {
    return this.status === 'running' || this.status === 'failed'
      ? (this.items[this.index] ?? null)
      : null
  }

  /** Retry the item that failed without replaying successful prerequisites. */
  retry(): void {
    if (this.status !== 'failed') return
    this.status = 'running'
    this.error = undefined
    this.index -= 1
    const generation = ++this.generation
    this.notify()
    void this.advance(generation)
  }

  /** Deliberately waive the failed item and continue with what remains. */
  skip(): void {
    if (this.status !== 'failed') return
    this.status = 'running'
    this.error = undefined
    const generation = ++this.generation
    this.hooks.log('Queue: failed item skipped')
    this.notify()
    this.timer = setTimeout(() => {
      this.timer = null
      void this.advance(generation)
    }, this.stepDelayMs)
  }

  dispose(): void {
    this.generation++
    this.clearTimer()
    this.items = []
    this.index = -1
    this.status = 'idle'
    this.error = undefined
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private notify(): void {
    this.hooks.onChange(this.current())
  }

  private async advance(generation: number): Promise<void> {
    if (this.status !== 'running' || generation !== this.generation) return
    this.index += 1
    if (this.index >= this.items.length) {
      this.status = 'done'
      this.hooks.log('Queue: finished')
      this.notify()
      return
    }

    const item = this.items[this.index]
    this.notify()

    try {
      if (item.kind === 'command') await this.hooks.sendCommand(item.value)
      else await this.hooks.startScript(item.value)
    } catch (error) {
      if (generation !== this.generation) return
      this.status = 'failed'
      this.error = error instanceof Error && error.message ? error.message : String(error)
      if (!this.error) this.error = 'The action was not accepted.'
      this.hooks.log(`Queue: ${item.label} failed — ${this.error}`)
      this.notify()
      return
    }

    // Stop, Clear, unmount, or a newer run may have happened while native was
    // answering. An old resolution never owns permission to schedule item 2.
    if (this.status !== 'running' || generation !== this.generation) return

    this.timer = setTimeout(() => {
      this.timer = null
      void this.advance(generation)
    }, this.stepDelayMs)
  }
}
