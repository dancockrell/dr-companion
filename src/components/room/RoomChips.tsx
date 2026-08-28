import { useCallback, useRef, useState } from 'react'
import { collapse, sortCards, DECKS, DECK_LABEL, DECK_STYLE, type RoomCard, type Deck } from '../../lib/cards'
import { RANGE_WORD, combatantFor, indexCombatants } from '../../lib/combat'
import { CreatureArt } from '../shared/CreatureArt'
import { hasArt } from '../../lib/creatureArt'
import { nounOf } from '../../lib/room'
import { canSendMacro } from '../../lib/canSendMacro'
import { useAppStore } from '../../store/useAppStore'
import type { RoomCombatant } from '../../types'

/**
 * Who's here and what's on the floor, read the way DragonRealms itself reads
 * it — text first, a real portrait when there genuinely is one, grouped the
 * way `assess` groups them: hostile apart from allied apart from everyone
 * else, rather than one flat row where a goblin and a guildmate sit side by
 * side with nothing but a dot telling them apart.
 *
 * Room items moved in here from their own panel below the description
 * (RoomItemsPanel, now deleted) at Dan's direction — a room item belongs on
 * the room, not in a separate list elsewhere in the UI competing for the
 * same attention as the game pane and the channels. The take-on-click
 * mechanics (nounOf, run_macro, the canSendMacro debounce) moved with it
 * unchanged; only where they render changed.
 *
 * Bigger icons and bigger text, per direct feedback that the first pass was
 * too small to actually read at a glance. `hasArt` still gates every
 * portrait — never CreatureArt's letter fallback — so nothing here regresses
 * to the placeholder-heavy version that got called "awful" two rounds ago.
 */

const IN_FLIGHT_MS = 900
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

const STATUS_TEXT: Record<RoomCard['status'], string> = {
  alive: '',
  stunned: 'stunned',
  dead: 'dead',
}

function CreatureRow({ card, combatant }: { card: RoomCard; combatant?: RoomCombatant }) {
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
      className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded px-2 py-1 text-sm ${
        targetingYou ? 'bg-danger/10' : ''
      }`}
      title={stale ? `last assessed ${combatant!.enrichedAgeSeconds}s ago — may no longer be accurate` : undefined}
    >
      {portrait ? (
        <CreatureArt
          name={card.name}
          noun={card.noun}
          lore={card.lore}
          height={32}
          className="!w-8 shrink-0 !rounded-full"
        />
      ) : (
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DECK_STYLE[card.deck].band}`} />
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
      className="group flex shrink-0 items-center gap-2 whitespace-nowrap rounded px-2 py-1 text-sm text-ink hover:bg-surface-overlay/70 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-accent" />
      <span className="truncate">{name}</span>
      <span className="shrink-0 text-xs text-ink-faint opacity-0 group-hover:opacity-100">take</span>
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

  const shown = collapse(sortCards(cards))
  const index = indexCombatants(combatants)

  const byDeck: Record<Deck, RoomCard[]> = { hostile: [], allied: [], people: [] }
  for (const c of shown) byDeck[c.deck].push(c)

  const itemsKnown = items !== undefined
  if (shown.length === 0 && !itemsKnown) return null

  const itemState = canSendMacro({ stopLatched: character?.stopLatched, inFlight, connected: !!character })

  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ''}`}>
      {/* Who's here scrolls on its own — a busy fight can run past the
          scene's height, and when it does the floor below must stay put
          rather than being pushed under the fold with it. Measured: five
          people plus four hostiles clipped "On the floor" out of view
          entirely behind an unlabelled scrollbar before this split. */}
      {shown.length > 0 && (
        <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto">
          {DECKS.map((deck) =>
            byDeck[deck].length > 0 ? (
              <Group key={deck} label={DECK_LABEL[deck]} colorClass={DECK_STYLE[deck].text}>
                {byDeck[deck].map((c) => (
                  <CreatureRow key={c.id} card={c} combatant={combatantFor(c, index)} />
                ))}
              </Group>
            ) : null
          )}
        </div>
      )}
      {itemsKnown && (
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
      )}
    </div>
  )
}
