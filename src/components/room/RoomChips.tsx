import { collapse, sortCards, type RoomCard } from '../../lib/cards'
import { RANGE_WORD, combatantFor, indexCombatants } from '../../lib/combat'
import type { RoomCombatant } from '../../types'

/**
 * Who's here, read the way DragonRealms itself reads it: text, not a row of
 * circular avatar tokens.
 *
 * The first two passes at this put a round creature-art portrait in every
 * slot, with a letter-in-a-circle fallback for anything the bestiary art
 * pipeline has not covered yet (issue #7/#8 — most creatures, right now).
 * Over a generated town backdrop that is a row of "G x3, B, K, O" — a mobile
 * game's roster bar, not a MUD. DragonRealms has no avatars; it has a line
 * of text per creature, and that is what a player actually reads to
 * understand a room. This draws that instead of inventing a graphic for
 * something the game never draws either.
 *
 * DOT still carries deck (hostile/allied/people) and RING still carries
 * status (alive/stunned/dead) — both real, both cheap, neither pretending to
 * be a portrait.
 */

const DOT: Record<RoomCard['deck'], string> = {
  hostile: 'bg-danger',
  allied: 'bg-good',
  people: 'bg-info',
}

const STATUS_TEXT: Record<RoomCard['status'], string> = {
  alive: '',
  stunned: 'stunned',
  dead: 'dead',
}

/** assess's own phrasing, shortest useful form. */
function combatText(c: RoomCombatant | undefined): string | null {
  if (!c) return null
  if (c.disengaged) return 'not fighting'
  const bits: string[] = []
  if (c.relation) bits.push(c.relation)
  if (c.range) bits.push(RANGE_WORD[c.range])
  return bits.length ? bits.join(' · ') : null
}

function Row({ card, combatant }: { card: RoomCard; combatant?: RoomCombatant }) {
  const targetingYou = combatant?.target?.toLowerCase() === 'you'
  const detail = combatText(combatant)
  const statusText = STATUS_TEXT[card.status]

  return (
    <div
      className={`flex shrink-0 items-baseline gap-1.5 whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${
        targetingYou ? 'bg-danger/10' : ''
      }`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 self-center rounded-full ${DOT[card.deck]}`} />
      <span className={card.status === 'dead' ? 'text-ink-faint line-through' : 'text-ink'}>
        {card.name}
        {card.count > 1 && <span className="text-ink-faint"> x{card.count}</span>}
      </span>
      {statusText && <span className="text-warn">{statusText}</span>}
      {detail && (
        <span className={targetingYou ? 'font-medium text-danger' : 'text-ink-faint'}>
          {detail}
          {targetingYou && ' — on you'}
        </span>
      )}
      {combatant?.offBalance && (
        <span className="text-accent" title="off balance">
          ⚖
        </span>
      )}
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
    <div className={`flex flex-wrap items-center gap-x-1 gap-y-0.5 ${className ?? ''}`}>
      {shown.map((c) => (
        <Row key={c.id} card={c} combatant={combatantFor(c, index)} />
      ))}
    </div>
  )
}
