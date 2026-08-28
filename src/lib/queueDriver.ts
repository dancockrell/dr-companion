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
  sendCommand: (command: string) => void
  /** Launch a script by name. Fire-and-forget — the queue does not wait for
   *  it to finish before moving on; see the module comment on why. */
  startScript: (name: string) => void
  /** Called whenever the running index or status changes, for the UI. */
  onChange: (state: QueueState) => void
  log: (line: string) => void
}

export type QueueStatus = 'idle' | 'running' | 'done' | 'stopped'

export interface QueueState {
  status: QueueStatus
  /** Index into the item list last acted on, or -1 before anything has run. */
  index: number
  total: number
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

  constructor(hooks: QueueDriverHooks) {
    this.hooks = hooks
  }

  start(items: QueueItem[]): void {
    this.dispose()
    if (items.length === 0) return
    this.items = items
    this.index = -1
    this.status = 'running'
    this.hooks.log(`Queue: ${items.length} item${items.length === 1 ? '' : 's'} started`)
    this.advance()
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
    if (this.status !== 'running') return
    this.clearTimer()
    this.status = 'stopped'
    this.hooks.log('Queue: stopped')
    this.notify()
  }

  current(): QueueState {
    return { status: this.status, index: this.index, total: this.items.length }
  }

  currentItem(): QueueItem | null {
    return this.status === 'running' ? (this.items[this.index] ?? null) : null
  }

  dispose(): void {
    this.clearTimer()
    this.items = []
    this.index = -1
    this.status = 'idle'
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

  private advance(): void {
    if (this.status !== 'running') return
    this.index += 1
    if (this.index >= this.items.length) {
      this.status = 'done'
      this.hooks.log('Queue: finished')
      this.notify()
      return
    }

    const item = this.items[this.index]
    if (item.kind === 'command') this.hooks.sendCommand(item.value)
    else this.hooks.startScript(item.value)
    this.notify()

    this.timer = setTimeout(() => {
      this.timer = null
      this.advance()
    }, STEP_DELAY_MS)
  }
}
