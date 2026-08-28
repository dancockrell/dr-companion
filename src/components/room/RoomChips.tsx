import { collapse, sortCards, type RoomCard } from '../../lib/cards'
import { RANGE_WORD, combatantFor, indexCombatants } from '../../lib/combat'
import { CreatureArt } from '../shared/CreatureArt'
import { hasArt } from '../../lib/creatureArt'
import type { RoomCombatant } from '../../types'

/**
 * Who's here, read the way DragonRealms itself reads it — text first, a real
 * portrait when there genuinely is one.
 *
 * The first pass put a round creature-art portrait in every slot, with a
 * letter-in-a-circle fallback for anything the bestiary art pipeline has not
 * covered yet (issue #7/#8 — most creatures, right now). Over a generated
 * town backdrop that was a row of "G x3, B, K, O" — a mobile game's roster
 * bar, not a MUD, and it went. The correction after that dropped portraits
 * entirely, which fixed the placeholder problem by refusing to draw
 * anything — a real image, when the pack actually has one, is a strict
 * improvement over the same line of text with nothing next to it. `hasArt`
 * is the same manifest check CreatureArt itself uses (see lib/creatureArt.ts)
 * — never a guess, never the letter fallback CreatureArt draws when it is
 * asked to render regardless. A card with no confirmed art gets no image at
 * all here, not a placeholder standing in for one.
 *
 * DOT still carries deck (hostile/allied/people) and RING still carries
 * status (alive/stunned/dead) — both real, both cheap, and shown whether or
 * not a portrait is.
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

/** Past a minute, assess-derived range/relation/target is old enough that
 * showing it at full strength would claim a currency it does not have —
 * per companion_bridge.lic's own comment on enrichedAgeSeconds, and per
 * downloads-2f's finding that nothing was actually reading the field yet. */
const STALE_AFTER_SECONDS = 60

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
  const stale =
    combatant != null &&
    combatant.enrichedAgeSeconds != null &&
    combatant.enrichedAgeSeconds > STALE_AFTER_SECONDS
  const portrait = card.status !== 'dead' && hasArt(card.name, card.noun)

  return (
    <div
      className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${
        targetingYou ? 'bg-danger/10' : ''
      }`}
      title={stale ? `last assessed ${combatant!.enrichedAgeSeconds}s ago — may no longer be accurate` : undefined}
    >
      {portrait ? (
        <CreatureArt
          name={card.name}
          noun={card.noun}
          lore={card.lore}
          height={20}
          className="!w-5 shrink-0 !rounded-full"
        />
      ) : (
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[card.deck]}`} />
      )}
      <span className={card.status === 'dead' ? 'text-ink-faint line-through' : 'text-ink'}>
        {card.name}
        {card.count > 1 && <span className="text-ink-faint"> x{card.count}</span>}
      </span>
      {statusText && <span className="text-warn">{statusText}</span>}
      {detail && (
        <span
          className={
            stale
              ? 'italic text-ink-faint/60'
              : targetingYou
                ? 'font-medium text-danger'
                : 'text-ink-faint'
          }
        >
          {detail}
          {targetingYou && ' — on you'}
          {stale && ' (stale)'}
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
