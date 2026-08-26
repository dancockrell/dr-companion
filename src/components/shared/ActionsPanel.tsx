/**
 * The controls: one thing to start, one to stop, and the rest as modifiers.
 *
 * The primary button changes with the situation because the useful action does.
 * Low on health it is the healer; mid-fight it is combat; otherwise it is
 * whatever you came here to do. Stop is never gated on anything — if the
 * transport is up, stop works.
 */
import {
  Play,
  Square,
  Pause,
  Heart,
  Navigation,
} from 'lucide-react'
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
          variant="danger"
          icon={<Square className="w-4 h-4" />}
          onClick={() => requestIntent('stop_all')}
        >
          Stop
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          size="md"
          variant="secondary"
          icon={<Navigation className="w-4 h-4" />}
          onClick={() => requestIntent('town_run')}
        >
          Town Run
        </Button>
        <Button
          size="md"
          variant="secondary"
          icon={<Pause className="w-4 h-4" />}
          onClick={() => requestIntent('pause')}
        >
          Pause
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
