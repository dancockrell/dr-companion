import { useCallback, useSyncExternalStore } from 'react'
import { useAppStore } from '../store/useAppStore'
import { canSendMacro } from './canSendMacro'
import { macroInFlight, requestMacro, subscribeMacroFlight } from './macroFlight'

/**
 * How long a sent macro is treated as still running.
 *
 * The bridge does not acknowledge `run_macro` completion, so there is no
 * event to clear this on - which is why it is a timeout rather than a
 * subscription, and why the number is stated here rather than buried.
 *
 * Deliberately short. The purpose is to stop a double-press queueing a second
 * macro behind the first, not to model how long the game takes; a DragonRealms
 * roundtime is seconds, but holding the bar disabled for seconds after every
 * press would make it feel broken for the far more common case of pressing two
 * different macros in sequence on purpose. Erring toward re-enabling early is
 * the safer error: the bridge still refuses what it should, so the worst case
 * is the old behaviour, not a new one.
 */
/**
 * "Send this macro" plus the gating around it, in one place.
 *
 * Pulled out of `ActionsPanel` so a second bar — `BattleActionBar`, sitting
 * next to the radar instead of in the dashboard rail — sends through the
 * exact same in-flight timer and `canSendMacro` check rather than a second
 * copy that could drift the moment one of them changed. Two macro bars is
 * two places a player expects "still running" to mean the same thing.
 */
export function useMacroRunner() {
  const character = useAppStore((s) => s.character)
  const inFlight = useSyncExternalStore(subscribeMacroFlight, macroInFlight, () => false)

  const run = useCallback(
    (commands: string[]) => {
      requestMacro(commands)
    },
    []
  )

  const state = canSendMacro({
    stopLatched: character?.stopLatched,
    inFlight,
    connected: !!character,
  })

  return { run, canSend: state.canSend, reason: state.reason, character }
}
