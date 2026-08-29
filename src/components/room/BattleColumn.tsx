import { useEffect, useRef, useState } from 'react'
import { RoomScene } from './RoomScene'
import { RoomChips } from './RoomChips'
import { CombatRadar, RADAR_ITEM_CAP } from '../shared/CombatRadar'
import { TeachingPanel } from './TeachingPanel'
import { BattleStatus } from './BattleStatus'
import { BattleActionBar } from './BattleActionBar'
import { HighlightedText } from './HighlightedText'
import { PanelBoundary } from '../shared/PanelBoundary'
import { cachedRoomText, roomTextFor, type RoomText } from '../../lib/roomText'
import { useAppStore } from '../../store/useAppStore'
import { useHighlights } from '../../lib/useHighlights'
import { useOffClasses } from '../../lib/offClasses'
import { fromRoom } from '../../lib/room'
import { combatantFor, indexCombatants } from '../../lib/combat'
import { bridge } from '../../bridge'
import { cn } from '../../lib/cn'

/**
 * The battle system, in a pane of its own: where you are, and what is in the
 * room with you.
 *
 * This used to be the top half of a column that also held the game text and
 * the channel tabs — one scrolling stack for "what does the room look like"
 * and "what is being said", which are two different questions asked at two
 * different paces. The picture is glanced at; the chat is read continuously.
 * Splitting them into separate panes means the battle map can get a real
 * width of its own instead of whatever height was left after the text below
 * it took its share, and the chat pane (see `GameChatColumn`) is no longer
 * competing with a combat radar for vertical space mid-fight.
 *
 * The scene answers "where am I" without reading, and who's in it — chips
 * laid over the art itself, not a list beside it. Once there is a fight, the
 * same picture also answers the question chips cannot: where each hostile
 * actually is, in range and relation, the way `assess` reports it, with
 * whatever is on the floor pulled along too, clustered at your feet — see
 * `RoomScene`'s `overlay` slot and `CombatRadar`'s own doc comment. The
 * description answers "what is here".
 */
export function BattleColumn() {
  const here = useAppStore((s) => s.mapHere)
  const zoneLive = useAppStore((s) => s.mapZone)
  const connected = useAppStore((s) => s.bridgeConnected)

  // MapPanel asks map_zone the moment it mounts, and the status handler asks
  // map_here the moment the room number changes — but this pane can be the
  // only one on screen, and a mock status tick carries no room id to change,
  // so neither ever fires unless something asks here too. Without this the
  // scene has nothing to draw from before the map is ever opened.
  useEffect(() => {
    if (!connected) return
    bridge.requestIntent('map_zone')
    bridge.requestIntent('map_here')
  }, [connected])

  // The zone id the description files are keyed by. mapHere carries the room
  // number but not the zone, so the current zone payload supplies it, and
  // Crossing stands in before the bridge has answered — it is where a
  // character starts and the demo opens there.
  const zone = (zoneLive?.ok ? zoneLive.zone : null) ?? '1'
  const room = here?.id ?? null

  const [text, setText] = useState<RoomText | null>(null)

  useEffect(() => {
    if (room === null) return setText(null)
    // The cached read first, so walking back into a room you have already been
    // in does not blank the pane for a frame while a fetch resolves.
    const cached = cachedRoomText(zone, room)
    if (cached) return setText(cached)
    let live = true
    void roomTextFor(zone, room).then((t) => live && setText(t))
    return () => {
      live = false
    }
  }, [zone, room])

  const title = here?.title ?? text?.title ?? null

  // A cue that you moved, not just that the picture changed. Hunting and
  // stalking mean walking through a room every few seconds — `stalk` and a
  // string of directions both do it — and at that pace it is easy to stop
  // consciously registering that the last three "arrivals" actually landed
  // you somewhere new each time; the room fingerprint changes colour, but a
  // shifting background is not the same as a noticed event. A short accent
  // pulse on the frame is: it fires exactly once per room entered, fades on
  // its own, and asks nothing of the player who is not currently confused
  // about where they are.
  const JUST_ARRIVED_MS = 700
  const [justArrived, setJustArrived] = useState(false)
  const prevRoom = useRef<number | null>(null)
  useEffect(() => {
    // Not on mount, and not for the id going *to* null (leaving the game, a
    // stale bridge tick) — only a real room-to-room step should flash.
    if (prevRoom.current !== null && room !== null && room !== prevRoom.current) {
      setJustArrived(true)
      const t = window.setTimeout(() => setJustArrived(false), JUST_ARRIVED_MS)
      prevRoom.current = room
      return () => window.clearTimeout(t)
    }
    prevRoom.current = room
  }, [room])

  const { highlights } = useHighlights()
  const offClasses = useOffClasses()

  // Same source DashboardLayout's Battle/People boxes used to read — those
  // boxes are gone now that this is where the same cards show, as chips on
  // the scene rather than a list beside it. One deck of cards, one place it
  // renders, not two that could disagree about who's in the room.
  const character = useAppStore((s) => s.character)
  const cards = fromRoom(character)

  // The one thing chips cannot show: where each hostile actually is. A chip
  // row says who and how many; range and relation are only in the tooltip,
  // one at a time. The radar is the same data laid out at once, so it only
  // earns its place on the picture when there is a fight to lay out — an
  // empty compass over every peaceful room would be exactly the kind of
  // chrome this app's icon-and-tooltip standard exists to avoid.
  const hostileCards = cards.filter((c) => c.deck === 'hostile' && c.status !== 'dead')
  const radarActive = hostileCards.length > 0

  // Once the radar is drawing on the picture, it has already named and
  // positioned every hostile it could match to an assess entry — a chip
  // repeating that same name, with no position, is strictly less than what
  // is already on screen. Matched the exact way CombatRadar itself matches
  // (same cards, same order, a fresh index), so this is the actual set the
  // radar drew a marker for, not a guess that could disagree with it. Only
  // what the radar has nowhere to put — dead, unassessed, or disengaged —
  // still needs a chip; allied and people cards are untouched, since the
  // radar never draws either.
  //
  // Two duplicate-named hostiles ("a goblin" and "a goblin") cannot be told
  // apart by noun, so combat.ts matches FIFO — first card, first unclaimed
  // combatant of that noun. RoomChips runs that exact same FIFO privately,
  // from its own props, every render. Handing it the *full* combatant list
  // alongside the *trimmed* card list breaks the correspondence: with the
  // radar-matched goblin's card gone, RoomChips' own fresh pass claims that
  // same combatant for whichever goblin card is left — the tooltip on a chip
  // that ought to read "unassessed" would read the radar's own positioned
  // goblin's range and target instead. Measured: it does exactly this.
  //
  // Only pulling the combatants that actually ended up *positioned* out of
  // what RoomChips gets to match against fixes it — not every combatant a
  // card matched here, which would also remove disengaged ones like a
  // goblin that broke off and still needs its own leftover card to find it.
  // With just the positioned ones gone, RoomChips' FIFO walks the same
  // leftover queue this loop leaves behind, so its remaining cards claim the
  // remaining combatants in the same order rather than a re-shuffled one.
  const positionedIds = new Set<string>()
  const positionedCombatantIds = new Set<string>()
  if (radarActive) {
    const index = indexCombatants(character?.roomCombatants)
    for (const card of hostileCards) {
      const combatant = combatantFor(card, index)
      if (combatant && !combatant.disengaged && combatant.range && combatant.relation) {
        positionedIds.add(card.id)
        positionedCombatantIds.add(combatant.id)
      }
    }
  }
  const chipCards = radarActive ? cards.filter((c) => !positionedIds.has(c.id)) : cards
  const chipCombatants = radarActive
    ? character?.roomCombatants?.filter((c) => !positionedCombatantIds.has(c.id))
    : character?.roomCombatants

  // Same idea for the floor: the radar's own cluster already draws the first
  // RADAR_ITEM_CAP items by name, clickable. Chips only need the overflow
  // past that — repeating the ones already on the picture would be the same
  // redundancy, just for items instead of hostiles. `undefined` rather than
  // `[]` for "nothing left over", so RoomChips treats it as un-asked instead
  // of rendering an empty "On the floor" group under a full radar cluster.
  const roomItems = character?.roomItems
  const chipItems = radarActive
    ? roomItems && roomItems.length > RADAR_ITEM_CAP
      ? roomItems.slice(RADAR_ITEM_CAP)
      : undefined
    : roomItems

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-2">
      <PanelBoundary label="Status">
        <BattleStatus />
      </PanelBoundary>

      {/* The pulse lives on this wrapper, not inside RoomScene — RoomScene
          is shared with the legacy composed column and a caller that only
          wants a picture should not have to know about room-transition
          state to get one. `ring-offset` keeps the accent ring outside the
          picture's own border instead of overlapping the title bar text. */}
      <div
        className={cn(
          'rounded ring-0 ring-accent ring-offset-2 ring-offset-surface transition-shadow duration-500',
          justArrived && 'ring-2'
        )}
      >
        <PanelBoundary label="Scene">
          <RoomScene
            zone={zone}
            room={room ?? 0}
            title={title}
            text={text?.text}
            // The default 42vh assumes a game pane and chat log sharing the
            // rest of the column, sized to leave THEM room. This pane's other
            // occupants — status, actions, description — are all happy at
            // whatever height they get, so the picture still gets the
            // majority share rather than a ceiling calibrated for neighbours
            // that moved out. Trimmed from 68 to 56 now that the status strip
            // and the action bar sit above and below it too.
            maxHeightVh={56}
            chips={
              <RoomChips
                cards={chipCards}
                combatants={chipCombatants}
                items={chipItems}
              />
            }
            overlay={
              radarActive ? (
                <CombatRadar
                  embedded
                  cards={hostileCards}
                  combatants={character?.roomCombatants ?? []}
                  items={roomItems}
                />
              ) : undefined
            }
          />
        </PanelBoundary>
      </div>

      <PanelBoundary label="Actions">
        <BattleActionBar />
      </PanelBoundary>

      <div className="min-h-0 flex-1 overflow-y-auto rounded border border-border bg-surface-raised p-2">
        {text?.text ? (
          <p className="text-xs leading-relaxed text-ink-muted">
            <HighlightedText text={text.text} highlights={highlights} offClasses={offClasses} />
          </p>
        ) : (
          <p className="text-xs text-ink-faint">
            {room === null
              ? 'Not in a room yet.'
              : 'No description for this room.'}
          </p>
        )}
        {/* Both ids, for the same reason the map tooltip carries both: Lich's
            room number is what #goto takes and the game's uid is what a player
            sees, they are different numbers, and quoting the wrong one in a
            help channel loses an afternoon. */}
        {room !== null && (
          <p className="mt-1 text-xs text-ink-faint">
            Lich room {room}
            {here?.uid ? `, game uid ${here.uid}` : ''}
          </p>
        )}
        {/* Classes on offer are room-context info same as the description
            above it — a fact about where you are standing, not its own
            feature. Grouped into this box rather than given its own
            border: a bare unbordered line here read as broken chrome
            (floating between two bordered boxes with nothing marking it
            as one thing), and its own titled panel read as a full window
            for what is really one button. A divider inside a box that
            already exists is neither. */}
        <div className="mt-1.5 border-t border-border/60 pt-1.5">
          <PanelBoundary label="Classes">
            <TeachingPanel />
          </PanelBoundary>
        </div>
      </div>
    </div>
  )
}
