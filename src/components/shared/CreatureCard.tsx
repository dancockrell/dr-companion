import { cn } from '../../lib/cn'
import { Badge } from './Badge'
import { CreatureArt } from './CreatureArt'
import { DECK_STYLE, type RoomCard, type Tier } from '../../lib/cards'

/**
 * One card, rendered at whichever tier the deck chose. See DESIGN.md S6.
 *
 * The ordering inside the fan sliver is the load-bearing part: band, then
 * alive or dead, then stunned, then as much name as fits. Level is not in that
 * list on purpose. It cannot change during a fight, so it loses to status.
 */
export function CreatureCard({
  card,
  tier,
  expanded,
  onToggle,
}: {
  card: RoomCard
  tier: Tier
  expanded: boolean
  onToggle: () => void
}) {
  const style = DECK_STYLE[card.deck]
  const dead = card.status === 'dead'
  const shown: Tier = expanded ? 'full' : tier

  const shell = cn(
    'relative overflow-hidden border border-border bg-surface-raised text-left',
    'transition-[width,height,opacity] duration-150',
    style.corner,
    dead && 'opacity-55 saturate-50',
    'hover:border-ink-faint focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent'
  )

  // The deck band. Present at every tier, because it is the one thing that
  // must never be ambiguous.
  const band = <span className={cn('absolute left-0 top-0 h-full w-1', style.band)} />

  if (shown === 'fan') {
    return (
      <button
        type="button"
        onClick={onToggle}
        title={`${card.name}${card.count > 1 ? ` x${card.count}` : ''}`}
        aria-label={`${card.name}${card.count > 1 ? ` x${card.count}` : ''}`}
        className={cn(shell, 'h-[104px] w-[22px] shrink-0')}
      >
        {band}
        <span className="absolute inset-y-0 left-1 flex w-[18px] flex-col items-center justify-start gap-1 pt-1.5">
          {card.status === 'stunned' && <span className="h-1.5 w-1.5 rounded-full bg-warn" />}
          <span className="text-xs font-semibold leading-none text-ink">
            {card.name.charAt(0).toUpperCase()}
          </span>
          {card.count > 1 && (
            <span className="text-xs leading-none text-ink-faint">{card.count}</span>
          )}
        </span>
      </button>
    )
  }

  if (shown === 'row') {
    return (
      <button
        type="button"
        onClick={onToggle}
        className={cn(shell, 'flex h-8 w-full items-center gap-2 pl-3 pr-2')}
      >
        {band}
        <span className="truncate text-sm text-ink">{card.name}</span>
        {card.count > 1 && <span className="text-xs text-ink-faint">x{card.count}</span>}
        <span className="ml-auto flex items-center gap-1">
          {card.status === 'stunned' && <Badge tone="warn">stunned</Badge>}
          {dead && <Badge>dead</Badge>}
        </span>
      </button>
    )
  }

  const full = shown === 'full'

  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(shell, 'w-full min-w-0 p-1.5 pl-2.5')}
    >
      {band}

      <CreatureArt
        name={card.name}
        noun={card.noun}
        lore={card.lore}
        height={full ? 72 : 44}
        className="mb-1"
      />

      <div className="flex items-baseline gap-1">
        <span className="truncate text-sm font-medium leading-tight text-ink">
          {card.name}
        </span>
        {card.count > 1 && <span className="text-xs text-ink-faint">x{card.count}</span>}
      </div>

      {/* Level shares the name's line rather than taking one of its own: it
          cannot change during a fight, so it does not deserve the height.
          Where the lore was matched loosely the level is marked, since the
          noun index only keeps what every candidate agreed on. */}
      {card.lore?.level != null && (
        <div
          className="text-xs leading-tight text-ink-muted"
          title={
            card.loreApproximate
              ? 'Matched on the noun rather than the full name, so this holds for the kind.'
              : undefined
          }
        >
          level {card.lore.level}
          {card.loreApproximate && <span className="text-ink-faint"> approx</span>}
        </div>
      )}

      <div className="mt-1 flex gap-1 overflow-hidden">
        {card.status === 'stunned' && <Badge tone="warn">stunned</Badge>}
        {dead && <Badge>dead</Badge>}
        {full && card.lore?.castsSpells && <Badge tone="info">casts</Badge>}
        {full && card.lore?.stealthy && <Badge tone="info">stealthy</Badge>}
        {full && card.lore?.attackRange && <Badge>{card.lore.attackRange}</Badge>}
      </div>

      {/* A corpse worth something is a task, not a footnote, so it says so. */}
      {full && dead && (card.lore?.skinnable || card.lore?.hasBoxes) && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {card.lore.skinnable && <Badge tone="accent">skin</Badge>}
          {card.lore.hasBoxes && <Badge tone="accent">box</Badge>}
        </div>
      )}
    </button>
  )
}
