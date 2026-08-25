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
  Package,
  Sparkles,
  ShieldAlert,
} from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { Button } from './Button'

export function ActionsPanel({ dense = false }: { dense?: boolean }) {
  const character = useAppStore((s) => s.character)
  const requestIntent = useAppStore((s) => s.requestIntent)
  if (!character) return null

  const lowHealth = character.vitals.health / character.vitals.healthMax < 0.35
  const inCombat = character.situation.includes('in_combat')

  const primaryLabel = lowHealth
    ? 'Go to Healer Now'
    : inCombat
      ? 'Combat Assist'
      : 'Start Training'
  const primaryIntent = lowHealth ? 'go_healer' : 'start_training'

  const quick = [
    { id: 'go_healer', label: 'Healer', icon: <Heart className="w-4 h-4" /> },
    { id: 'loot', label: 'Loot', icon: <Package className="w-4 h-4" /> },
    { id: 'buffs', label: 'Buffs', icon: <Sparkles className="w-4 h-4" /> },
    { id: 'escape', label: 'Safe', icon: <ShieldAlert className="w-4 h-4" /> },
  ]

  return (
    <div className="space-y-3">
      <Button
        size={dense ? 'lg' : 'xl'}
        variant={lowHealth ? 'danger' : 'primary'}
        icon={
          lowHealth ? <Heart className="w-5 h-5" /> : <Play className="w-5 h-5" />
        }
        onClick={() => requestIntent(primaryIntent)}
      >
        {primaryLabel}
      </Button>

      <div className="grid grid-cols-3 gap-2">
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
        <Button
          size="md"
          variant="danger"
          icon={<Square className="w-4 h-4" />}
          onClick={() => requestIntent('stop_all')}
        >
          Stop
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {quick.map((q) => (
          <Button
            key={q.id}
            size="sm"
            variant="ghost"
            className="flex-col h-auto py-2"
            icon={q.icon}
            onClick={() => requestIntent(q.id)}
          >
            {q.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
