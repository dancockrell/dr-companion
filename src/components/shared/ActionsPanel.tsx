/**
 * The macros. Starting and stopping both happen in the bar at the bottom.
 *
 * This panel used to carry a Stop and a Pause as well as the bar did, wired to
 * the same two intents, so the answer to "where is stop" depended on whether
 * this panel was on screen - and on a narrow window it often was not. Those
 * went to the bar first.
 *
 * The primary action and Town Run have now followed them, for the same reason
 * turned around. Start and Stop are one decision, and they were in different
 * containers at different weights with unrelated controls in between. Worse,
 * this panel sits inside a scrolling column: the button that starts everything
 * could be scrolled out of sight while the button that stops it never could.
 *
 * What is left is the twelve macros, which are neither starting nor stopping.
 * They are the small things you send by hand between the two.
 */
import { useCallback, useRef, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { MacroBar } from './MacroBar'
import { useMacroChoice } from '../../lib/useMacroChoice'
import { canSendMacro } from '../../lib/canSendMacro'

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
const IN_FLIGHT_MS = 900

export function ActionsPanel({ dense: _dense = false }: { dense?: boolean }) {
  const character = useAppStore((s) => s.character)
  const requestIntent = useAppStore((s) => s.requestIntent)
  const { macroChoice, setMacroChoice } = useMacroChoice()

  const [inFlight, setInFlight] = useState(false)
  const timer = useRef<number | null>(null)

  const run = useCallback(
    (commands: string[]) => {
      // Re-checked at the moment of sending, not only when rendering. A
      // disabled button is a hint, not a guarantee: a keyboard macro, a
      // command palette entry, or a state change between paint and click can
      // all reach this. The guard belongs where the send happens.
      if (!canSendMacro({ stopLatched: character?.stopLatched, inFlight, connected: !!character }).canSend) {
        return
      }

      // The bridge's own refusal is still the authority and is left entirely
      // alone. `stopLatched` is absent on an older bridge, where this
      // predicate correctly says "can send" and the refusal is the only thing
      // standing between a latched stop and a macro - so the pre-emptive fix
      // must never become the only fix.
      requestIntent('run_macro', { commands })

      setInFlight(true)
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        setInFlight(false)
        timer.current = null
      }, IN_FLIGHT_MS)
    },
    [character, inFlight, requestIntent]
  )

  if (!character) return null

  const state = canSendMacro({
    stopLatched: character.stopLatched,
    inFlight,
    connected: true,
  })

  return (
    /* Twelve macros with variations, in the height four buttons used to take.
       Right-click a slot to change what it runs. */
    <div className="space-y-1">
      <MacroBar
        choice={macroChoice}
        onChoose={setMacroChoice}
        onRun={run}
        disabled={!state.canSend}
      />
      {/* Said before pressing, which is the entire point. Disabling the bar
          without this would swap "refused after the fact" for "dead for no
          stated reason", which is not an improvement. */}
      {state.reason && (
        <p className="px-0.5 text-xs text-warn leading-snug">{state.reason}</p>
      )}
    </div>
  )
}
