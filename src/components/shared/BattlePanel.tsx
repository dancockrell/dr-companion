import { useAppStore } from '../../store/useAppStore'
import { CardDeck } from './CardDeck'
import { Paperdoll } from './Paperdoll'
import { VitalCluster, vitalsFor } from './VitalCluster'
import { fromRoom } from '../../lib/room'
import type { Deck } from '../../lib/cards'
import type { DeckPref } from '../../lib/layout'

/**
 * You on the left, what is trying to kill you on the right.
 *
 * The paperdoll and the enemy cards belong side by side because that is the
 * comparison a fight actually is: how hurt am I against how many of them and
 * what are they. Split across a header and a panel further down the stack,
 * neither answers the question, and the eye has to travel to assemble it.
 *
 * Allies and people keep their own decks below, because they are context
 * rather than the fight.
 */
export function BattlePanel({
  deckPrefs,
  onCycleDeck,
}: {
  deckPrefs?: Partial<Record<Deck, DeckPref>>
  onCycleDeck?: (deck: Deck) => void
}) {
  const character = useAppStore((s) => s.character)
  const cards = fromRoom(character)

  // Derived, not hand-listed. This array used to name three vitals and the
  // dashboard's named four, and mana was in neither although the bridge sent
  // it on every tick. Two hand-written lists of the same thing is how a field
  // goes missing from both.
  const vitals = vitalsFor(character)

  const hostile = cards.filter((c) => c.deck === 'hostile')
  const rest = cards.filter((c) => c.deck !== 'hostile')

  return (
    <div className="flex flex-col gap-2">
      {/* Wraps rather than squeezing. The you-block is a fixed 170px, so in a
          narrow region the enemy cards were left with too little and fanned
          down to single letters. Letting the two blocks wrap gives the cards
          the full width on the second line, and costs nothing when there is
          room for both. No observer, no measuring: the browser already knows. */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        {/* You. Body and vitals together, because a wound in a leg and a
            health bar at 40% are one situation, not two. */}
        <div className="flex shrink-0 items-start gap-2">
          <Paperdoll
            injuries={character?.injuries ?? {}}
            height={72}
            known={character?.injuries !== undefined}
          />
          <VitalCluster vitals={vitals} height={54} />
        </div>

        {/* Them. */}
        <div className="min-w-[13rem] flex-1">
          {hostile.length > 0 ? (
            <CardDeck
              deck="hostile"
              cards={hostile}
              pref={deckPrefs?.hostile ?? 'auto'}
              onCyclePref={onCycleDeck ? () => onCycleDeck('hostile') : undefined}
            />
          ) : (
            <p className="pt-6 text-sm text-ink-faint">Nothing hostile here.</p>
          )}
        </div>
      </div>

      {rest.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border pt-2">
          {(['allied', 'people'] as Deck[]).map((deck) => (
            <CardDeck
              key={deck}
              deck={deck}
              cards={rest.filter((c) => c.deck === deck)}
              pref={deckPrefs?.[deck] ?? 'auto'}
              onCyclePref={onCycleDeck ? () => onCycleDeck(deck) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  )
}
