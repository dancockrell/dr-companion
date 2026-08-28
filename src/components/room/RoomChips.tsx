import { CreatureArt } from '../shared/CreatureArt'
import { collapse, sortCards, type RoomCard } from '../../lib/cards'
import { RANGE_WORD, combatantFor, indexCombatants } from '../../lib/combat'
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
 * This strip is a name-and-status roster, not the fight itself — the actual
 * spatial picture (who is at melee/pole weapon/missile range, who is in
 * front of you versus behind you) belongs on CombatRadar, which has the room
 * to draw it properly. An earlier version of this file tried to fold that
 * layout in here too, grouped into labelled lanes; it read like a generic
 * raid-frame addon and not like DragonRealms, because it dropped the one
 * thing assess actually says — position, not just distance. Fixed by not
 * attempting the layout twice: this stays a flat row, using the game's own
 * words ("pole weapon", not "polearm") wherever it does say something.
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

/** assess's own words, in the order a player would say them. */
function combatantTooltip(c: RoomCombatant | undefined): string {
  if (!c) return ''
  if (c.disengaged) return 'broken off, not fighting'
  const bits: string[] = []
  if (c.relation) bits.push(c.relation)
  if (c.range) bits.push(`at ${RANGE_WORD[c.range]} range`)
  const line = bits.join(' ')
  const rest: string[] = []
  if (c.target) rest.push(`targeting ${c.target}`)
  if (c.balance) rest.push(`${c.balance} balance`)
  if (c.conditions.length) rest.push(c.conditions.join(', '))
  if (c.statuses.length) rest.push(c.statuses.join(', '))
  return [line, ...rest].filter(Boolean).join(' — ')
}

function Chip({ card, combatant }: { card: RoomCard; combatant?: RoomCombatant }) {
  const targetingYou = combatant?.target?.toLowerCase() === 'you'
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
        className={`relative rounded-full ${RING[card.status]} ${
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
  const shown = collapse(sortCards(cards))
  if (!shown.length) return null

  const index = indexCombatants(combatants)

  return (
    <div className={`flex items-end gap-2 overflow-x-auto pb-1 ${className ?? ''}`}>
      {shown.map((c) => (
        <Chip key={c.id} card={c} combatant={combatantFor(c, index)} />
      ))}
    </div>
  )
}
