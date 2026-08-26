import { MapPin } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { Badge } from '../shared/Badge'
import { cn } from '../../lib/cn'
import type { CharacterStatus } from '../../types'

/**
 * Who, where, and what is true right now — on one line.
 *
 * This was four rows and about 160px: a large name on a line of its own, four
 * badges on the next, the location on the third, and the single word "Ready"
 * on the fourth. Perhaps ten words of information, taking height from the map.
 *
 * One row now, and the space it frees carries things that were not shown at
 * all: what is in each hand, and how much roundtime is left. Both are
 * combat-critical, both were already known to the bridge, and neither had
 * anywhere to go.
 *
 * Connection state is deliberately absent: it lives in the title bar and only
 * there, so there is one place to look and no chance of two rows disagreeing.
 *
 * Identity stays fixed and unclosable because people run several characters at
 * once and sending a command to the wrong one is the mistake this prevents.
 * See docs/DESIGN.md 2.6.
 */

const TIER_LABEL: Record<string, string> = {
  f2p: 'F2P',
  basic: 'Basic',
  premium: 'Premium',
  platinum: 'Platinum',
  fallen: 'Fallen',
}

export function CharacterStrip({ character }: { character: CharacterStatus }) {
  const uiMode = useAppStore((s) => s.uiMode)
  const setUiMode = useAppStore((s) => s.setUiMode)

  const lowHealth = character.vitals.health / character.vitals.healthMax < 0.35
  const rt = character.roundtime ?? 0
  const hands = character.hands

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-sm font-semibold leading-tight text-ink">{character.name}</span>

      <span className="flex items-center gap-1">
        <Badge tone="accent">{character.instance}</Badge>
        {character.accountTier === 'f2p' && (
          <Badge tone="warn">{TIER_LABEL[character.accountTier]}</Badge>
        )}
        {character.location.isSafe && <Badge tone="good">Safe</Badge>}
      </span>

      <span className="flex min-w-0 items-center gap-1 text-xs text-ink-muted">
        <MapPin className="h-3 w-3 shrink-0 text-accent" />
        <span className="truncate">{character.location.title}</span>
      </span>

      {/* Hands. In a fight this is the question, and it was not on screen at
          all — Genie keeps it permanently on its status bar. */}
      {hands && (hands.right || hands.left) && (
        <span className="flex min-w-0 items-center gap-2 text-xs">
          <span className="truncate text-ink-muted">
            <span className="text-ink-faint">R</span> {hands.right ?? 'empty'}
          </span>
          <span className="truncate text-ink-muted">
            <span className="text-ink-faint">L</span> {hands.left ?? 'empty'}
          </span>
        </span>
      )}

      {/* Seconds, not a flag: the difference between waiting and doing
          something else with the time. */}
      {rt > 0 && (
        <span className="text-xs font-medium tabular-nums text-warn">RT {rt.toFixed(1)}s</span>
      )}

      {character.situation.length > 0 && (
        <span className="flex flex-wrap gap-1">
          {character.situation.map((s) => (
            <Badge
              key={s}
              tone={s === 'low_health' || s === 'in_combat' || s === 'dead' ? 'danger' : 'warn'}
            >
              {s.replace(/_/g, ' ')}
            </Badge>
          ))}
        </span>
      )}

      <span
        className={cn(
          'ml-auto text-xs font-medium',
          lowHealth ? 'animate-pulse-soft text-danger' : 'text-ink-muted'
        )}
      >
        {character.activity}
      </span>

      <span className="flex shrink-0 overflow-hidden rounded border border-border">
        {(['basic', 'power'] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={cn(
              'px-2 py-0.5 text-xs capitalize',
              uiMode === m ? 'bg-accent/15 text-accent' : 'text-ink-faint hover:text-ink'
            )}
            onClick={() => setUiMode(m)}
          >
            {m}
          </button>
        ))}
      </span>
    </div>
  )
}
