import { useAppStore } from '../../store/useAppStore'
import { Box } from '../shared/Box'
import { CardDeck } from '../shared/CardDeck'
import { MapPanel } from '../shared/MapPanel'
import { TaskFlowPanel } from './TaskFlowPanel'
import { MindstateBoard } from '../shared/MindstateBoard'
import { Paperdoll } from '../shared/Paperdoll'
import { Portrait } from '../shared/Portrait'
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
 *   - **You** sit top right: portrait, vitals, body. Damage is the first
 *     question in a fight and the answer never moves. The name is not in this
 *     box any more, it reads once beside the zone in the map header, so the
 *     height it was spending on a header row goes to the portrait and doll.
 *   - **Battle, Objects, People** stack under you, in that order. What is
 *     trying to kill you, what is on the floor worth taking, who else is here.
 *   - **Experience** runs under the map, because it is read between fights
 *     rather than during one, and it wants width more than height.
 *   - **Actions** pin to the bottom, and the one stop bar sits under them in
 *     the window frame. Stop is always on screen. That was the promise the app
 *     was built on, and it held better once there was exactly one of it: the
 *     panel used to carry its own Stop and Pause alongside the bar's.
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

  // Every vital the character reports, not a chosen three. Concentration only
  // exists for some guilds, so it appears when it exists rather than being
  // padded in as a zero.
  const vitals: Vital[] = character
    ? [
        { key: 'health', glyph: 'H', label: 'Health', value: character.vitals.health, max: character.vitals.healthMax, tone: 'health' },
        { key: 'spirit', glyph: 'S', label: 'Spirit', value: character.vitals.spirit, max: character.vitals.spiritMax, tone: 'spirit' },
        { key: 'fatigue', glyph: 'F', label: 'Fatigue', value: character.vitals.fatigue, max: character.vitals.fatigueMax, tone: 'stamina' },
        ...(character.vitals.concentrationMax
          ? [
              {
                key: 'concentration',
                glyph: 'C',
                label: 'Concentration',
                value: character.vitals.concentration ?? 0,
                max: character.vitals.concentrationMax,
                tone: 'concentration' as const,
              },
            ]
          : []),
      ]
    : []

  return (
    // The map row has a floor. With plain 1fr it resolved to whatever was
    // left after the auto rows, so a full character with seventy skills ate
    // the height and collapsed the map to two pixels. The most important
    // element on the dashboard cannot be the one that yields.
    <div className="grid h-full min-h-0 flex-1 gap-2 p-2 [grid-template-columns:1fr_minmax(15rem,22rem)] [grid-template-rows:minmax(12rem,1fr)_minmax(0,auto)_auto]">
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
        {/* The doll stays, and it stays whole.
         *
         * A version of this replaced it with a list of only the parts that
         * were hurt, which looked tidier and said less: sixteen locations at a
         * glance became four lines of text you have to read. The doll answers
         * "where am I damaged" without being read at all, and it answers it for
         * every part at once including the ones that are fine. */}
        {/* No header on this box, and the thirty pixels it cost go to the art.
         *
         * The title was the character's name, which now sits beside the zone
         * name in the map header, so "who and where" is one line rather than a
         * word repeated in a box of its own. The pop-out control is gone with
         * it, which is what would have kept the header row alive: it opened the
         * mindstate window, and the Experience box above already carries that
         * same control on the panel it actually belongs to.
         *
         * The portrait and the doll take the space rather than it turning into
         * padding. Both are read at a glance and neither reads well small: the
         * doll is sixteen rectangles and the wound colour is the whole point of
         * it.
         *
         * The row wraps because the right rail is as narrow as 15rem when the
         * window is docked beside the game, and three fixed-width children in a
         * row that cannot wrap overflow instead of stacking. */}
        <Box>
          <div className="flex flex-wrap items-start gap-3">
            <Portrait
              character={character?.name ?? 'You'}
              race={character?.race ?? undefined}
              size={116}
            />
            <Paperdoll
              injuries={character?.injuries ?? {}}
              height={116}
              known={character?.injuries !== undefined}
            />
            <VitalCluster vitals={vitals} height={72} />
          </div>
        </Box>

        {/* Task flows, on the first page.
         *
         * This rail held the paperdoll, the room and two lists, and the thing
         * a player presses most often was not on the page at all - the
         * Activities panel existed and was registered as a pop-out that the
         * dashboard never rendered. */}
        <Box title="Task flows" className="min-h-0">
          <TaskFlowPanel dense={dense} />
        </Box>

        <Box tone="danger" action={popper('room')} className="min-h-0">
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

      {/* What to start. Stop, pause and resume are in the bar below this
          layout, in the window frame, where no arrangement of panels can
          scroll them off. */}
      <div className="col-span-2 row-start-3">
        <ActionsPanel dense={dense} />
      </div>
    </div>
  )
}
