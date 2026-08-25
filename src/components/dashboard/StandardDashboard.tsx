import { MapPanel } from '../shared/MapPanel'
import { ScriptLauncher } from '../shared/ScriptLauncher'
/**
 * Standard mode — more density: inventory containers, situation chips,
 * same primary controls as Simple with extra detail.
 */
import {
  Play,
  Square,
  Pause,
  Heart,
  MapPin,
  Package,
  Sparkles,
  Navigation,
  ShieldAlert,
} from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { Button } from '../shared/Button'
import { VitalBar } from '../shared/VitalBar'
import { Badge } from '../shared/Badge'
import { PresetBar } from '../shared/PresetBar'
import { TrainingPanel } from '../shared/TrainingPanel'
import { RiskBar } from '../shared/RiskBar'
import { InventoryPanel } from '../shared/InventoryPanel'

export function StandardDashboard() {
  const {
    character,
    requestIntent,
    uiMode,
    setUiMode,
    demoLowHealth,
    demoCombat,
    demoSafe,
    demoBrokenPattern,
  } = useAppStore()

  if (!character) {
    return (
      <div className="p-6 text-ink-muted text-sm">
        Not connected. Complete setup first.
      </div>
    )
  }

  const lowHealth = character.vitals.health / character.vitals.healthMax < 0.35
  const inCombat = character.situation.includes('in_combat')
  const primaryLabel = lowHealth
    ? 'Go to Healer Now'
    : inCombat
      ? 'Combat Assist'
      : 'Start Training'
  const primaryIntent = lowHealth ? 'go_healer' : 'start_training'
  const primaryVariant = lowHealth ? 'danger' : 'primary'

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="px-4 pt-4 pb-3 border-b border-border space-y-3 shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold text-ink leading-tight">
              {character.name}
            </h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <Badge tone="accent">{character.instance}</Badge>
              <Badge
                tone={
                  character.accountTier === 'f2p'
                    ? 'warn'
                    : character.accountTier === 'premium' ||
                        character.accountTier === 'platinum'
                      ? 'good'
                      : 'info'
                }
              >
                {character.accountTier === 'f2p'
                  ? 'F2P'
                  : character.accountTier === 'basic'
                    ? 'Basic'
                    : character.accountTier === 'premium'
                      ? 'Premium'
                      : character.accountTier === 'platinum'
                        ? 'Platinum'
                        : character.accountTier}
              </Badge>
              <Badge tone={character.connected ? 'good' : 'danger'}>
                {character.connected ? 'Connected' : 'Offline'}
              </Badge>
              {character.location.isTown && <Badge tone="info">Town</Badge>}
              {character.location.isSafe && <Badge tone="good">Safe</Badge>}
            </div>
          </div>
          <select
            className="text-xs bg-surface-overlay border border-border rounded-lg px-2 py-1 text-ink-muted"
            value={uiMode}
            onChange={(e) =>
              setUiMode(e.target.value as 'simple' | 'standard' | 'power')
            }
          >
            <option value="simple">Simple</option>
            <option value="standard">Standard</option>
            <option value="power">Power</option>
          </select>
        </div>

        <div className="flex items-center gap-1.5 text-sm text-ink-muted">
          <MapPin className="w-3.5 h-3.5 shrink-0 text-accent" />
          <span className="truncate">{character.location.title}</span>
        </div>

        {character.situation.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {character.situation.map((s) => (
              <Badge
                key={s}
                tone={
                  s === 'low_health' || s === 'in_combat' || s === 'dead'
                    ? 'danger'
                    : 'warn'
                }
              >
                {s.replace(/_/g, ' ')}
              </Badge>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <VitalBar
            label="Health"
            value={character.vitals.health}
            max={character.vitals.healthMax}
            tone="health"
          />
          <VitalBar
            label="Spirit"
            value={character.vitals.spirit}
            max={character.vitals.spiritMax}
            tone="spirit"
          />
          <VitalBar
            label="Fatigue"
            value={character.vitals.fatigue}
            max={character.vitals.fatigueMax}
            tone="fatigue"
          />
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-ink-muted">Status</span>
          <span
            className={
              lowHealth
                ? 'text-danger font-medium animate-pulse-soft'
                : 'text-ink font-medium'
            }
          >
            {character.activity}
          </span>
        </div>
      </header>

      {/* Orientation belongs with the location it describes, not at the
          bottom of a scroll. Opens compact; the chevron gives it room. */}
      <div className="px-4 pb-3 shrink-0">
        <MapPanel />
      </div>

      <section className="px-4 py-4 space-y-3 shrink-0">
        <Button
          size="xl"
          variant={primaryVariant as 'primary' | 'danger'}
          icon={
            lowHealth ? (
              <Heart className="w-5 h-5" />
            ) : (
              <Play className="w-5 h-5" />
            )
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
      </section>

      {/* Inventory */}
      <section className="px-4 pb-3 shrink-0">
        <InventoryPanel />
      </section>

      <section className="px-4 pb-3 shrink-0">
        <h2 className="text-xs font-medium text-ink-faint uppercase tracking-wider mb-2">
          Quick actions
        </h2>
        <div className="grid grid-cols-4 gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="flex-col h-auto py-2"
            icon={<Heart className="w-4 h-4" />}
            onClick={() => requestIntent('go_healer')}
          >
            Healer
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="flex-col h-auto py-2"
            icon={<Package className="w-4 h-4" />}
            onClick={() => requestIntent('loot')}
          >
            Loot
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="flex-col h-auto py-2"
            icon={<Sparkles className="w-4 h-4" />}
            onClick={() => requestIntent('buffs')}
          >
            Buffs
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="flex-col h-auto py-2"
            icon={<ShieldAlert className="w-4 h-4" />}
            onClick={() => requestIntent('escape')}
          >
            Safe
          </Button>
        </div>
      </section>
      <RiskBar />

      <TrainingPanel />

      <PresetBar />

<section className="px-4 pb-2 shrink-0">
        <h2 className="text-xs font-medium text-ink-faint uppercase tracking-wider mb-2">
          Demo: simulate situation
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={demoLowHealth}>
            Low health
          </Button>
          <Button size="sm" variant="ghost" onClick={demoCombat}>
            In combat
          </Button>
          <Button size="sm" variant="ghost" onClick={demoSafe}>
            Safe again
          </Button>
          <Button size="sm" variant="ghost" onClick={demoBrokenPattern}>
            Broken pattern
          </Button>
        </div>
      </section>

      <ScriptLauncher />
    </div>
  )
}
