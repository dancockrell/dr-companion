import { useCallback, useRef, useState } from 'react'
import { sortCards, DECKS, DECK_LABEL, DECK_STYLE, type RoomCard, type Deck } from '../../lib/cards'
import { RANGE_WORD, combatantFor, indexCombatants } from '../../lib/combat'
import { CreatureArt } from '../shared/CreatureArt'
import { hasArt } from '../../lib/creatureArt'
import { nounOf } from '../../lib/room'
import { canSendMacro } from '../../lib/canSendMacro'
import { useAppStore } from '../../store/useAppStore'
import type { RoomCombatant } from '../../types'

/**
 * Who's here and what's on the floor: an icon per individual, the detail in
 * its tooltip — per Dan's direct standard for this whole app, "at all points
 * the question is how can I do this with an icon and a tooltip".
 *
 * Never `collapse()`'d into a count chip. Three goblins are three individual
 * combatants, each fighting at its own range and relation and possibly
 * targeting something different — "you can't stack monsters". Folding them
 * into one "a goblin x3" row was hiding exactly the information this panel
 * exists to show: `combat.ts`'s FIFO noun-matching was already built to hand
 * each of the three cards its own distinct combatant, but collapse() never
 * gave it three cards to work with in the first place.
 *
 * Room items moved in here from their own panel below the description
 * (RoomItemsPanel, now deleted) at Dan's direction — a room item belongs on
 * the room, not in a separate list elsewhere in the UI competing for the
 * same attention as the game pane and the channels.
 *
 * `hasArt` still gates every portrait — never CreatureArt's letter fallback —
 * so nothing here regresses to the placeholder-heavy version that got called
 * "awful" earlier this session.
 */

const IN_FLIGHT_MS = 900
const STALE_AFTER_SECONDS = 60

/** assess's own phrasing, shortest useful form — lives in the tooltip now,
 * not inline, so a row is never wider than its icon and name. */
function combatTooltip(card: RoomCard, combatant: RoomCombatant | undefined, stale: boolean): string {
  const bits = [card.name]
  if (card.status === 'dead') bits.push('dead')
  if (card.status === 'stunned') bits.push('stunned')
  if (combatant?.disengaged) bits.push('not fighting')
  if (combatant?.relation) bits.push(combatant.relation)
  if (combatant?.range) bits.push(`at ${RANGE_WORD[combatant.range]} range`)
  if (combatant?.target) bits.push(`targeting ${combatant.target}`)
  if (combatant?.offBalance) bits.push('off balance')
  if (stale && combatant?.enrichedAgeSeconds != null) {
    bits.push(`last assessed ${combatant.enrichedAgeSeconds}s ago — may no longer be accurate`)
  }
  return bits.join(' — ')
}

function CreatureRow({ card, combatant }: { card: RoomCard; combatant?: RoomCombatant }) {
  const targetingYou = combatant?.target?.toLowerCase() === 'you'
  const stale =
    combatant != null &&
    combatant.enrichedAgeSeconds != null &&
    combatant.enrichedAgeSeconds > STALE_AFTER_SECONDS
  const portrait = card.status !== 'dead' && hasArt(card.name, card.noun)

  return (
    <div
      className="flex shrink-0 flex-col items-center gap-0.5"
      title={combatTooltip(card, combatant, stale)}
    >
      <div
        className={`relative flex items-center justify-center rounded-full ${
          targetingYou ? 'ring-2 ring-danger' : ''
        }`}
      >
        {portrait ? (
          <CreatureArt
            name={card.name}
            noun={card.noun}
            lore={card.lore}
            height={36}
            className={`!w-9 rounded-full ${stale ? 'opacity-50' : ''} ${card.status === 'dead' ? 'grayscale opacity-40' : ''}`}
          />
        ) : (
          <span
            className={`flex h-9 w-9 items-center justify-center rounded-full ${DECK_STYLE[card.deck].band} ${
              stale ? 'opacity-50' : ''
            } ${card.status === 'dead' ? 'grayscale opacity-40' : ''}`}
          />
        )}
        {combatant?.offBalance && (
          <span className="absolute -right-0.5 -top-0.5 text-xs leading-none text-accent">⚖</span>
        )}
      </div>
      <span
        className={`max-w-[4.5rem] truncate text-xs ${
          card.status === 'dead' ? 'text-ink-faint line-through' : targetingYou ? 'font-medium text-danger' : 'text-ink'
        }`}
      >
        {card.name}
      </span>
    </div>
  )
}

function ItemChip({
  name,
  canSend,
  reason,
  onTake,
}: {
  name: string
  canSend: boolean
  reason: string | null
  onTake: () => void
}) {
  return (
    <button
      type="button"
      disabled={!canSend}
      title={reason ?? `get ${nounOf(name)}`}
      onClick={onTake}
      className="group flex max-w-full items-center gap-2 rounded px-2 py-1 text-sm text-ink hover:bg-surface-overlay/70 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-accent" />
      <span className="min-w-0 truncate">{name}</span>
      <span className="shrink-0 whitespace-nowrap text-xs text-ink-faint opacity-0 group-hover:opacity-100">take</span>
    </button>
  )
}

/** One kind of thing, labelled, so a hostile creature is never read as a
 * fellow player just because they are sitting next to each other. */
function Group({
  label,
  colorClass,
  children,
}: {
  label: string
  colorClass: string
  children: import('react').ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className={`shrink-0 text-xs font-semibold uppercase tracking-wider ${colorClass}`}>{label}</span>
      {children}
    </div>
  )
}

export function RoomChips({
  cards,
  combatants,
  items,
  className,
}: {
  cards: RoomCard[]
  combatants?: RoomCombatant[]
  /** Bridge's `roomItems` poll. Absent means never asked, `[]` means asked
   * and the floor is bare — those read differently below. */
  items?: string[]
  className?: string
}) {
  const character = useAppStore((s) => s.character)
  const requestIntent = useAppStore((s) => s.requestIntent)
  const [inFlight, setInFlight] = useState(false)
  const timer = useRef<number | null>(null)

  const take = useCallback(
    (name: string) => {
      const state = canSendMacro({ stopLatched: character?.stopLatched, inFlight, connected: !!character })
      if (!state.canSend) return

      const noun = nounOf(name)
      requestIntent('run_macro', { commands: [`get ${noun}`, `stow ${noun}`] })

      setInFlight(true)
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        setInFlight(false)
        timer.current = null
      }, IN_FLIGHT_MS)
    },
    [character, inFlight, requestIntent]
  )

  const shown = sortCards(cards)
  const index = indexCombatants(combatants)

  const byDeck: Record<Deck, RoomCard[]> = { hostile: [], allied: [], people: [] }
  for (const c of shown) byDeck[c.deck].push(c)

  const itemsKnown = items !== undefined
  if (shown.length === 0 && !itemsKnown) return null

  const itemState = canSendMacro({ stopLatched: character?.stopLatched, inFlight, connected: !!character })

  return (
    /*
     * Four quadrants, not one scrolling stack — Dan's own instruction: a
     * hostile creature, an allied one, a player and a floor item are four
     * different kinds of fact, and stacking their labelled groups one above
     * the other still reads as a single crowded list once more than one of
     * them has anything in it. Each cell scrolls on its own instead of one
     * shared region, for the same reason the old single scroll existed —
     * a busy fight filling the hostile cell must not push the people cell
     * (or the floor) out of view entirely behind an unlabelled scrollbar.
     * Empty cells just don't render, so one hostile and one item still read
     * as two clear things rather than an empty 2x2 grid with gaps in it.
     */
    <div className={`grid grid-cols-2 gap-x-3 gap-y-1.5 ${className ?? ''}`}>
      {DECKS.map((deck) =>
        byDeck[deck].length > 0 ? (
          <div key={deck} className="max-h-28 overflow-x-hidden overflow-y-auto">
            <Group label={DECK_LABEL[deck]} colorClass={DECK_STYLE[deck].text}>
              {byDeck[deck].map((c) => (
                <CreatureRow key={c.id} card={c} combatant={combatantFor(c, index)} />
              ))}
            </Group>
          </div>
        ) : null
      )}
      {itemsKnown && (
        <div className="max-h-28 overflow-x-hidden overflow-y-auto">
          <Group label="On the floor" colorClass="text-ink-faint">
            {items!.length > 0 ? (
              items!.map((name, i) => (
                <ItemChip
                  key={`${name}-${i}`}
                  name={name}
                  canSend={itemState.canSend}
                  reason={itemState.reason}
                  onTake={() => take(name)}
                />
              ))
            ) : (
              <span className="text-sm text-ink-faint/70">nothing</span>
            )}
          </Group>
        </div>
      )}
    </div>
  )
}
