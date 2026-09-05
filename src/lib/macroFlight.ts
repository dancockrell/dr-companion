import { useAppStore } from '../store/useAppStore.ts'
import { canSendMacro, type MacroSendState } from './canSendMacro.ts'
import { createMacroFlightGate } from './macroFlightGate.ts'

/**
 * One gate for every macro launcher in the window.
 *
 * The bridge has no completion acknowledgement for `run_macro`, so this is a
 * short double-dispatch guard rather than a claim about game roundtime. It is
 * module-owned so two simultaneously mounted launchers cannot each believe
 * the other is idle.
 */
const macroFlight = createMacroFlightGate()

export const subscribeMacroFlight = macroFlight.subscribe
export const macroInFlight = macroFlight.isInFlight

/** Re-check live character state and atomically claim the shared send slot. */
export function requestMacro(commands: string[]): MacroSendState {
  const state = useAppStore.getState()
  const verdict = canSendMacro({
    stopLatched: state.character?.stopLatched,
    inFlight: macroFlight.isInFlight(),
    connected: !!state.character,
  })
  if (!verdict.canSend) return verdict
  if (!macroFlight.claim()) {
    return { canSend: false, reason: 'A macro is still running.' }
  }
  state.requestIntent('run_macro', { commands })
  return verdict
}
