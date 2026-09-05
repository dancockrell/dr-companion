/**
 * The signals that reach a running flow from outside its own panel.
 *
 * Stop/Pause/Resume are window-level controls (SafetyFooter) and the flow
 * driver is deliberately local to TaskFlowPanel — see flowDriver.ts's header
 * comment: one instance owns one timer, and there is exactly one place that
 * can schedule the next step. That invariant rules out lifting the driver,
 * or even a handle to it, into the store.
 *
 * What crosses instead is a direct request to both task backends. Stop cannot
 * depend on a panel subscriber: the Tasks and scripts panel may be hidden or
 * popped out while its Python or TypeScript process keeps running. Pause and
 * Resume retain local notification channels in addition to their Rust gate.
 *
 * # What changed when flows became Python
 *
 * The paragraph above used to end "that stays FlowDriver's job". There is no
 * FlowDriver any more — a task is a separate process, so nothing in the
 * frontend holds a timer that could get out of step with what is running.
 *
 * Stop kills that process. Pause and Resume flip a gate in Rust at the
 * script-API dispatch point, which widened them considerably: they used to
 * reach only the flows this app shipped, and now they hold every automated
 * command, including scripts this app never started.
 */
import { setPaused, stopTask } from './pythonTasks.ts'
import { stopNodeTask } from './nodeTasks.ts'
import { stopAllTaskBackends } from './stopAllTasks.ts'

type Listener<T> = (payload: T) => void

function createSignal<T = void>() {
  const listeners = new Set<Listener<T>>()
  return {
    /** Subscribe. Returns the unsubscribe function. */
    on(listener: Listener<T>): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    /**
     * Runs every current subscriber once, synchronously.
     *
     * A subscriber that throws is reported and skipped rather than allowed to
     * abandon the rest. These four signals are Stop, Pause, Resume and Start:
     * a panel with a bug in its listener must not be able to stop the second
     * of two subscribers hearing that the player pressed Stop. The set is
     * copied first for the same reason `aiWorkerHost.ts` copies its listeners
     * - a subscriber that unsubscribes while being notified would otherwise
     * mutate the set mid-loop.
     */
    request(payload: T): void {
      for (const listener of [...listeners]) {
        try {
          listener(payload)
        } catch (error) {
          console.error('a flowStop subscriber threw and was skipped', error)
        }
      }
    },
  }
}

const pauseAll = createSignal()
const resumeAll = createSignal()
/**
 * Stop, as a signal as well as an action.
 *
 * Stop's whole job used to be killing two processes, and killing a process
 * needs no subscribers. It now also has to reach things that hold state rather
 * than a pid — the first of them is the confirmation gate in
 * `aiSuggestions.ts`, which may be holding a proposed command a player is
 * looking at when they press Stop.
 *
 * A signal rather than a call, and this direction rather than the other, for a
 * reason `tools/kill-switch-test.mjs` states at length: the kill switch must
 * load and work with every optional subsystem absent. If this file imported
 * the gate, Stop would depend on the AI modules loading, which is precisely
 * backwards on the evening the AI subsystem is what went wrong.
 */
const stopAll = createSignal()
// Carries a flow id (and, since two backends can each own that id — a
// Python `task.watch` and a TypeScript `task.watch` are different
// processes — an optional language to disambiguate), so the Command Palette
// (or any future caller outside TaskFlowPanel) can start a specific flow
// without a handle to the driver — same reasoning as the three above,
// extended to the one verb they didn't cover.
const startFlow = createSignal<{ id: string; lang?: 'python' | 'typescript' }>()

/**
 * Stop both client-owned task processes without relying on mounted UI.
 *
 * `allSettled` is deliberate: one backend being absent or failing must never
 * prevent the other stop request from being attempted, and a caller that does
 * not await this safety action must not create an unhandled rejection.
 */
export function requestStopAll(): void {
  void stopAllTaskBackends(stopTask, stopNodeTask)
  // After the process stops are requested, never before: a subscriber that
  // throws must not be able to prevent the two calls this button exists for.
  stopAll.request()
}

/** Subscribe to Stop. See the `stopAll` signal above for why consumers
 * register here instead of this file calling them. */
export const onStopAll = stopAll.on

export const onPauseAll = pauseAll.on

/**
 * Pause every automated command.
 *
 * This used to be a notification and nothing more: `TaskFlowPanel` subscribed
 * and told `FlowDriver` to stop scheduling. That paused the seven flows the app
 * shipped and nothing else — a hand-written Lich script, or anything else
 * holding a script-API socket, went straight past it.
 *
 * It now also flips a gate in Rust at the script-API dispatch point, which is
 * the one line every automated command crosses, so Pause holds all of them.
 * Commands are delayed rather than dropped, and what the player types is never
 * gated. See `src-tauri/src/pause.rs`.
 *
 * The signal still fires for any local subscriber, so this remains the single
 * thing a caller has to know about.
 */
export const requestPauseAll = () => {
  paused = true
  void setPaused(true)
  pauseAll.request()
}

export const onResumeAll = resumeAll.on

export const requestResumeAll = () => {
  paused = false
  void setPaused(false)
  resumeAll.request()
}

/**
 * Whether the player has paused automation, as this window last set it.
 *
 * Kept here because this file is what flips it, so there is one owner and no
 * second copy to drift. It is a local mirror of the Rust gate rather than a
 * read of it: `set_paused` is fire-and-forget and there is no query command,
 * and a getter that awaited Rust could not be used by a synchronous check
 * anyway.
 *
 * That mirror is honest for the caller it exists for. `src-tauri/src/pause.rs`
 * states that the Rust gate covers the script-API dispatch path only and that
 * `game_link::game_send` from the frontend is untouched — so a command sent
 * through `gameActions.ts` passes no gate at all, and the confirmation gate in
 * `aiSuggestions.ts` has to do its own asking. This is what it asks.
 */
let paused = false

export function isAutomationPaused(): boolean {
  return paused
}

export const onStartFlow = startFlow.on
export const requestStartFlow = (flowId: string, lang?: 'python' | 'typescript') =>
  startFlow.request({ id: flowId, lang })
