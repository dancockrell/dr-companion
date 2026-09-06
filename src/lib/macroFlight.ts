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

/**
 * Re-check live character state and atomically claim the shared send slot.
 *
 * Split out of `requestMacro` by Q3 so a key-chord macro claims the *same*
 * slot before sending through the outbound lane. Two gates would mean a
 * bound key and an action bar could each believe the other was idle, which is
 * exactly what this module's one instance exists to prevent - and a copy of
 * these six lines in `keybindings.ts` would have been that second gate under
 * another name.
 */
export function claimMacroSend(): MacroSendState {
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
  return verdict
}

/** Claim the slot and run a macro through the bridge's `run_macro` intent. */
export function requestMacro(commands: string[]): MacroSendState {
  const verdict = claimMacroSend()
  if (!verdict.canSend) return verdict
  useAppStore.getState().requestIntent('run_macro', { commands })
  return verdict
}
