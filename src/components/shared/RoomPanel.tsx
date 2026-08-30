import { useAppStore } from '../../store/useAppStore'
import { RoomCards } from './RoomCards'
import { fromRoom } from '../../lib/room'
import type { Deck } from '../../lib/cards'
import type { DeckPref } from '../../lib/cards'

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
