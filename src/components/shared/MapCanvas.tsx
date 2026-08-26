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

/**
 * Tags worth shouting about.
 *
 * Not decoration. These are the rooms that end a script: water you have to
 * swim, rooms you can drown in, and anything the mapper marks as costing
 * roundtime to cross. Someone watching the map is usually watching for exactly
 * these, so they get colour rather than a tooltip.
 */
const HAZARD = /water|swim|drown|underwater|obstacle|climb|roundtime|rt/i
const SERVICE = /bank|teller|exchange|healer|empath|guild|shop|repair|depart|altar|shrine/i

/**
 * How many rooms the map draws at once.
 *
 * Not a rendering limit for its own sake: past a few hundred boxes the drawing
 * stops being readable, and Crossing alone is 1,060. What matters is the area
 * around the character, which is what an automapper is for.
 */
const LOCAL_CAP = 220

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
  plain: 'var(--color-surface-raised)',
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
}: {
  zone: MapZone
  level: number
  onRoute: Set<number | null>
  onPick: (id: number) => void
  scale?: number
  labels?: boolean
  fit?: boolean
}) {
  const box = 12 * scale
  const pad = 6 * scale

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
      {/* Links first, so rooms sit on top of them rather than under. */}
      {rooms.map((r) =>
        (r.to ?? []).map((t) => {
          const other = index.get(t)
          // Both ends must be on this level, and each pair drawn once. A link
          // that leaves the zone or changes floor is real, but drawing it to
          // nowhere would invent a corridor that is not there.
          if (!other || (other.id ?? 0) <= (r.id ?? 0)) return null
          return (
            <line
              key={`${r.id}-${t}`}
              x1={px(r)}
              y1={py(r)}
              x2={px(other)}
              y2={py(other)}
              stroke="var(--color-border)"
              strokeWidth={Math.max(1, 1.5 * scale)}
            />
          )
        })
      )}

      {rooms.map((r) => {
        const kind = roomKind(r, zone.here, onRoute)
        return (
          <g key={r.id} className="cursor-pointer" onClick={() => r.id && onPick(r.id)}>
            <title>
              {`${r.title ?? 'Unknown'}\nLich room ${r.id}` +
                (r.uid ? `\ngame uid ${r.uid}` : '') +
                (r.tags?.length ? `\n${r.tags.join(', ')}` : '')}
            </title>
            <rect
              x={px(r) - box / 2}
              y={py(r) - box / 2}
              width={box}
              height={box}
              rx={Math.max(2, 3 * scale)}
              fill={FILL[kind]}
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

/** Shared legend, so the colours mean the same thing in both places. */
export function MapLegend() {
  const items: [RoomKind, string][] = [
    ['here', 'you'],
    ['route', 'route'],
    ['hazard', 'hazard'],
    ['service', 'service'],
  ]
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-ink-faint">
      {items.map(([kind, label]) => (
        <span key={kind} className="flex items-center gap-1">
          <span
            className="inline-block w-2.5 h-2.5 rounded-sm"
            style={{ background: FILL[kind] }}
          />
          {label}
        </span>
      ))}
    </div>
  )
}
