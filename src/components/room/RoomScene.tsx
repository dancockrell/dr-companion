import { useMemo } from 'react'
import { roomArtUrl } from '../../lib/roomText'

/**
 * The picture of the room, or something that stands in for it.
 *
 * The stand-in matters more than the art does, and will for a while. There are
 * 17,750 rooms and the renderer manages a couple of hundred an hour, so for
 * the next several days almost every room a player walks into will be a room
 * with no picture. A grey box in that slot would make the whole column look
 * broken rather than unfinished.
 *
 * So the stand-in is generated from the room itself and is different for every
 * room. That is the point Dan asked for: something "easy to identify". Two
 * rooms should not look alike, and walking from one to the next should be
 * visibly a change even before any art exists — which is a thing the real
 * pictures will also have to do.
 *
 * The bands are drawn from the room's own description, so a forest is green
 * and a cellar is not. It is not a picture of the room. It is a consistent
 * fingerprint of it, which is a different and more achievable thing.
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

export function RoomScene({
  zone,
  room,
  title,
  text,
  height = 150,
}: {
  zone: string
  room: number
  title?: string | null
  text?: string | null
  height?: number
}) {
  const key = `${zone}-${room}`

  const art = useMemo(() => {
    const [dark, light] =
      TERRAIN.find(([re]) => re.test(`${title ?? ''} ${text ?? ''}`))?.[1] ?? DEFAULT_PALETTE
    const h = hash(key)

    // A horizon and a few bands. Enough structure that two rooms are plainly
    // different at a glance, little enough that it never pretends to be a
    // photograph of somewhere.
    const horizon = 0.42 + ((h >> 3) % 24) / 100
    const bands = 3 + (h % 3)
    const rows = Array.from({ length: bands }, (_, i) => {
      const seed = (h >> (i * 5)) & 0xff
      return {
        y: horizon + (i / bands) * (1 - horizon),
        h: (1 - horizon) / bands,
        // Alternating tint, varied per room, so the layers read as ground
        // rather than as a gradient.
        o: 0.18 + (seed % 40) / 100,
        skew: ((seed % 17) - 8) / 100,
      }
    })
    const peaks = Array.from({ length: 5 }, (_, i) => {
      const seed = (h >> (i * 6)) & 0x3f
      return { x: i / 4, y: horizon - 0.03 - (seed % 22) / 100 }
    })
    return { dark, light, horizon, rows, peaks }
  }, [key, title, text])

  return (
    <div
      className="relative w-full overflow-hidden rounded border border-border"
      style={{ height }}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id={`sky-${key}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={art.light} stopOpacity="0.55" />
            <stop offset="100%" stopColor={art.dark} />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="100" height="100" fill={`url(#sky-${key})`} />
        {/* A skyline, so the shape of the room varies and not only its colour. */}
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

      {/* The real render, once it exists, on top of the stand-in.
       *
       * Layered rather than swapped so there is never a frame of empty box
       * while the image loads, and so a room whose art has not been rendered
       * yet degrades to the fingerprint instead of to nothing. */}
      <img
        src={roomArtUrl(zone, room)}
        alt=""
        loading="lazy"
        onError={(e) => {
          e.currentTarget.style.display = 'none'
        }}
        className="absolute inset-0 h-full w-full object-cover"
      />

      {title && (
        <div className="absolute inset-x-0 bottom-0 bg-surface/80 px-2 py-1 text-xs text-ink backdrop-blur-sm">
          <span className="truncate">{title}</span>
        </div>
      )}
    </div>
  )
}
