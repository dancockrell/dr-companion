import { useEffect, useState } from 'react'
import { RoomScene } from './RoomScene'
import { RoomChips } from './RoomChips'
import { TeachingPanel } from './TeachingPanel'
import { PanelBoundary } from '../shared/PanelBoundary'
import { cachedRoomText, roomTextFor, type RoomText } from '../../lib/roomText'
import { useAppStore } from '../../store/useAppStore'
import { fromRoom } from '../../lib/room'
import { bridge } from '../../bridge'

/**
 * The battle pane: where you are, and what's in the room with you.
 *
 * Split out of what used to be `RoomColumn` when the game text and channels
 * moved into their own pane (`GameChatColumn`, paired under the zone map
 * instead) — see that file's own header. What's left is the part that is
 * glanced at rather than read continuously: the room picture, its
 * description, who's on offer to teach, and the cards/radar the scene draws
 * as chips. Reassigned the fixed, player-set width the zone map used to
 * hold (see `App.tsx`'s own note on why) because a picture worth reading —
 * legible portraits, name tags that don't collide — needs real pixels the
 * same way the map always did.
 */
export function BattleColumn() {
  const here = useAppStore((s) => s.mapHere)
  const zoneLive = useAppStore((s) => s.mapZone)
  const connected = useAppStore((s) => s.bridgeConnected)

  // MapPanel asks map_zone the moment it mounts, and the status handler asks
  // map_here the moment the room number changes — but this panel can be the
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
    // in does not blank the panel for a frame while a fetch resolves.
    const cached = cachedRoomText(zone, room)
    if (cached) return setText(cached)
    let live = true
    void roomTextFor(zone, room).then((t) => live && setText(t))
    return () => {
      live = false
    }
  }, [zone, room])

  const title = here?.title ?? text?.title ?? null

  // Same source DashboardLayout's Battle/People boxes used to read — those
  // boxes are gone now that this is where the same cards show, as chips on
  // the scene rather than a list beside it. One deck of cards, one place it
  // renders, not two that could disagree about who's in the room.
  const character = useAppStore((s) => s.character)
  const cards = fromRoom(character)

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-2">
      <PanelBoundary label="Scene">
        <RoomScene
          zone={zone}
          room={room ?? 0}
          title={title}
          text={text?.text}
          chips={
            <RoomChips
              cards={cards}
              combatants={character?.roomCombatants}
              items={character?.roomItems}
            />
          }
        />
      </PanelBoundary>

      <div className="shrink-0 rounded border border-border bg-surface-raised p-2">
        {text?.text ? (
          <p className="text-xs leading-relaxed text-ink-muted">{text.text}</p>
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
