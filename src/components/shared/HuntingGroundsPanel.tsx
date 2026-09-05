import { useMemo } from 'react'
import { Star } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore.ts'
import { rankHuntingGrounds, type GuildId } from '../../data/hunting.ts'
import { combatRanks } from '../../data/skills.ts'

/**
 * Hunt mode, favorites, and a manual ground pick - `start_training` has
 * carried all three as arguments since the intent was written
 * (`useAppStore.ts`'s `start_training` branch reads `huntFavorites`,
 * `huntMode`, `selectedHuntId` straight off the store and sends them), the
 * mock bridge honors `mode: 'manual'` and a `favorites` list, and the ranking
 * engine below (`rankHuntingGrounds`) already scores every ground against
 * them. Nothing ever wrote to `huntMode`/`selectedHuntId`/`huntFavorites` -
 * `setHuntMode`, `setSelectedHuntId` and `toggleHuntFavorite` had zero
 * callers anywhere in `src/`. Suggest mode has always worked (it is the
 * default and needs no input), which is exactly why the gap was invisible:
 * the feature this panel is missing only bites a player who wants to
 * override the automatic pick, and there was no way to find that out short
 * of reading the store.
 *
 * Lives in Settings next to Training focus, which already says "Used when
 * you press Start Training" - this is the other half of that sentence.
 */
export function HuntingGroundsPanel() {
  const character = useAppStore((s) => s.character)
  const trainFocus = useAppStore((s) => s.trainFocus)
  const huntMode = useAppStore((s) => s.huntMode)
  const setHuntMode = useAppStore((s) => s.setHuntMode)
  const huntFavorites = useAppStore((s) => s.huntFavorites)
  const toggleHuntFavorite = useAppStore((s) => s.toggleHuntFavorite)
  const selectedHuntId = useAppStore((s) => s.selectedHuntId)
  const setSelectedHuntId = useAppStore((s) => s.setSelectedHuntId)

  const ranked = useMemo(() => {
    if (!character) return []
    return rankHuntingGrounds({
      instance: character.instance,
      accountTier: character.accountTier,
      focus: trainFocus,
      guild: (character.guild as GuildId | undefined) ?? 'unknown',
      skillRanks: character.skills?.length
        ? combatRanks(character.skills)
        : (character.skillRanks ?? 50),
      favorites: huntFavorites,
      mode: huntMode,
    })
  }, [character, trainFocus, huntFavorites, huntMode])

  if (!character) {
    return (
      <p className="text-xs text-ink-faint">
        Connect to see hunting grounds ranked for your character.
      </p>
    )
  }

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-3 gap-1.5">
        {(
          [
            { id: 'suggest', label: 'Suggest' },
            { id: 'favorites_only', label: 'Favorites' },
            { id: 'manual', label: 'Manual' },
          ] as const
        ).map((m) => (
          <button
            key={m.id}
            type="button"
            className={`rounded-lg border px-2 py-1.5 text-xs ${
              huntMode === m.id
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border text-ink-muted'
            }`}
            onClick={() => setHuntMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-ink-faint leading-snug">
        {huntMode === 'suggest' &&
          'Start Training picks the top-ranked ground below automatically.'}
        {huntMode === 'favorites_only' &&
          'Start Training only picks from your starred grounds.'}
        {huntMode === 'manual' && 'Start Training goes to whichever ground you pick below.'}
      </p>

      <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
        {ranked.map((r) => {
          const fav = huntFavorites.includes(r.ground.id)
          const chosen = huntMode === 'manual' && selectedHuntId === r.ground.id
          return (
            <li
              key={r.ground.id}
              className={`rounded border px-2 py-1.5 ${
                r.rejected
                  ? 'border-border/50 opacity-50'
                  : chosen
                    ? 'border-accent bg-accent/10'
                    : 'border-border bg-surface'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className={`shrink-0 ${fav ? 'text-warn' : 'text-ink-faint hover:text-ink'}`}
                  onClick={() => toggleHuntFavorite(r.ground.id)}
                  title={fav ? 'Remove favorite' : 'Add favorite'}
                  aria-label={
                    fav
                      ? `Remove ${r.ground.name} from favorites`
                      : `Add ${r.ground.name} to favorites`
                  }
                >
                  <Star className="h-3.5 w-3.5" fill={fav ? 'currentColor' : 'none'} />
                </button>
                <button
                  type="button"
                  disabled={r.rejected || huntMode !== 'manual'}
                  className="min-w-0 flex-1 truncate text-left text-xs text-ink disabled:cursor-default"
                  onClick={() => setSelectedHuntId(r.ground.id)}
                  title={
                    r.rejected
                      ? r.reasons.join('; ')
                      : `${r.ground.area} · ${r.ground.minRanks}–${r.ground.maxRanks} ranks`
                  }
                >
                  {r.ground.name}
                </button>
                <span className="shrink-0 text-xs tabular-nums text-ink-faint">
                  {r.rejected ? '—' : r.score}
                </span>
              </div>
              {!r.rejected && r.reasons.length > 0 && (
                <p className="mt-0.5 truncate text-xs text-ink-faint">{r.reasons.join(' · ')}</p>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
