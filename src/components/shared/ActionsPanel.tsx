/**
 * What to start. Stopping happens in one place and it is not here.
 *
 * A Stop and a Pause used to sit in this panel as well as in the bar at the
 * bottom of the window, wired to the same two intents. Two of each meant the
 * answer to "where is stop" depended on whether this panel was on screen, and
 * on a narrow window it often was not. Both went to the bar, which is always
 * there. The flow Stop in the Task flows panel stays where it is, because that
 * one stops a single running flow rather than everything.
 *
 * What is left is the opposite question. The primary button changes with the
 * situation because the useful action does: low on health it is the healer,
 * mid-fight it is combat, otherwise it is whatever you came here to do.
 */
import { Play, Heart, Navigation } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { Button } from './Button'
import { MacroBar } from './MacroBar'
import { useMacroChoice } from '../../lib/useMacroChoice'

export function ActionsPanel({ dense = false }: { dense?: boolean }) {
  const character = useAppStore((s) => s.character)
  const requestIntent = useAppStore((s) => s.requestIntent)
  const { macroChoice, setMacroChoice } = useMacroChoice()
  if (!character) return null

  const lowHealth = character.vitals.health / character.vitals.healthMax < 0.35
  const inCombat = character.situation.includes('in_combat')

  const primaryLabel = lowHealth
    ? 'Go to Healer Now'
    : inCombat
      ? 'Combat Assist'
      : 'Start Training'
  const primaryIntent = lowHealth ? 'go_healer' : 'start_training'

  return (
    <div className="space-y-2">
      {/* Town Run comes up beside the primary rather than sitting alone on the
          row Stop and Pause vacated. A row of one button and a gap is the
          panel getting taller for no extra information. */}
      <div className="flex gap-2">
        <Button
          size={dense ? 'md' : 'lg'}
          className="flex-1"
          variant={lowHealth ? 'danger' : 'primary'}
          icon={
            lowHealth ? <Heart className="w-5 h-5" /> : <Play className="w-5 h-5" />
          }
          onClick={() => requestIntent(primaryIntent)}
        >
          {primaryLabel}
        </Button>
        <Button
          size={dense ? 'md' : 'lg'}
          variant="secondary"
          icon={<Navigation className="w-4 h-4" />}
          onClick={() => requestIntent('town_run')}
        >
          Town Run
        </Button>
      </div>

      {/* Twelve macros with variations, in the height four buttons used to
          take. Right-click a slot to change what it runs. */}
      <MacroBar
        choice={macroChoice}
        onChoose={setMacroChoice}
        onRun={(commands) => requestIntent('run_macro', { commands })}
      />
    </div>
  )
}
