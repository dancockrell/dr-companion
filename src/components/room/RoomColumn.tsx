import { useEffect, useState } from 'react'
import { RoomScene } from './RoomScene'
import { ChatTabs } from './ChatTabs'
import { cachedRoomText, roomTextFor, type RoomText } from '../../lib/roomText'
import { useAppStore } from '../../store/useAppStore'

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
  const here = useAppStore((s) => s.mapHere)
  const zoneLive = useAppStore((s) => s.mapZone)

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
      <RoomScene
        zone={zone}
        room={room ?? 0}
        title={title}
        text={text?.text}
        height={170}
      />

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

      <div className="flex min-h-0 flex-1 flex-col rounded border border-border bg-surface-raised">
        <ChatTabs />
      </div>
    </div>
  )
}
