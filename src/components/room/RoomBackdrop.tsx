import { useId, useMemo } from 'react'
import { roomArtUrl } from '../../lib/roomText'

/** A 336x192 thumbnail stretched across the battle field is never acceptable
 * scene art. Keep it out of the renderer completely; a sharp deterministic
 * room fingerprint is a better placeholder until an approved HD scene exists. */
export const MIN_ROOM_ART_WIDTH = 960
export const MIN_ROOM_ART_HEIGHT = 540

/**
 * The picture of the room, or something that stands in for it — pulled out of
 * `RoomScene` so the radar can sit on the same backdrop instead of a flat
 * panel of its own. Two renderers of "what does this room look like" would
 * drift the moment either one changed; one function, two callers.
 *
 * The stand-in matters more than the art does, and will for a while. There are
 * 17,750 rooms and the renderer manages a couple of hundred an hour, so for
 * the next several days almost every room a player walks into will be a room
 * with no picture. A grey box in that slot would make the whole column look
 * broken rather than unfinished.
 *
 * So the stand-in is generated from the room itself and is different for every
 * room. Two rooms should not look alike, and walking from one to the next
 * should be visibly a change even before any art exists.
 */

/** Deterministic per room, so a room looks the same every time you enter it. */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * A palette from what the room is made of.
 *
 * Read off the description rather than the room id, because two neighbouring
 * forest rooms should look like each other and unlike the bank. Terms are
 * checked in order and the first match wins, which is why the specific ones
 * come before the general.
 */
const TERRAIN: Array<[RegExp, [string, string]]> = [
  [/\b(forest|tree|wood|grove|thicket|leaf|leaves|bough)/i, ['#22331f', '#4a6b3a']],
  [/\b(water|river|sea|lake|shore|bay|dock|pier|wave|tide)/i, ['#12283a', '#2f5f7e']],
  [/\b(cave|cavern|tunnel|underground|cellar|crypt|tomb|dark)/i, ['#191720', '#3a3244']],
  [/\b(snow|ice|frozen|frost|glacier)/i, ['#26313d', '#7d94a8']],
  [/\b(desert|sand|dune|arid)/i, ['#3a3020', '#9a8253']],
  [/\b(temple|shrine|altar|chapel|sanctum)/i, ['#2a2233', '#6b5a86']],
  [/\b(shop|store|counter|merchant|stall|market|wares)/i, ['#33291b', '#8a6b3c']],
  [/\b(bank|vault|guild|hall|chamber)/i, ['#222a33', '#546a86']],
  [/\b(inn|tavern|hearth|fire|forge|smith)/i, ['#3a2118', '#96522f']],
  [/\b(road|street|path|lane|avenue|cobble|pavement)/i, ['#2b2823', '#6e685c']],
  [/\b(field|meadow|grass|plain|flatland)/i, ['#2a3020', '#6a7a44']],
]

const DEFAULT_PALETTE: [string, string] = ['#1e232b', '#4c5666']

/** Shared by every caller, so the same room always hashes to the same art
 * regardless of which component asked. */
export function useRoomArt(zone: string, room: number, title?: string | null, text?: string | null) {
  const key = `${zone}-${room}`
  return useMemo(() => {
    const [dark, light] =
      TERRAIN.find(([re]) => re.test(`${title ?? ''} ${text ?? ''}`))?.[1] ?? DEFAULT_PALETTE
    const h = hash(key)

    const horizon = 0.42 + ((h >> 3) % 24) / 100
    const bands = 3 + (h % 3)
    const rows = Array.from({ length: bands }, (_, i) => {
      const seed = (h >> (i * 5)) & 0xff
      return {
        y: horizon + (i / bands) * (1 - horizon),
        h: (1 - horizon) / bands,
        o: 0.18 + (seed % 40) / 100,
        skew: ((seed % 17) - 8) / 100,
      }
    })
    const peaks = Array.from({ length: 5 }, (_, i) => {
      const seed = (h >> (i * 6)) & 0x3f
      return { x: i / 4, y: horizon - 0.03 - (seed % 22) / 100 }
    })
    return { key, dark, light, horizon, rows, peaks }
  }, [key, title, text])
}

/**
 * The layered backdrop itself — fingerprint underneath, real art on top once
 * it exists — with nothing else drawn over it. `RoomScene` adds its title bar
 * and chip gradient on top of this; `CombatRadar` clips it to a circle and
 * adds a scrim so its own rings and names stay legible over whatever the room
 * happens to look like.
 */
export function RoomBackdrop({
  zone,
  room,
  title,
  text,
}: {
  zone: string
  room: number
  title?: string | null
  text?: string | null
}) {
  const art = useRoomArt(zone, room, title, text)
  const artUrl = roomArtUrl(zone, room, title, text)

  /*
   * Unique per rendered instance, not per room.
   *
   * The gradient id was `sky-${art.key}`, and art.key is zone+room - fine
   * while exactly one backdrop existed. CombatRadar now draws one too, so
   * standing in a room with a fight on renders two backdrops for the same
   * room and therefore two elements carrying id="sky-1-1". Measured on the
   * real app: one duplicate id, exactly that one.
   *
   * A duplicate id is not cosmetic in SVG. `fill="url(#sky-1-1)"` resolves to
   * whichever definition the document happens to hold first, so both rects
   * paint from one gradient. They agree today because both instances derive
   * from the same room, which is precisely what makes it easy to leave in -
   * it goes wrong the first time the two differ, and then the wrong one is
   * silently right-looking.
   */
  const uid = useId()
  const skyId = `sky-${art.key}-${uid}`

  return (
    <>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id={skyId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={art.light} stopOpacity="0.55" />
            <stop offset="100%" stopColor={art.dark} />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="100" height="100" fill={`url(#${skyId})`} />
        <polygon
          points={`0,100 ${art.peaks.map((p) => `${p.x * 100},${p.y * 100}`).join(' ')} 100,100`}
          fill={art.dark}
          opacity="0.85"
        />
        {art.rows.map((r, i) => (
          <rect
            key={i}
            x="-5"
            y={r.y * 100}
            width="110"
            height={r.h * 100 + 1}
            fill={art.light}
            opacity={r.o}
            transform={`skewY(${r.skew * 10})`}
          />
        ))}
      </svg>

      {/* The real render, once it exists, on top of the stand-in. Layered
          rather than swapped so there is never a frame of empty box while
          the image loads. */}
      <img
        key={artUrl}
        src={artUrl}
        alt=""
        loading="lazy"
        onLoad={(e) => {
          const image = e.currentTarget
          image.style.opacity =
            image.naturalWidth >= MIN_ROOM_ART_WIDTH && image.naturalHeight >= MIN_ROOM_ART_HEIGHT
              ? '1'
              : '0'
        }}
        onError={(e) => {
          e.currentTarget.style.opacity = '0'
        }}
        className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-300"
      />
    </>
  )
}
