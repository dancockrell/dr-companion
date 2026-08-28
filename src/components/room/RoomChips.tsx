import { CreatureArt } from '../shared/CreatureArt'
import { sortCards, type RoomCard } from '../../lib/cards'
import {
  BUCKET_LABEL,
  BUCKET_ORDER,
  bucketFor,
  combatantFor,
  combatantSignature,
  indexCombatants,
  type RangeBucket,
} from '../../lib/combat'
import type { RoomCombatant } from '../../types'

/**
 * Who's here, as tokens on the scene rather than a list beside it.
 *
 * There is no numeric health to ring a chip with — RoomCard's own doc comment
 * is explicit that Lich has none to give (see cards.ts) — so "health
 * boundary" is read honestly here as the one boundary the data actually
 * supports: alive, stunned or dead, as a ring rather than a bar. A bar would
 * be a number this app does not have.
 *
 * Range grouping (melee/pole/missile/not-fighting/unassessed) comes from a
 * second, separate feed — Lich's own creature tracker, only populated once
 * something has actually run `assess` — see lib/combat.ts's doc comment for
 * why it is matched by noun rather than trusted to line up with this list.
 * Most of the time nothing has been assessed at all, and this renders exactly
 * as it always did: one flat row. The grouping only appears once there is
 * something real to group by.
 */

const RING: Record<RoomCard['status'], string> = {
  alive: 'ring-2 ring-good',
  stunned: 'ring-2 ring-warn animate-pulse',
  dead: 'ring-2 ring-ink-faint opacity-50 grayscale',
}

const DOT: Record<RoomCard['deck'], string> = {
  hostile: 'bg-danger',
  allied: 'bg-good',
  people: 'bg-info',
}

const RANGE_LETTER: Record<'melee' | 'pole' | 'missile', string> = {
  melee: 'M',
  pole: 'P',
  missile: 'R',
}

/** A tooltip line worth the reader's time only when there is something to say. */
function combatantTooltip(c: RoomCombatant | undefined): string {
  if (!c) return ''
  const bits: string[] = []
  if (c.disengaged) bits.push('not fighting')
  else if (c.range) bits.push(`${c.range} range`)
  if (c.relation) bits.push(c.relation)
  if (c.target) bits.push(`targeting ${c.target}`)
  if (c.balance) bits.push(`${c.balance} balance`)
  if (c.conditions.length) bits.push(c.conditions.join(', '))
  if (c.statuses.length) bits.push(c.statuses.join(', '))
  return bits.join(' — ')
}

function Chip({ card, combatant }: { card: RoomCard; combatant?: RoomCombatant }) {
  const targetingYou = combatant?.target?.toLowerCase() === 'you'
  // Past a minute, an assess is old enough that showing it at full strength
  // would claim a currency it does not have. Still shown — a stale range beats
  // no range — just visually softened.
  const stale =
    combatant?.enrichedAgeSeconds != null && combatant.enrichedAgeSeconds > 60

  const detail = combatantTooltip(combatant)
  const title = `${card.name}${card.count > 1 ? ` x${card.count}` : ''}${
    card.lore?.level != null ? ` — level ${card.lore.level}` : ''
  }${detail ? ` — ${detail}` : ''}`

  return (
    <div
      className="group relative flex shrink-0 flex-col items-center gap-0.5"
      title={title}
    >
      <div
        className={`relative rounded-full ${RING[card.status]} ${stale ? 'opacity-70' : ''} ${
          targetingYou ? 'ring-offset-2 ring-offset-danger animate-pulse' : ''
        }`}
      >
        <CreatureArt
          name={card.name}
          noun={card.noun}
          lore={card.lore}
          height={44}
          className="!w-[44px] shrink-0 !rounded-full"
        />
        <span className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-surface ${DOT[card.deck]}`} />
        {/* Range letter — melee/pole/ranged, only once assess has actually
            said so. Bottom-left so it never collides with the count badge. */}
        {combatant?.range && (
          <span
            className="absolute -bottom-1 -left-1 flex h-4 w-4 items-center justify-center rounded-full border border-surface bg-surface-overlay text-xs font-bold leading-none text-ink"
            title={`${combatant.range} range`}
          >
            {RANGE_LETTER[combatant.range]}
          </span>
        )}
        {/* Off-balance — a real opportunity, not a cosmetic detail. */}
        {combatant?.offBalance && (
          <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-surface bg-accent" />
        )}
        {card.count > 1 && (
          <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-surface px-1 text-xs leading-tight text-ink shadow">
            x{card.count}
          </span>
        )}
      </div>
      {/* Name only on hover/focus — a tray of eight full names under the
          chips would cost more height than the picture they sit on. */}
      <span className="pointer-events-none absolute top-full mt-1 hidden max-w-[8rem] truncate rounded bg-surface/95 px-1 text-xs text-ink shadow group-hover:block">
        {card.name}
        {targetingYou && <span className="text-danger"> — on you</span>}
      </span>
    </div>
  )
}

export function RoomChips({
  cards,
  combatants,
  className,
}: {
  cards: RoomCard[]
  combatants?: RoomCombatant[]
  className?: string
}) {
  if (!cards.length) return null

  // Pair every raw card with its own combatant *before* collapsing — cards.ts's
  // collapse() merges same-name cards purely on name/status, which would
  // silently fold a melee boar targeting you and a disengaged one into a
  // single count-2 chip, erasing the one thing this feature adds. Collapsing
  // here instead uses a key that also includes the combat signature, so
  // genuinely identical entries (including "both unassessed") still merge,
  // and ones that differ in range/target/balance do not.
  const index = indexCombatants(combatants)
  const raw = sortCards(cards).map((card) => ({ card, combatant: combatantFor(card, index) }))

  const seen = new Map<string, { card: RoomCard; combatant?: RoomCombatant }>()
  const paired: { card: RoomCard; combatant?: RoomCombatant }[] = []
  for (const p of raw) {
    const key = `${p.card.deck}:${p.card.noun}:${p.card.status}:${combatantSignature(p.combatant)}`
    const existing = seen.get(key)
    if (existing) {
      existing.card = { ...existing.card, count: existing.card.count + p.card.count }
    } else {
      const copy = { card: { ...p.card }, combatant: p.combatant }
      seen.set(key, copy)
      paired.push(copy)
    }
  }
  if (!paired.length) return null

  // Group only what can actually be grouped: allies/people carry no combatant
  // data (Lich's tracker is hostiles-only), so they always fall in with
  // whichever bucket their card would naturally land in — 'unassessed' for
  // anything without a match. Buckets that end up empty are skipped rather
  // than rendered as a labelled gap.
  const buckets = new Map<RangeBucket, typeof paired>()
  for (const p of paired) {
    const b = bucketFor(p.combatant)
    const list = buckets.get(b)
    if (list) list.push(p)
    else buckets.set(b, [p])
  }

  // Grouping earns its keep only when there is a real split to show — a
  // single bucket (the common case: nothing assessed yet) renders exactly as
  // the flat row always did, so the labels never appear for a fight nobody
  // has queried.
  const active = BUCKET_ORDER.filter((b) => buckets.has(b))
  const grouped = active.length > 1

  return (
    <div className={`flex items-end gap-3 overflow-x-auto pb-1 ${className ?? ''}`}>
      {active.map((bucket) => (
        <div key={bucket} className="flex shrink-0 items-end gap-2">
          {grouped && (
            <span className="mb-1 shrink-0 self-end text-xs font-semibold uppercase tracking-wide text-ink-faint/80">
              {BUCKET_LABEL[bucket]}
            </span>
          )}
          {buckets.get(bucket)!.map(({ card, combatant }) => (
            <Chip key={card.id} card={card} combatant={combatant} />
          ))}
        </div>
      ))}
    </div>
  )
}
