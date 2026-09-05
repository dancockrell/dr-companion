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
import { MacroBar } from './MacroBar.tsx'
import { useMacroChoice } from '../../lib/useMacroChoice.ts'
import { useMacroRunner } from '../../lib/useMacroRunner.ts'

export function ActionsPanel({ dense: _dense = false }: { dense?: boolean }) {
  const { macroChoice, setMacroChoice } = useMacroChoice()
  const { run, canSend, reason, character } = useMacroRunner()

  if (!character) return null

  return (
    /* Twelve macros with variations, in the height four buttons used to take.
       Right-click a slot to change what it runs. */
    <div className="space-y-1">
      <MacroBar
        choice={macroChoice}
        onChoose={setMacroChoice}
        onRun={run}
        disabled={!canSend}
      />
      {/* Said before pressing, which is the entire point. Disabling the bar
          without this would swap "refused after the fact" for "dead for no
          stated reason", which is not an improvement. */}
      {reason && (
        <p className="px-0.5 text-xs text-warn leading-snug">{reason}</p>
      )}
    </div>
  )
}
