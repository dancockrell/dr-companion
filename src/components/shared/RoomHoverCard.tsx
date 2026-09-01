/**
 * A real, interactive tooltip for the room under the cursor - not the
 * native SVG `<title>`, which is plain text no click can ever reach.
 * Needed for exactly one reason: Dan's ask was a "clickable box in the
 * tool tip" to mark a room worth watching carefully, and a browser's own
 * hover tooltip cannot contain a checkbox.
 *
 * Only asks Elanthipedia anything for a room the player has marked watched
 * - see watchedRooms.ts and elanthipedia.ts's own one-per-minute floor.
 * Every other room's card is built entirely from what Lich already told
 * this app (title, tags, pin), with the checkbox as the one extra piece of
 * chrome, unhovered rooms costing nothing at all.
 */
import { useEffect, useState } from 'react'
import { Eye, ExternalLink, Loader2 } from 'lucide-react'
import type { MapZoneRoom } from '../../bridge/types'
import { PIN_COLOR_HEX, type MapPin } from '../../lib/mapPins'
import { isWatched, toggleWatched } from '../../lib/watchedRooms'
import { cachedElanthipedia, fetchElanthipedia, type ElanthipediaPage } from '../../lib/elanthipedia'
import type { GameInstance } from '../../types'
import { landmarksFor } from '../../lib/mapLandmarks'
import { PIN_ICON_COMPONENT } from '../../lib/pinIcons'

export function RoomHoverCard({
  room,
  pin,
  x,
  y,
  character,
}: {
  room: MapZoneRoom
  pin?: MapPin
  /** Cursor position relative to the map's own positioning container. */
  x: number
  y: number
  character: { name: string; instance: GameInstance } | null
}) {
  const [watched, setWatched] = useState(() =>
    character && room.id != null ? isWatched(character.name, character.instance, room.id) : false
  )
  const [page, setPage] = useState<ElanthipediaPage | null>(null)
  const [loading, setLoading] = useState(false)
  const landmarks = landmarksFor(room)
  const wikiSearch = room.title
    ? `https://elanthipedia.play.net/Special:Search?search=${encodeURIComponent(room.title)}`
    : 'https://elanthipedia.play.net/'

  // Re-read watched state whenever the hovered room changes - this
  // component is remounted per room (keyed by id in MapCanvas), so this
  // covers the case of re-hovering a room whose watched state changed
  // elsewhere since.
  useEffect(() => {
    setWatched(character && room.id != null ? isWatched(character.name, character.instance, room.id) : false)
  }, [character, room.id])

  // Watching triggers a lookup, capped at once a minute per title by
  // elanthipedia.ts - hovering the same festival room every few seconds
  // shows the cached answer immediately and only actually asks again once
  // a minute has genuinely passed.
  useEffect(() => {
    if (!watched || !room.title) {
      setPage(null)
      return
    }
    const cached = cachedElanthipedia(room.title)
    if (cached) setPage(cached.page)
    let cancelled = false
    setLoading(true)
    void fetchElanthipedia(room.title).then((p) => {
      if (!cancelled) {
        setPage(p)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [watched, room.title])

  const toggle = () => {
    if (!character || room.id == null) return
    setWatched(toggleWatched(character.name, character.instance, room.id))
  }

  return (
    <div
      className="pointer-events-none absolute z-30"
      style={{ left: x + 14, top: y + 14 }}
    >
      <div className="pointer-events-auto w-64 rounded-lg border border-border bg-surface-raised p-2 text-xs shadow-lg">
        <p className="truncate font-medium text-ink" title={room.title ?? undefined}>
          {room.title ?? 'Unknown room'}
        </p>
        <p className="text-ink-faint">Lich room {room.id}</p>
        {room.tags?.length ? (
          <p className="mt-0.5 truncate text-ink-faint" title={room.tags.join(', ')}>
            {room.tags.join(', ')}
          </p>
        ) : null}

        {landmarks.length > 0 && (
          <div className="mt-1.5 border-t border-border pt-1.5">
            {landmarks.map((landmark) => {
              const Icon = PIN_ICON_COMPONENT[landmark.icon]
              return (
                <p key={landmark.kind} className="flex items-center gap-1.5 text-ink-muted">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full" style={{ background: PIN_COLOR_HEX[landmark.color] }}>
                    <Icon className="h-3 w-3 text-surface" />
                  </span>
                  <span><strong className="font-medium text-ink">{landmark.kind}</strong> — {landmark.label}</span>
                </p>
              )
            })}
          </div>
        )}

        <a
          href={wikiSearch}
          target="_blank"
          rel="noreferrer"
          className="mt-1.5 flex items-center gap-1 border-t border-border pt-1.5 text-accent hover:underline"
          title={`Search Elanthipedia for ${room.title ?? 'this room'}`}
        >
          <ExternalLink className="h-3 w-3" /> Look up this place on Elanthipedia
        </a>

        {pin && (
          <div className="mt-1.5 border-t border-border pt-1.5">
            <p className="flex items-center gap-1 font-medium" style={{ color: PIN_COLOR_HEX[pin.color] }}>
              📍 {pin.label}
            </p>
            {pin.note && <p className="mt-0.5 text-ink-muted">{pin.note}</p>}
          </div>
        )}

        {character && room.id != null && (
          <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 border-t border-border pt-1.5 text-ink-muted hover:text-ink">
            <input type="checkbox" checked={watched} onChange={toggle} className="h-3 w-3" />
            <Eye className="h-3 w-3" />
            Watch carefully
            <span className="text-ink-faint">(live Elanthipedia updates, ~1/min)</span>
          </label>
        )}

        {watched && (
          <div className="mt-1.5 border-t border-border pt-1.5">
            {loading && !page && (
              <p className="flex items-center gap-1 text-ink-faint">
                <Loader2 className="h-3 w-3 animate-spin" /> Checking Elanthipedia…
              </p>
            )}
            {page && !page.found && <p className="text-ink-faint">{page.note}</p>}
            {page?.found && (
              <>
                {page.imageUrl && (
                  <img
                    src={page.imageUrl}
                    alt={page.title}
                    className="mt-1 max-h-24 w-full rounded object-cover"
                  />
                )}
                {page.extract && (
                  <p className="mt-1 line-clamp-4 text-ink-muted">{page.extract}</p>
                )}
                <a
                  href={page.pageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 flex items-center gap-1 text-accent hover:underline"
                >
                  <ExternalLink className="h-3 w-3" /> {page.title} on Elanthipedia
                </a>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
