/**
 * Base stats, TDPs, luck and native mana — the character sheet numbers
 * behind every training decision, and the one thing Genie shows on its own
 * status bar that this app did not have anywhere at all.
 *
 * TDPs get the most weight on purpose. "How many do I have to spend" is the
 * question that gates every other training decision, and unlike the eight
 * base stats it changes by the hour rather than by the level.
 *
 * From `Lich::DragonRealms::DRStats` — the game's own `<component id='exp
 * tdp'>` and stat-window tags, read passively on every status tick. Nothing
 * here is computed or estimated.
 */
import { Sparkles } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import type { CharacterStats } from '../../types'

const STAT_LABELS: { key: keyof CharacterStats; short: string; label: string }[] = [
  { key: 'strength', short: 'STR', label: 'Strength' },
  { key: 'stamina', short: 'STA', label: 'Stamina' },
  { key: 'reflex', short: 'REF', label: 'Reflex' },
  { key: 'agility', short: 'AGI', label: 'Agility' },
  { key: 'intelligence', short: 'INT', label: 'Intelligence' },
  { key: 'wisdom', short: 'WIS', label: 'Wisdom' },
  { key: 'discipline', short: 'DIS', label: 'Discipline' },
  { key: 'charisma', short: 'CHA', label: 'Charisma' },
]

export function StatsPanel({ dense = false }: { dense?: boolean }) {
  const character = useAppStore((s) => s.character)
  const stats = character?.stats

  // Three states, not two: an older bridge never sends the key at all
  // (`undefined`) and that is a different fact from a bridge that tried to
  // read DRStats and failed (`null`, per the bridge's `safe(nil, ...)`
  // convention for `race`/`encumbrance`). Neither has numbers to show, so
  // both render the same explanatory text, but the two must not be
  // conflated into "stats: 0" the way a naive default would.
  if (stats === undefined) {
    return (
      <p className="text-xs text-ink-faint leading-relaxed">
        This bridge does not report base stats yet.
      </p>
    )
  }
  if (stats === null) {
    return (
      <p className="text-xs text-ink-faint leading-relaxed">
        Stats could not be read this tick. They should return on the next one.
      </p>
    )
  }

  return (
    <div className={`flex flex-col ${dense ? 'gap-1.5' : 'gap-2'}`}>
      {/* TDPs first and biggest — the number that actually gates a training
       * decision, not just one more stat in the grid below. */}
      <div className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-2.5 py-1.5">
        <Sparkles className="w-4 h-4 text-accent shrink-0" />
        <div className="flex flex-col min-w-0">
          <span className="text-xs uppercase tracking-wide text-ink-faint">
            TDPs to spend
          </span>
          <span className="text-lg font-semibold text-accent leading-none tabular-nums">
            {stats.tdps}
          </span>
        </div>
        {stats.nativeMana && (
          <span
            className="ml-auto text-xs text-ink-faint capitalize"
            title="This guild's native mana type"
          >
            {stats.nativeMana} mana
          </span>
        )}
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {STAT_LABELS.map(({ key, short, label }) => (
          <div
            key={key}
            title={label}
            className="flex flex-col items-center rounded border border-border bg-surface px-1 py-1"
          >
            <span className="text-xs uppercase tracking-wide text-ink-faint">{short}</span>
            <span className="text-sm font-medium text-ink tabular-nums">{stats[key]}</span>
          </div>
        ))}
      </div>

      {stats.luck !== 0 && (
        <p className="text-xs text-ink-faint" title="Luck modifies certain skill checks and hunting encounters">
          Luck {stats.luck > 0 ? '+' : ''}
          {stats.luck}
        </p>
      )}
    </div>
  )
}
