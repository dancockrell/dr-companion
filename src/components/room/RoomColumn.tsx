import { useEffect, useState, useSyncExternalStore } from 'react'
import { RoomScene } from './RoomScene'
import { RoomChips } from './RoomChips'
import { TeachingPanel } from './TeachingPanel'
import { StreamTabs } from '../game/StreamTabs'
import { GamePane } from '../game/GamePane'
import { PanelBoundary } from '../shared/PanelBoundary'
import { cachedRoomText, roomTextFor, type RoomText } from '../../lib/roomText'
import { useAppStore } from '../../store/useAppStore'
import { useHighlights } from '../../lib/useHighlights'
import { subscribeGame, streamCharacterState } from '../../lib/gameLink'
import { describeRoomPlayers } from '../../lib/roomOccupants'
import { fromRoom } from '../../lib/room'
import type { RoomPlayer, Sourced } from '../../types/stream'
import { bridge } from '../../bridge'

/**
 * The right half of the window: where you are, and what is being said.
 *
 * The companion started as a dashboard about the character and never showed
 * the game. That is a strange thing for a client to leave out — the room and
 * the conversation are what a MUD actually is, and both were only reachable by
 * looking at the game window beside this one.
 *
 * Three things stacked, in the order you want them. The scene answers "where
 * am I" without reading. The description answers "what is here". The chat is
 * the part you keep half an eye on. The scene gets a fixed share rather than
 * growing, because on a tall window a picture that expands to fill the space
 * pushes the text you are reading off the bottom.
 */
export function RoomColumn() {
  const { highlights } = useHighlights()
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

  /**
   * Who's here and what's on the floor, straight from the game's own stream
   * rather than a bridge poll — see src/types/stream.ts. This is a new,
   * additive display: the People/Objects cards on the dashboard
   * (DashboardLayout.tsx, `fromRoom(character)`) read the *bridge's* idea of
   * the room, a separate source, and are not touched or replaced here. Two
   * panels can legitimately show the same room from two feeds; the dashboard
   * cards keep their existing source, and this column is the one place
   * that's stream-fed. If the two ever visibly disagree that's worth its own
   * look, but resolving it is not this change.
   *
   * Same subscription shape as DashboardLayout's vitals read: `subscribeGame`
   * notifies on any stream update, `streamCharacterState()` is a plain read
   * taken after.
   */
  const stream = useSyncExternalStore(subscribeGame, streamCharacterState, streamCharacterState)

  // Same source DashboardLayout's Battle/People boxes used to read — those
  // boxes are gone now that this is where the same cards show, as chips on
  // the scene rather than a list beside it. One deck of cards, one place it
  // renders, not two that could disagree about who's in the room.
  const character = useAppStore((s) => s.character)
  const cards = fromRoom(character)

  return (
    /*
     * h-full, and it is the whole reason this column works.
     *
     * Without it the root sizes to its content, so on a tall window the three
     * blocks came to 414px inside a 1,474px column and the remaining thousand
     * pixels were the parent's background showing through. A black void down
     * half the app, and the chat panel's flex-1 had nothing to expand into
     * because its parent had already collapsed.
     */
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
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

      <div className="max-h-40 shrink-0 overflow-y-auto rounded border border-border bg-surface-raised p-2">
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
      </div>

      <RoomOccupants players={stream.roomPlayers} />
      <PanelBoundary label="Classes">
        <TeachingPanel />
      </PanelBoundary>

      {/* The game itself, above the channels.
        *
        * This is the pane that turns the app from a companion into a client:
        * every line the game sends, and the line you type back. The channel
        * tabs below it stay, because speech and combat are worth pulling out
        * of the firehose - but the firehose has to exist first, and until now
        * it did not.
        *
        * Given the larger share of the column because it is the thing being
        * read continuously. See docs/ENGINE.md. */}
      <div className="flex min-h-0 flex-[3] flex-col overflow-hidden rounded border border-border bg-surface-raised">
        <PanelBoundary label="Game">
          <GamePane />
        </PanelBoundary>
      </div>

      <div className="flex min-h-0 flex-[2] flex-col rounded border border-border bg-surface-raised">
        <PanelBoundary label="Channels">
          <StreamTabs highlights={highlights} />
        </PanelBoundary>
      </div>
    </div>
  )
}

/**
 * Who else is here, and what's worth picking up — both straight off the
 * game's own stream (`room players` / the loot half of `room objs`).
 *
 * Absent and empty are rendered differently on purpose, per
 * `StreamCharacterState`'s own doc comment: absent means the game has not
 * sent this component yet (nothing to show, so nothing renders — nothing
 * here reads like a broken feature the way a permanent "nobody" line would),
 * empty means the game said so explicitly ("nobody else is here", "nothing
 * on the floor" — a real, current answer, shown as text rather than hidden).
 */
function RoomOccupants({ players }: { players?: Sourced<RoomPlayer[]> }) {
  const playersLine = describeRoomPlayers(players)
  if (!playersLine) return null

  return (
    <div className="shrink-0 rounded border border-border bg-surface-raised px-2 py-1.5 text-xs">
      <p className="truncate text-ink-muted">{playersLine}</p>
    </div>
  )
}
