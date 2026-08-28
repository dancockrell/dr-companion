/**
 * The signals that reach a running flow from outside its own panel.
 *
 * Stop/Pause/Resume are window-level controls (SafetyFooter) and the flow
 * driver is deliberately local to TaskFlowPanel — see flowDriver.ts's header
 * comment: one instance owns one timer, and there is exactly one place that
 * can schedule the next step. That invariant rules out lifting the driver,
 * or even a handle to it, into the store.
 *
 * What crosses instead is a plain notification with no state and nothing to
 * schedule: call `requestStopAll()` (or Pause's, or Resume's) and every
 * current subscriber's callback runs once, synchronously. Nothing here holds
 * a timer, and nothing here decides what a subscriber does in response —
 * that stays FlowDriver's job, called from the one place that already owns
 * the instance. One factory, three independent channels, so Pause firing
 * never also fires Stop's subscribers or vice versa.
 */
type Listener<T> = (payload: T) => void

function createSignal<T = void>() {
  const listeners = new Set<Listener<T>>()
  return {
    /** Subscribe. Returns the unsubscribe function. */
    on(listener: Listener<T>): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    /** Runs every current subscriber once, synchronously. */
    request(payload: T): void {
      for (const listener of listeners) listener(payload)
    },
  }
}

const stopAll = createSignal()
const pauseAll = createSignal()
const resumeAll = createSignal()
// Carries a flow id, so the Command Palette (or any future caller outside
// TaskFlowPanel) can start a specific flow without a handle to the driver —
// same reasoning as the three above, extended to the one verb they didn't
// cover.
const startFlow = createSignal<string>()

export const onStopAll = stopAll.on
export const requestStopAll = () => stopAll.request()

export const onPauseAll = pauseAll.on
export const requestPauseAll = () => pauseAll.request()

export const onResumeAll = resumeAll.on
export const requestResumeAll = () => resumeAll.request()

export const onStartFlow = startFlow.on
export const requestStartFlow = (flowId: string) => startFlow.request(flowId)
