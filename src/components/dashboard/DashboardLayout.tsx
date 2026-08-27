import { useAppStore } from '../../store/useAppStore'
import { Box } from '../shared/Box'
import { CardDeck } from '../shared/CardDeck'
import { TaskFlowPanel } from './TaskFlowPanel'
import { MindstateBoard } from '../shared/MindstateBoard'
import { Paperdoll } from '../shared/Paperdoll'
import { Portrait } from '../shared/Portrait'
import { GearNotice } from '../shared/GearNotice'
import { HandsRow } from '../shared/HandsRow'
import { VitalCluster, vitalsFor } from '../shared/VitalCluster'
import { StatusBoard } from '../shared/StatusBoard'
import { ActionsPanel } from '../shared/ActionsPanel'
import { TrainingPanel } from '../shared/TrainingPanel'
import { InventoryPanel } from '../shared/InventoryPanel'
import { RiskBar } from '../shared/RiskBar'
import { ScriptLibraryPanel } from '../shared/ScriptLibraryPanel'
import { PanelBoundary } from '../shared/PanelBoundary'
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
 *   - **Risk, Training and Inventory** sit in the right rail now. All three
 *     were registered panels with real state behind them and no way to ever
 *     see them: `layout.ts`'s default `order` lists them, but this file never
 *     read `order` for anything, and the only other rendering path
 *     (`FreeCanvas`, freeform placement) can only be entered by dragging a
 *     panel that is already on screen — nothing in the app ever turns
 *     freeform on, so it was a locked door with no handle on either side.
 *     Seated here by hand rather than by wiring up `order`, because this file
 *     is deliberately fixed rather than assembled from a registry (see above).
 *
 *     That leaves two sources of truth for "what panels exist" — this grid,
 *     and `layout.order` / `PANEL_CONTENT` in `panels.tsx`, which still feeds
 *     `FreeCanvas` and pop-out windows. **This file is authoritative for what
 *     a player sees by default.** `layout.order` only matters again if
 *     freeform ever becomes reachable. Filed as an issue rather than unified
 *     tonight, because deleting or rewiring that plumbing while several other
 *     sessions are mid-build against it is the kind of cleanup that deletes
 *     what somebody else needed next.
 *
 *   Every box below is wrapped in a `PanelBoundary`. Before this there was no
 *   error boundary anywhere in the app, and one panel throwing — `<GamePane>`
 *   reading connection state before it was guarded — took the entire window
 *   to blank white, Stop button included. A box that crashes now says so in
 *   words and offers Retry; it does not vanish, because a vanished box and an
 *   empty one must never look the same.
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
  /*
   * Derived rather than hand-written here.
   *
   * This array was the mislabelling. It listed Health, Spirit and Fatigue and
   * coloured Fatigue as stamina, so "S" meant spirit where every other window
   * in DragonRealms means stamina, and "F" labelled a bar with no F in its
   * name. Mana was not in the list at all despite the bridge sending it since
   * the first version.
   *
   * Two callers each wrote their own copy of this and neither named the same
   * five bars, which is how it stayed wrong. There is one derivation now and
   * it lives beside the component that draws it.
   */
  const vitals = vitalsFor(character)

  return (
    // The map row has a floor. With plain 1fr it resolved to whatever was
    // left after the auto rows, so a full character with seventy skills ate
    // the height and collapsed the map to two pixels. The most important
    // element on the dashboard cannot be the one that yields.
    <div className="grid h-full min-h-0 flex-1 gap-2 p-2 [grid-template-columns:1fr_minmax(15rem,22rem)] [grid-template-rows:minmax(0,1fr)_auto]">
      {/* Experience now has the whole left column.
       *
       * It used to sit under the map and get whatever height was left, which
       * on a character with seventy skills was not much. The map has a column
       * of its own now, so the board that Dan gives nearly full screen height
       * to in Genie can finally have it here. */}
      <Box title="Experience" action={popper('mindstate')} className="col-start-1 row-start-1 min-h-0">
        <PanelBoundary label="Experience">
          <MindstateBoard skills={character?.skills ?? []} dense={dense} />
        </PanelBoundary>
      </Box>

      {/* You, and then the room, down the right. */}
      <div className="col-start-2 row-start-1 flex min-h-0 flex-col gap-2 overflow-y-auto">
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
          <PanelBoundary label="You">
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

            {/* What is currently happening to you, under what you are made of.
             *
             * This is the half of the pane that was missing. The bars say how
             * much health is left; the statuses say whether you are bleeding,
             * stunned, webbed, poisoned or hidden, and how long the spells
             * holding you together have left. That is what you act on, and none
             * of it was on screen anywhere. */}
            <StatusBoard />

            {/* Who you are and what you are holding. Both were written into
              * CharacterStrip, which nothing mounts, so neither had ever been on
              * screen. See HandsRow. */}
            <HandsRow character={character ?? null} />

            <GearNotice />
          </PanelBoundary>
        </Box>

        {/* Risk, right under the vitals it qualifies.
         *
         * Registered as a panel since its own file was written and never
         * seated anywhere a player could see it - see the note at the top of
         * this file. Favors and burden are read the same way vitals are, in
         * passing, so it sits beside them rather than lower in the rail. */}
        <Box className="min-h-0">
          <PanelBoundary label="Risk">
            <RiskBar />
          </PanelBoundary>
        </Box>

        {/* Task flows, on the first page.
         *
         * This rail held the paperdoll, the room and two lists, and the thing
         * a player presses most often was not on the page at all - the
         * Activities panel existed and was registered as a pop-out that the
         * dashboard never rendered. */}
        <Box title="Task flows" className="min-h-0">
          <PanelBoundary label="Task flows">
            <TaskFlowPanel dense={dense} />
          </PanelBoundary>
        </Box>

        {/* Training, same reason as Risk above: built, live-wired, and dark
            until now. Sits after Task flows because it is the next thing you
            check once you are not mid-fight, not something read continuously. */}
        <Box className="min-h-0">
          <PanelBoundary label="Training">
            <TrainingPanel dense={dense} />
          </PanelBoundary>
        </Box>

        <Box tone="danger" action={popper('room')} className="min-h-0">
          <PanelBoundary label="Battle">
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
          </PanelBoundary>
        </Box>

        <Box title="Objects" count={items.length}>
          <PanelBoundary label="Objects">
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
          </PanelBoundary>
        </Box>

        {/* Inventory, third of the three orphaned panels. Sits beside Objects
            because both answer "what do I have or could have" - what's carried
            versus what's on the floor. */}
        <Box className="min-h-0">
          <PanelBoundary label="Inventory">
            <InventoryPanel dense={dense} />
          </PanelBoundary>
        </Box>

        <Box title="People" count={people.length}>
          <PanelBoundary label="People">
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
          </PanelBoundary>
        </Box>

        {/* Script Library, last in the rail on purpose. It is the whole Lich
            script library, not something read during a fight — everything
            above it answers "what's happening right now"; this answers "what
            else could I run". Same orphan risk as Risk/Training/Inventory
            above: built and registered in panels.tsx, invisible until seated
            here by hand.

            No categoryOf/filter yet — that's UX-3's scriptCatalog.ts, not
            landed in this tree yet. Mounted bare rather than waiting, so it
            is not another built-and-invisible panel; wiring the curated
            taxonomy in is a follow-up, not a blocker on being seen at all. */}
        <Box className="min-h-0">
          <PanelBoundary label="Script Library">
            <ScriptLibraryPanel dense={dense} />
          </PanelBoundary>
        </Box>
      </div>

      {/* What to start. Stop, pause and resume are in the bar below this
          layout, in the window frame, where no arrangement of panels can
          scroll them off. */}
      <div className="col-span-2 row-start-2">
        <PanelBoundary label="Actions">
          <ActionsPanel dense={dense} />
        </PanelBoundary>
      </div>
    </div>
  )
}
