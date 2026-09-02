export interface MacroFlightGate {
  claim(): boolean
  isInFlight(): boolean
  subscribe(listener: () => void): () => void
}

export function createMacroFlightGate(options: {
  durationMs?: number
  now?: () => number
  schedule?: (callback: () => void, delayMs: number) => unknown
  cancel?: (handle: unknown) => void
} = {}): MacroFlightGate {
  const durationMs = options.durationMs ?? 900
  const now = options.now ?? Date.now
  const schedule = options.schedule ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs))
  const cancel = options.cancel ?? ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>))
  const listeners = new Set<() => void>()
  let busyUntil = 0
  let timer: unknown = null

  const notify = () => {
    for (const listener of listeners) listener()
  }

  const isInFlight = () => now() < busyUntil

  const claim = () => {
    if (isInFlight()) return false
    busyUntil = now() + durationMs
    if (timer !== null) cancel(timer)
    timer = schedule(() => {
      timer = null
      busyUntil = 0
      notify()
    }, durationMs)
    notify()
    return true
  }

  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  return { claim, isInFlight, subscribe }
}
