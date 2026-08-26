/**
 * The map drawing itself, at whatever size it is given.
 *
 * Split out from MapPanel because the same drawing has to serve two very
 * different jobs: a glance inside a 520px panel, and a window someone leaves
 * open and *watches*. Players know which rooms break scripts, and watching for
 * them is the actual use case — so the same component has to stay legible from
 * a thumbnail up to a full window rather than being two drawings that drift.
 *
 * Room positions come from Lich's `genie_pos`, which carries the layout the
 * community's cartographers built, keyed to Lich's own room ids.
 */
import { useMemo } from 'react'
import type { MapZone, MapZoneRoom } from '../../bridge/types'
import { inkFor } from '../../lib/mapInk'
import { recency, segments, type Trail } from '../../lib/trail'

/**
 * Tags worth shouting about.
 *
 * Not decoration. These are the rooms that end a script: water you have to
 * swim, rooms you can drown in, and anything the mapper marks as costing
 * roundtime to cross. Someone watching the map is usually watching for exactly
 * these, so they get colour rather than a tooltip.
 */
const HAZARD = /water|swim|drown|underwater|obstacle|climb|roundtime|rt/i
const SERVICE = /bank|teller|exchange|healer|empath|guild|shop|repair|depart|altar|shrine|temple|gate|bridge|park/i

/**
 * Colour by what the place is.
 *
 * A map of identical boxes says where you are and nothing else. These are the
 * things players navigate by, so they are the things that get a colour.
 */
const KIND_FILL: Record<string, string> = {
  bank: 'var(--color-accent)',
  healer: 'var(--color-good)',
  guild: 'var(--color-info)',
  temple: 'var(--color-info)',
  shop: 'var(--color-ink-muted)',
  gate: 'var(--color-warn)',
  bridge: 'var(--color-warn)',
  park: 'var(--color-good)',
}

/**
 * How many rooms the map draws at once.
 *
 * The whole zone. Crossing is 1,060 rooms and Genie draws every one of them,
 * which is why a player finds the Bathhouse or the Ranger Circle by looking:
 * the map is a directory of the city, not a diagram of the next junction.
 *
 * This was 220, then 40, on the reasoning that fewer rooms drawn larger would
 * read better. Side by side with Genie that is plainly wrong. Forty unlabelled
 * squares tell you nothing a compass would not, and the density is exactly
 * what makes the thing navigable. The cap survives only as a guard against a
 * pathological zone, set well above anything real.
 */
const LOCAL_CAP = 2000

/**
 * The step between adjacent rooms in the source data, in map units.
 *
 * Measured, not assumed: across Crossing 1,221 connections are 10 apart, 524
 * are 20, 261 are 40. Ten is the unit everything else is a multiple of.
 */
const GRID = 10

export type RoomKind = 'here' | 'route' | 'hazard' | 'service' | 'plain'

export function roomKind(
  r: MapZoneRoom,
  hereId: number | null | undefined,
  onRoute: Set<number | null>
): RoomKind {
  if (r.id === hereId) return 'here'
  if (onRoute.has(r.id)) return 'route'
  const tags = (r.tags ?? []).join(' ')
  if (HAZARD.test(tags)) return 'hazard'
  if (SERVICE.test(tags)) return 'service'
  return 'plain'
}

const FILL: Record<RoomKind, string> = {
  here: 'var(--color-accent)',
  route: 'var(--color-good)',
  hazard: 'var(--color-danger)',
  service: 'var(--color-info)',
  plain: 'var(--map-plain)',
}

export function MapCanvas({
  zone,
  level,
  onRoute,
  onPick,
  /** Pixels per map unit. The map's own coordinates are ~20 apart per room. */
  scale = 1,
  /** Room titles alongside the boxes. Only readable once there is room for them. */
  labels = false,
  /** Scale the whole zone to fill the container instead of drawing at size. */
  fit = false,
  /** Where you have been. Drawn as a stroke over the chart. */
  trail,
}: {
  zone: MapZone
  level: number
  onRoute: Set<number | null>
  onPick: (id: number) => void
  scale?: number
  labels?: boolean
  fit?: boolean
  trail?: Trail
}) {
  /**
   * The cartography is authored on a 10-unit grid: 1,221 of Crossing's
   * connections are exactly 10 apart. The room box has to be smaller than that
   * step or adjacent rooms overlap and the map has no boundaries between its
   * squares at all — which is what it had, because the box was 12 against a
   * step of 10.
   *
   * At 0.62 of the step there is a visible gap on every side, and the corridor
   * between two rooms is drawn rather than implied.
   */
  const box = GRID * 0.62 * scale
  const pad = GRID * 0.6 * scale

  // Only this level. Elanthia is not flat — towers, cellars and bridges share
  // x/y with whatever sits above them, and drawing every z at once makes a
  // knot rather than a map.
  const rooms = useMemo(() => {
    const onLevel = (zone.rooms ?? []).filter(
      (r) => (r.z ?? 0) === level && r.x !== null && r.y !== null
    )
    if (onLevel.length <= LOCAL_CAP) return onLevel

    // Walk outward from where the character is standing, breadth first, so
    // what gets drawn is what is reachable from here rather than whatever
    // happens to be geometrically close across a wall.
    const byId = new Map(onLevel.map((r) => [r.id, r]))
    const start = byId.get(zone.here ?? null) ?? onLevel[0]
    const seen = new Set([start.id])
    const out = [start]
    const queue = [start]
    while (queue.length && out.length < LOCAL_CAP) {
      const r = queue.shift() as MapZoneRoom
      for (const t of r.to ?? []) {
        if (seen.has(t)) continue
        const next = byId.get(t)
        if (!next) continue
        seen.add(t)
        out.push(next)
        queue.push(next)
        if (out.length >= LOCAL_CAP) break
      }
    }
    return out
  }, [zone, level])

  const view = useMemo(() => {
    if (!rooms.length) return null
    const xs = rooms.map((r) => (r.x as number) * scale)
    const ys = rooms.map((r) => (r.y as number) * scale)
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    return {
      minX,
      minY,
      w: Math.max(...xs) - minX + pad * 2,
      h: Math.max(...ys) - minY + pad * 2,
    }
  }, [rooms, scale, pad])

  if (!view) {
    return (
      <p className="p-3 text-xs text-ink-faint">
        No rooms with coordinates on this level.
      </p>
    )
  }

  const index = new Map(rooms.map((r) => [r.id, r]))
  const fresh = trail ? recency(trail) : null

  const px = (r: MapZoneRoom) => (r.x as number) * scale - view.minX + pad
  const py = (r: MapZoneRoom) => (r.y as number) * scale - view.minY + pad

  // Two sizing modes, and the difference matters.
  //
  // `fit` scales the whole zone into whatever box it is given, which is what
  // the inline panel wants: a glance that is always complete, never clipped.
  // Fixed size is for the popped-out window, where zoom is the point and
  // scrolling a large map is the expected way to read it.
  //
  // Drawn at natural size inside a small panel, a zone rendered in the corner
  // and cut off at the bottom — which reads as a broken map rather than a
  // small one.
  const sizing = fit
    ? { width: '100%', height: '100%', preserveAspectRatio: 'xMidYMid slice' }
    : { width: view.w, height: view.h }

  return (
    <svg viewBox={`0 0 ${view.w} ${view.h}`} className="block" {...sizing}>
      <defs>
        {/* Lit from the middle, falling off at the edges. A flat fill running
            hard into the panel border reads as a background; this reads as a
            sheet of paper with a lamp over it, which is what the chart is. */}
        <radialGradient id="map-paper" cx="50%" cy="45%" r="75%">
          <stop offset="0%" stopColor="var(--map-ground)" />
          <stop offset="100%" stopColor="var(--map-ground-edge)" />
        </radialGradient>
      </defs>
      <rect x={0} y={0} width={view.w} height={view.h} fill="url(#map-paper)" />

      {/* Where you have been, over the streets and under the rooms.
       *
       * Drawn as one continuous stroke rather than per-room marks, because the
       * question it answers is about a route and a route is a line. It fades
       * with age so the direction of travel is readable without an arrowhead:
       * the bright end is now.
       *
       * A pair whose two rooms are not both on this level is skipped rather
       * than drawn, which is why these are segments and not a polyline. A
       * character who went up a staircase and came back down would otherwise
       * get a line shot straight across the chart. */}
      {trail &&
        segments(trail).map((seg, i) => {
          const a = index.get(seg.from)
          const z = index.get(seg.to)
          if (!a || !z) return null
          return (
            <line
              key={`trail-${i}`}
              x1={px(a)}
              y1={py(a)}
              x2={px(z)}
              y2={py(z)}
              stroke="var(--map-trail)"
              strokeWidth={Math.max(1.2, 1.6 * scale)}
              strokeLinecap="round"
              // Floored well above nothing: the oldest segment should still be
              // visible as part of the route, just clearly the oldest.
              opacity={0.15 + 0.5 * seg.fresh}
            />
          )
        })}
      {/* Links first, so rooms sit on top of them rather than under. */}
      {/* Streets, doorways and climbs are different acts and were drawn as
          one line. Crossing alone has 662 go-exits, which are entrances into
          buildings, and 118 climbs. A map that cannot tell a road from a door
          is hiding what you navigate by. */}
      {rooms.map((r) =>
        (r.links ?? (r.to ?? []).map((t) => ({ to: t, kind: 'walk' as const }))).map((link) => {
          const other = index.get(link.to)
          if (!other || (other.id ?? 0) <= (r.id ?? 0)) return null

          const style =
            link.kind === 'enter'
              ? { stroke: 'var(--color-accent)', strokeWidth: 0.6 * scale, strokeDasharray: '1.5 1.5', opacity: 0.55 }
              : link.kind === 'climb' || link.kind === 'vertical'
                ? { stroke: 'var(--color-warn)', strokeWidth: 0.9 * scale, strokeDasharray: '0.8 1.2', opacity: 0.7 }
                : { stroke: 'var(--map-line)', strokeWidth: Math.max(0.6, 0.7 * scale), opacity: 0.75 }

          return (
            <line
              key={`${r.id}-${link.to}-${link.kind}`}
              x1={px(r)}
              y1={py(r)}
              x2={px(other)}
              y2={py(other)}
              strokeLinecap="round"
              {...style}
            />
          )
        })
      )}

      {/* One label per named place, at the first room of its cluster.
          Labelling every room of an eight-room guild would print its name
          eight times; labelling none is what made this a diagram. */}
      {(() => {
        const seen = new Set<string>()
        return rooms.map((r) => {
          const place = (r.tags ?? [])[0]
          if (!place) return null
          const title = r.title ?? ''
          const name = title.includes(',') ? title.slice(0, title.indexOf(',')) : title
          if (!name || seen.has(name)) return null
          seen.add(name)
          return (
            <text
              key={`label-${r.id}`}
              x={px(r) + box}
              y={py(r) - box * 0.4}
              fill="var(--color-ink-muted)"
              style={{
                fontSize: Math.max(7, 6.5 * scale),
                pointerEvents: 'none',
                // The annotations on a hand-drawn chart, not interface text:
                // small, letter-spaced, and quiet enough that the geography
                // stays the thing you read first.
                letterSpacing: '0.04em',
                fontVariant: 'small-caps',
                opacity: 0.75,
              }}
            >
              {name}
            </text>
          )
        })
      })()}

      {rooms.map((r) => {
        const kind = roomKind(r, zone.here, onRoute)
        const been = r.id != null ? fresh?.get(r.id) : undefined
        const times = r.id != null ? trail?.visits[r.id] : undefined
        return (
          <g key={r.id} className="cursor-pointer" onClick={() => r.id && onPick(r.id)}>
            {/* A ring on a room you have stood in.
             *
             * The stroke alone is not enough for a circuit: a training loop
             * runs the same four rooms for an hour and the line just retraces
             * itself, so the rooms that matter most are the ones the drawing
             * says least about. The ring marks them, and a room you keep
             * coming back to gets a heavier one. */}
            {been !== undefined && kind !== 'here' && (
              <circle
                cx={px(r)}
                cy={py(r)}
                r={box * 0.78}
                fill="none"
                stroke="var(--map-trail)"
                strokeWidth={Math.min(1.6, 0.4 + (times ?? 1) * 0.15) * scale}
                opacity={0.2 + 0.45 * been}
              />
            )}
            {/* The click target, larger than the room and invisible.
             *
             * A room box has to be smaller than the grid step or the squares
             * overlap, which at normal zoom leaves about six pixels to hit.
             * Fitts' law does not care that it looks fine: a six pixel target
             * is a target you miss. This covers the whole cell, so the
             * clickable area is the square the room occupies rather than the
             * mark drawn inside it. */}
            <rect
              x={px(r) - (GRID * scale) / 2}
              y={py(r) - (GRID * scale) / 2}
              width={GRID * scale}
              height={GRID * scale}
              fill="transparent"
            />
            <title>
              {`${r.title ?? 'Unknown'}\nLich room ${r.id}` +
                (r.uid ? `\ngame uid ${r.uid}` : '') +
                (r.tags?.length ? `\n${r.tags.join(', ')}` : '') +
                (times ? `\nvisited ${times === 1 ? 'once' : `${times} times`} this session` : '')}
            </title>
            <rect
              x={px(r) - box / 2}
              y={py(r) - box / 2}
              width={box}
              height={box}
              rx={Math.max(2, 3 * scale)}
              fill={
                // Where you are and where you are going outrank everything.
                // Under that, the cartographer's own colour: sixteen values
                // they set by hand across the game, which is how Genie's map
                // reads at a glance. Parsed since the first build and thrown
                // away until now.
                kind === 'here' || kind === 'route' || kind === 'hazard'
                  ? FILL[kind]
                  : inkFor(r.mapColour, FILL[kind])
              }
              stroke={
                kind === 'here'
                  ? 'var(--color-accent)'
                  : kind === 'hazard'
                    ? 'var(--color-danger)'
                    : kind === 'service'
                      ? 'var(--color-info)'
                      : 'var(--color-border)'
              }
              strokeWidth={kind === 'here' ? 2.5 * scale : 1 * scale}
            />
            {labels && r.title && (
              <text
                x={px(r) + box}
                y={py(r) + box / 3}
                fontSize={9 * scale}
                fill="var(--color-ink-muted)"
                className="pointer-events-none select-none"
              >
                {r.title}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/**
 * The legend names places the way the game does.
 *
 * It used to say "service", which is not a word DragonRealms uses for
 * anything. The map knows what each room is, so it says: bank, healer, guild,
 * temple, gate. A twenty-year player reading "service" learns that a
 * programmer wrote the label without looking at the game.
 *
 * Only what is actually on screen is listed. A legend explaining colours that
 * are not present is furniture.
 */
export function MapLegend({ kinds }: { kinds?: string[] }) {
  const present = new Set(kinds ?? [])

  const items: Array<[string, string]> = [
    ['here', 'you'],
    ['route', 'route'],
    ['hazard', 'hazard'],
    ...(['bank', 'healer', 'guild', 'temple', 'gate', 'bridge', 'shop', 'park'] as const)
      .filter((k) => present.has(k))
      .map((k) => [k, k] as [string, string]),
  ]

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
      {items.map(([kind, label]) => (
        <span key={kind} className="flex items-center gap-1">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: KIND_FILL[kind] ?? FILL[kind as RoomKind] }}
          />
          {label}
        </span>
      ))}
    </div>
  )
}
