import { MapPin } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { Badge } from '../shared/Badge'
import { RoundtimeMeter } from '../shared/RoundtimeMeter'
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
  const hands = character.hands

  // Race, guild and circle were all in every status payload and none of them
  // was on screen anywhere. Circle in particular is the number a DragonRealms
  // player would give if you asked how far along a character is, and the app
  // knew it and never said it. Three fields, one short span, no new row.
  const who = [character.race, character.guild?.replace(/_/g, ' '), character.circle]
    .filter((x) => x !== undefined && x !== null && x !== '' && x !== 'unknown')
    .join(' ')

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-sm font-semibold leading-tight text-ink">{character.name}</span>

      {who && <span className="shrink-0 text-xs capitalize text-ink-muted">{who}</span>}

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

      {/* Hands. In a fight this is the question, and Genie keeps it permanently
          on its status bar.

          Shown whenever the bridge reported hands at all, including when both
          are empty. The earlier version hid the block unless something was
          held, which made "you are holding nothing" look identical to "we have
          not been told" - and empty hands is not a null result, it is the
          answer to why the attack did nothing. Being disarmed is exactly the
          moment this needs to be readable. */}
      {hands && (
        <span className="flex min-w-0 items-center gap-2 text-xs">
          <span className="truncate text-ink-muted">
            <span className="text-ink-faint">R</span>{' '}
            {hands.right ?? <span className="text-ink-faint">empty</span>}
          </span>
          <span className="truncate text-ink-muted">
            <span className="text-ink-faint">L</span>{' '}
            {hands.left ?? <span className="text-ink-faint">empty</span>}
          </span>
        </span>
      )}

      {/* Counts down rather than sitting on whatever the last push said.
          See RoundtimeMeter. */}
      <RoundtimeMeter />

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
          lowHealth ? 'text-danger' : 'text-ink-muted'
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
