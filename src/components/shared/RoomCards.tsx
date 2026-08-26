import { CardDeck } from './CardDeck'
import { DECKS, type RoomCard } from '../../lib/cards'
import type { DeckPref } from '../../lib/layout'
import type { Deck } from '../../lib/cards'

/**
 * The three decks, in the order the eye should find them in a fight: what is
 * trying to kill you, what is helping, who else is here.
 *
 * Decks never interleave and empty ones do not render. See DESIGN.md S6.
 */
export function RoomCards({
  cards,
  prefs,
  onCyclePref,
}: {
  cards: RoomCard[]
  prefs?: Partial<Record<Deck, DeckPref>>
  onCyclePref?: (deck: Deck) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      {DECKS.map((deck) => (
        <CardDeck
          key={deck}
          deck={deck}
          cards={cards.filter((c) => c.deck === deck)}
          pref={prefs?.[deck] ?? 'auto'}
          onCyclePref={onCyclePref ? () => onCyclePref(deck) : undefined}
        />
      ))}
    </div>
  )
}
