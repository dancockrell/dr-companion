import { useEffect, useRef, useState } from 'react'
import { RoomScene } from './RoomScene'
import { CombatRadar } from '../shared/CombatRadar'
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
 * The scene answers "where am I" without reading, and who's in it — everyone
 * drawn on the picture itself now, not a list beside it. `RoomChips` used to
 * carry allied, people and anything the radar couldn't position as icons
 * under the scene; that was a second feature saying the same thing the board
 * says, and the two could show a creature twice (once as a marker, once as a
 * chip) or disagree about it. `CombatRadar` in `embedded` mode is now the
 * only place anyone is drawn — hostiles with a real range and relation on
 * its compass, everyone else (allied, people, and any hostile assess has
 * nothing positional to say about) on a wider gallery ring around it. See
 * `CombatRadar`'s own doc comment for the honesty distinction between the
 * two. The description answers "what is here".
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
  // boxes are gone now that this is where the same cards show, drawn on the
  // scene rather than listed beside it. One deck of cards, one place it
  // renders, not two that could disagree about who's in the room.
  const character = useAppStore((s) => s.character)
  const cards = fromRoom(character)
  const roomItems = character?.roomItems

  // The board draws itself for nothing rather than an empty compass over
  // every peaceful room — exactly the kind of chrome this app's
  // icon-and-tooltip standard exists to avoid. It earns its place the
  // moment there is anyone or anything to put on it.
  const boardActive = cards.length > 0 || (roomItems?.length ?? 0) > 0

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
            // that moved out.
            maxHeightVh={60}
            overlay={
              boardActive ? (
                <CombatRadar
                  embedded
                  cards={cards}
                  combatants={character?.roomCombatants ?? []}
                  items={roomItems}
                />
              ) : undefined
            }
          />
        </PanelBoundary>
      </div>

      {/* Actions, description and classes share one card now rather than
          three — same reasoning as the Classes nesting below: a bare
          unbordered row between two bordered boxes reads as broken chrome,
          and a fourth full card for eight buttons is more chrome than
          content. One box, one border, sections inside it divided by a
          rule where they actually need one. */}
      <div className="min-h-0 flex-1 overflow-y-auto rounded border border-border bg-surface-raised p-2">
        <PanelBoundary label="Actions">
          <BattleActionBar />
        </PanelBoundary>

        <div className="mt-1.5 border-t border-border/60 pt-1.5">
          {text?.text ? (
            <p className="text-xs leading-relaxed text-ink-muted">
              <HighlightedText text={text.text} highlights={highlights} offClasses={offClasses} />
            </p>
          ) : (
            <p className="text-xs text-ink-faint">
              {room === null ? 'Not in a room yet.' : 'No description for this room.'}
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
    </div>
  )
}
