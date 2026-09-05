import { useAppStore } from '../../store/useAppStore.ts'
import { RoomCards } from './RoomCards.tsx'
import { fromRoom } from '../../lib/room.ts'
import type { Deck } from '../../lib/cards'
import type { DeckPref } from '../../lib/layout'

/**
 * Everything in the room that can act, as three decks of cards.
 *
 * The panel itself is thin on purpose: all the judgement lives in
 * lib/room.ts, which decides which deck a thing belongs to, and in CardDeck,
 * which decides how much room to give it.
 */
export function RoomPanel({
  deckPrefs,
  onCycleDeck,
}: {
  deckPrefs?: Partial<Record<Deck, DeckPref>>
  onCycleDeck?: (deck: Deck) => void
}) {
  const character = useAppStore((s) => s.character)
  const cards = fromRoom(character)

  if (cards.length === 0) {
    return <p className="text-sm text-ink-faint">Nothing here.</p>
  }

  return <RoomCards cards={cards} prefs={deckPrefs} onCyclePref={onCycleDeck} />
}
