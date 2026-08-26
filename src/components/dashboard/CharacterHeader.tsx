/**
 * Who and where. Fixed, not a panel.
 *
 * Identity is the one thing that cannot be moved or closed, because people run
 * several accounts at once — commonly a few free ones for a healer bot or a
 * mule — and with four windows open the first question is always *which one is
 * this*. Getting it wrong sends a command to the wrong character.
 * See docs/DESIGN.md §2.6.
 */
import { MapPin } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { Badge } from '../shared/Badge'
import type { CharacterStatus } from '../../types'

const TIER_LABEL: Record<string, string> = {
  f2p: 'F2P',
  basic: 'Basic',
  premium: 'Premium',
  platinum: 'Platinum',
  fallen: 'Fallen',
}

function tierTone(tier: string) {
  if (tier === 'f2p') return 'warn' as const
  if (tier === 'premium' || tier === 'platinum') return 'good' as const
  return 'info' as const
}

export function CharacterHeader({ character }: { character: CharacterStatus }) {
  const uiMode = useAppStore((s) => s.uiMode)
  const setUiMode = useAppStore((s) => s.setUiMode)

  const lowHealth = character.vitals.health / character.vitals.healthMax < 0.35

  return (
    /* Tight. Identity has to be visible, not spacious — space is spent on the
       map, the experience board and the pictures, and everything else takes
       the minimum it needs to be read. See docs/DESIGN.md §2.115. */
    <header className="px-3 pt-2.5 pb-2 border-b border-border space-y-2 shrink-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-ink leading-tight truncate">
            {character.name}
          </h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge tone="accent">{character.instance}</Badge>
            <Badge tone={tierTone(character.accountTier)}>
              {TIER_LABEL[character.accountTier] ?? character.accountTier}
            </Badge>
            <Badge tone={character.connected ? 'good' : 'danger'}>
              {character.connected ? 'Connected' : 'Offline'}
            </Badge>
            {character.location.isTown && <Badge tone="info">Town</Badge>}
            {character.location.isSafe && <Badge tone="good">Safe</Badge>}
          </div>
        </div>

        {/* Two buttons rather than a dropdown. A menu to choose between two
            things costs a click to discover what the two things are. */}
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
  )
}
