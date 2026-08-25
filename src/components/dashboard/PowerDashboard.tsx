import { MapPanel } from '../shared/MapPanel'
import { ScriptLauncher } from '../shared/ScriptLauncher'
/**
 * Power mode — denser controls + live healer ranking explainability.
 */
import { useMemo } from 'react'
import {
  Play,
  Square,
  Pause,
  Heart,
  MapPin,
  Navigation,
} from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { Button } from '../shared/Button'
import { VitalBar } from '../shared/VitalBar'
import { Badge } from '../shared/Badge'
import { PresetBar } from '../shared/PresetBar'
import { TrainingPanel } from '../shared/TrainingPanel'
import { RiskBar } from '../shared/RiskBar'
import { InventoryPanel } from '../shared/InventoryPanel'
import { scoreHealers } from '../../data/healers'
import { rankHuntingGrounds } from '../../data/hunting'
import { capabilitiesForCharacter } from '../../lib/accountCapabilities'

export function PowerDashboard() {
  const {
    character,
    requestIntent,
    uiMode,
    setUiMode,
    demoLowHealth,
    demoCombat,
    demoSafe,
  } = useAppStore()

  const trainFocus = useAppStore((s) => s.trainFocus)

  const ranked = useMemo(() => {
    if (!character) return []
    return scoreHealers({
      instance: character.instance,
      accountTier: character.accountTier,
      mobilityScore: 55,
      preferFree: true,
    })
  }, [character])

  const huntFavorites = useAppStore((s) => s.huntFavorites)
  const huntMode = useAppStore((s) => s.huntMode)
  const toggleHuntFavorite = useAppStore((s) => s.toggleHuntFavorite)
  const setSelectedHuntId = useAppStore((s) => s.setSelectedHuntId)
  const setHuntMode = useAppStore((s) => s.setHuntMode)

  const hunts = useMemo(() => {
    if (!character) return []
    return rankHuntingGrounds({
      instance: character.instance,
      accountTier: character.accountTier,
      focus: trainFocus,
      guild: (character.guild as any) || 'unknown',
      skillRanks: character.skillRanks ?? 50,
      favorites: huntFavorites,
      mode: huntMode,
    })
  }, [character, trainFocus, huntFavorites, huntMode])

  const caps = character ? capabilitiesForCharacter(character) : null

  if (!character) {
    return (
      <div className="p-6 text-ink-muted text-sm">Not connected.</div>
    )
  }

  const lowHealth = character.vitals.health / character.vitals.healthMax < 0.35

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="px-4 pt-3 pb-2 border-b border-border space-y-2 shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-base font-semibold text-ink">{character.name}</h1>
            <div className="flex flex-wrap gap-1.5 mt-1">
              <Badge tone="accent">{character.instance}</Badge>
              <Badge tone={character.accountTier === 'f2p' ? 'warn' : 'info'}>
                {character.accountTier}
              </Badge>
              <Badge tone={character.connected ? 'good' : 'danger'}>
                {character.connected ? 'Live' : 'Off'}
              </Badge>
            </div>
          </div>
          
          {/* Two buttons, not a dropdown. A menu to change between two things
              costs a click to find out what the two things are. */}
          <div className="flex rounded-lg border border-border overflow-hidden shrink-0">
            {(['basic', 'power'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`text-xs px-2.5 py-1 capitalize ${
                  uiMode === m
                    ? 'bg-accent/15 text-accent'
                    : 'text-ink-faint hover:text-ink'
                }`}
                onClick={() => setUiMode(m)}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1 text-xs text-ink-muted">
          <MapPin className="w-3 h-3 text-accent" />
          {character.location.title}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <VitalBar
            label="HP"
            value={character.vitals.health}
            max={character.vitals.healthMax}
            tone="health"
          />
          <VitalBar
            label="SP"
            value={character.vitals.spirit}
            max={character.vitals.spiritMax}
            tone="spirit"
          />
          <VitalBar
            label="Fat"
            value={character.vitals.fatigue}
            max={character.vitals.fatigueMax}
            tone="fatigue"
          />
        </div>
        <div className="text-xs text-ink-muted">
          Activity:{' '}
          <span className={lowHealth ? 'text-danger font-medium' : 'text-ink'}>
            {character.activity}
          </span>
        </div>
      </header>

      {/* Orientation belongs with the location it describes. */}
      <div className="px-4 pb-3 shrink-0">
        <MapPanel />
      </div>

      <section className="px-4 py-3 space-y-2 shrink-0">
        <div className="grid grid-cols-2 gap-2">
          <Button
            size="md"
            variant={lowHealth ? 'danger' : 'primary'}
            icon={<Play className="w-4 h-4" />}
            onClick={() =>
              requestIntent(lowHealth ? 'go_healer' : 'start_training')
            }
          >
            {lowHealth ? 'Healer' : 'Train'}
          </Button>
          <Button
            size="md"
            variant="secondary"
            icon={<Navigation className="w-4 h-4" />}
            onClick={() => requestIntent('town_run')}
          >
            Town Run
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={<Heart className="w-3.5 h-3.5" />}
            onClick={() => requestIntent('go_healer')}
          >
            Score healers
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={<Pause className="w-3.5 h-3.5" />}
            onClick={() => requestIntent('pause')}
          >
            Pause
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={<Square className="w-3.5 h-3.5" />}
            onClick={() => requestIntent('stop_all')}
          >
            Stop
          </Button>
        </div>
      </section>

      {/* Healer ranking — explainability */}
      <section className="px-4 pb-2 shrink-0">
        <h2 className="text-xs font-medium text-ink-faint uppercase tracking-wider mb-1.5">
          Healer ranking (live score)
        </h2>
        <div className="rounded-xl border border-border bg-surface-raised max-h-36 overflow-y-auto divide-y divide-border text-xs">
          {ranked.map((r) => (
            <div
              key={r.option.id}
              className={`px-2.5 py-1.5 flex justify-between gap-2 ${
                r.rejected ? 'opacity-50' : ''
              }`}
            >
              <div className="min-w-0">
                <div className="text-ink truncate">{r.option.name}</div>
                <div className="text-ink-faint truncate">
                  {r.rejected
                    ? r.reasons.join('; ')
                    : r.reasons.slice(0, 2).join('; ')}
                </div>
              </div>
              <div
                className={
                  r.rejected
                    ? 'text-danger shrink-0'
                    : 'text-accent font-medium shrink-0'
                }
              >
                {r.rejected ? '×' : r.score}
              </div>
            </div>
          ))}
        </div>
      </section>

            {/* Hunt ranking */}
      <section className="px-4 pb-2 shrink-0">
        <h2 className="text-xs font-medium text-ink-faint uppercase tracking-wider mb-1.5">
          Hunt ranking (focus-aware)
        </h2>
        <div className="rounded-xl border border-border bg-surface-raised max-h-32 overflow-y-auto divide-y divide-border text-xs">
          <div className="flex gap-1 p-1.5 border-b border-border">
            {(['suggest', 'favorites_only', 'manual'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`text-xs flex-1 rounded px-1 py-1 ${
                  huntMode === m
                    ? 'bg-accent/15 text-accent'
                    : 'text-ink-faint'
                }`}
                onClick={() => setHuntMode(m)}
              >
                {m === 'suggest' ? 'Suggest' : m === 'favorites_only' ? 'Favorites' : 'Manual'}
              </button>
            ))}
          </div>
          {hunts.slice(0, 8).map((r) => (
            <div
              key={r.ground.id}
              className={`px-2.5 py-1.5 flex justify-between gap-2 ${
                r.rejected ? 'opacity-50' : ''
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="text-ink truncate flex items-center gap-1">
                  <button
                    type="button"
                    className="text-warn shrink-0"
                    title="Toggle favorite"
                    onClick={() => toggleHuntFavorite(r.ground.id)}
                  >
                    {huntFavorites.includes(r.ground.id) ? '★' : '☆'}
                  </button>
                  <button
                    type="button"
                    className="truncate text-left hover:underline"
                    onClick={() => {
                      setSelectedHuntId(r.ground.id)
                      setHuntMode('manual')
                    }}
                  >
                    {r.ground.name}
                  </button>
                </div>
                <div className="text-ink-faint truncate pl-4">
                  {r.ground.minRanks}–{r.ground.maxRanks} ranks
                  {r.guildNote ? ` · ${r.guildNote}` : ''}
                  {r.rejected
                    ? ` · ${r.reasons[0]}`
                    : r.reasons[0]
                      ? ` · ${r.reasons[0]}`
                      : ''}
                </div>
              </div>
              <div
                className={
                  r.rejected
                    ? 'text-danger shrink-0'
                    : 'text-accent font-medium shrink-0'
                }
              >
                {r.rejected ? '×' : r.score}
              </div>
            </div>
          ))}
        </div>
      </section>

<ScriptLauncher compact={false} />

      {/* Caps summary */}
      {caps && (
        <section className="px-4 pb-2 shrink-0">
          <h2 className="text-xs font-medium text-ink-faint uppercase tracking-wider mb-1">
            Entitlements
          </h2>
          <div className="flex flex-wrap gap-1">
            <Badge tone={caps.canTravelOutsideZoluren ? 'good' : 'warn'}>
              {caps.canTravelOutsideZoluren ? 'Full travel' : 'Zoluren only'}
            </Badge>
            <Badge tone={caps.hasVault ? 'good' : 'warn'}>
              {caps.hasVault ? `Vault ~${caps.vaultApproximateCapacity}` : 'No vault'}
            </Badge>
            <Badge tone={caps.expThrottled ? 'warn' : 'good'}>
              {caps.expThrottled ? 'Exp throttled' : 'Full exp'}
            </Badge>
            {caps.canAccessFangCove && (
              <Badge tone="good">Fang Cove</Badge>
            )}
          </div>
        </section>
      )}

      <section className="px-4 pb-2 shrink-0">
        <InventoryPanel dense />
      </section>
      <RiskBar />

      <TrainingPanel dense />

      <PresetBar />

      <section className="px-4 pb-2 shrink-0">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={demoLowHealth}>
            Low HP
          </Button>
          <Button size="sm" variant="ghost" onClick={demoCombat}>
            Combat
          </Button>
          <Button size="sm" variant="ghost" onClick={demoSafe}>
            Safe
          </Button>
        </div>
      </section>

    </div>
  )
}
