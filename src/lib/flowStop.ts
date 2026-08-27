/**
 * The one signal that reaches a running flow from outside its own panel.
 *
 * "Stop all" is a window-level control (SafetyFooter) and the flow driver is
 * deliberately local to TaskFlowPanel — see flowDriver.ts's header comment:
 * one instance owns one timer, and there is exactly one place that can
 * schedule the next step. That invariant rules out lifting the driver, or
 * even a handle to it, into the store.
 *
 * What crosses instead is a plain notification with no state and nothing to
 * schedule: call `requestStopAll()` and every current subscriber's callback
 * runs once, synchronously. Nothing here holds a timer, and nothing here
 * decides what a subscriber does in response — that stays FlowDriver.stop()'s
 * job, called from the one place that already owns the instance.
 */
type Listener = () => void

const listeners = new Set<Listener>()

/** Subscribe to "stop all" requests. Returns the unsubscribe function. */
export function onStopAll(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Fired by the Stop all control. Runs every current subscriber once. */
export function requestStopAll(): void {
  for (const listener of listeners) listener()
}
