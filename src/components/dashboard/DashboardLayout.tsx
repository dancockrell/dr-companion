import { useAppStore } from '../../store/useAppStore'
import { Box } from '../shared/Box'
import { CardDeck } from '../shared/CardDeck'
import { MapPanel } from '../shared/MapPanel'
import { MindstateBoard } from '../shared/MindstateBoard'
import { Paperdoll } from '../shared/Paperdoll'
import { VitalCluster, type Vital } from '../shared/VitalCluster'
import { ActionsPanel } from '../shared/ActionsPanel'
import { fromRoom } from '../../lib/room'
import type { Deck } from '../../lib/cards'
import type { DeckPref } from '../../lib/layout'

/**
 * The dashboard.
 *
 * A map, and boxes of cards beside it. That is the whole shape, and it is
 * fixed rather than assembled from a panel registry, because the previous
 * versions laid themselves out in whatever order the registry happened to list
 * and called it a layout.
 *
 * What goes where, and why:
 *
 *   - **The map** takes the main area. It is what players ask for first, and
 *     it is the one thing here that is watched rather than read.
 *   - **You** sit top right: portrait, vitals, body. Identity and damage are
 *     the first questions in a fight and they never move.
 *   - **Battle, Objects, People** stack under you, in that order. What is
 *     trying to kill you, what is on the floor worth taking, who else is here.
 *   - **Experience** runs under the map, because it is read between fights
 *     rather than during one, and it wants width more than height.
 *   - **Actions** pin to the bottom. Stop is always on screen. That was the
 *     promise the app was built on.
 */
export function DashboardLayout({
  dense,
  deckPrefs,
  onCycleDeck,
  onPopOut,
}: {
  dense: boolean
  deckPrefs?: Partial<Record<Deck, DeckPref>>
  onCycleDeck?: (deck: Deck) => void
  /** Tear a box into its own window, for a second monitor or a wide desk. */
  onPopOut?: (id: 'map' | 'room' | 'mindstate') => void
}) {

  const popper = (id: 'map' | 'room' | 'mindstate') =>
    onPopOut ? (
      <button
        type="button"
        onClick={() => onPopOut(id)}
        title="Open in its own window"
        className="text-xs text-ink-faint hover:text-ink"
      >
        ↗
      </button>
    ) : undefined
  const character = useAppStore((s) => s.character)
  const cards = fromRoom(character)

  const hostile = cards.filter((c) => c.deck === 'hostile')
  const people = cards.filter((c) => c.deck === 'people')
  const items = character?.roomItems ?? []

  const vitals: Vital[] = character
    ? [
        { key: 'health', glyph: 'H', label: 'Health', value: character.vitals.health, max: character.vitals.healthMax, tone: 'health' },
        { key: 'spirit', glyph: 'S', label: 'Spirit', value: character.vitals.spirit, max: character.vitals.spiritMax, tone: 'spirit' },
        { key: 'fatigue', glyph: 'F', label: 'Fatigue', value: character.vitals.fatigue, max: character.vitals.fatigueMax, tone: 'stamina' },
      ]
    : []

  return (
    <div className="grid min-h-0 flex-1 gap-2 p-2 [grid-template-columns:1fr_minmax(15rem,22rem)] [grid-template-rows:1fr_auto_auto]">
      {/* The map, given the room it was asked for. */}
      <div className="col-start-1 row-start-1 min-h-0 overflow-hidden rounded border border-border bg-surface-raised">
        <MapPanel plane />
      </div>

      {/* Experience under it: read between fights, wants width not height. */}
      <Box title="Experience" action={popper('mindstate')} className="col-start-1 row-start-2 min-h-0">
        <MindstateBoard skills={character?.skills ?? []} dense={dense} />
      </Box>

      {/* You, and then the room, down the right. */}
      <div className="col-start-2 row-start-1 row-end-3 flex min-h-0 flex-col gap-2">
        <Box title={character?.name ?? 'You'}>
          <div className="flex items-start gap-3">
            {/* The portrait slot. Empty until a picture exists, and shaped now
                so adding one later is a file rather than a refactor. */}
            <div className="h-[72px] w-[54px] shrink-0 rounded-sm border border-border bg-surface-overlay" />
            <Paperdoll
              injuries={character?.injuries ?? {}}
              height={72}
              known={character?.injuries !== undefined}
            />
            <VitalCluster vitals={vitals} height={56} />
          </div>
        </Box>

        <Box title="Battle" tone="danger" count={hostile.length} action={popper('room')} className="min-h-0">
          {hostile.length ? (
            <CardDeck
              deck="hostile"
              cards={hostile}
              pref={deckPrefs?.hostile ?? 'auto'}
              onCyclePref={onCycleDeck ? () => onCycleDeck('hostile') : undefined}
            />
          ) : (
            <p className="text-xs text-ink-faint">Nothing hostile here.</p>
          )}
        </Box>

        <Box title="Objects" count={items.length}>
          {items.length ? (
            <ul className="flex flex-col gap-0.5">
              {items.map((name) => (
                <li key={name} className="truncate text-xs text-ink-muted">
                  {name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-ink-faint">Floor is clear.</p>
          )}
        </Box>

        <Box title="People" count={people.length}>
          {people.length ? (
            <CardDeck
              deck="people"
              cards={people}
              pref={deckPrefs?.people ?? 'auto'}
              onCyclePref={onCycleDeck ? () => onCycleDeck('people') : undefined}
            />
          ) : (
            <p className="text-xs text-ink-faint">Nobody else here.</p>
          )}
        </Box>
      </div>

      {/* Stop, always. */}
      <div className="col-span-2 row-start-3">
        <ActionsPanel dense={dense} />
      </div>
    </div>
  )
}
