import { useMemo } from 'react'
import type { MapZone, MapZoneRoom } from '../../bridge/types'

/**
 * The map, built to beat Genie's rather than to replace it.
 *
 * Genie's automapper is what every player already uses and it is good: rooms
 * on their authored coordinates, lines for the exits, the current room marked.
 * The job here is the same drawing done better — bigger targets, a clearer
 * present room, places named rather than left as identical boxes — and keyed
 * to **Lich** room ids, because Lich is what this app drives and `#goto` takes
 * Lich numbers.
 *
 * Everything on screen is clickable. A map you can only look at is a picture.
 */

/** Smallest gap between adjacent rooms in the source data. */
const STEP = 10
/** Room marks sit inside their cell so neighbours never touch. */
const BOX = STEP * 0.62

/** Places worth finding, in the game's own words. */
const PLACE: Record<string, string> = {
  bank: 'var(--color-accent)',
  healer: 'var(--color-good)',
  guild: 'var(--color-info)',
  temple: 'var(--color-info)',
  gate: 'var(--color-warn)',
  bridge: 'var(--color-warn)',
  shop: 'var(--color-ink-muted)',
  park: 'var(--color-good)',
}

export function MapView({
  zone,
  here,
  route,
  onPick,
  zoom = 2.2,
}: {
  zone: MapZone
  here?: number | null
  route?: Set<number | null>
  onPick?: (id: number) => void
  /** Pixels per map unit. Two-ish keeps a room around 14px: readable, hittable. */
  zoom?: number
}) {
  const rooms = zone.rooms ?? []

  const view = useMemo(() => {
    const placed = rooms.filter((r) => r.x !== null && r.y !== null)
    if (!placed.length) return null

    const xs = placed.map((r) => r.x as number)
    const ys = placed.map((r) => r.y as number)
    const pad = STEP
    const minX = Math.min(...xs) - pad
    const minY = Math.min(...ys) - pad

    return {
      minX,
      minY,
      w: Math.max(...xs) - minX + pad,
      h: Math.max(...ys) - minY + pad,
      index: new Map(placed.map((r) => [r.id, r])),
      placed,
    }
  }, [rooms])

  if (!view) {
    return <p className="p-2 text-xs text-ink-faint">No rooms to draw here.</p>
  }

  const x = (r: MapZoneRoom) => (r.x as number) - view.minX
  const y = (r: MapZoneRoom) => (r.y as number) - view.minY

  return (
    <svg
      viewBox={`0 0 ${view.w} ${view.h}`}
      width={view.w * zoom}
      height={view.h * zoom}
      className="block select-none"
      role="img"
      aria-label={`${zone.name ?? 'Map'}, ${view.placed.length} rooms`}
    >
      {/* Corridors first so rooms sit on top of them. Each pair once. */}
      <g stroke="var(--color-border)" strokeWidth={1.1} strokeLinecap="round">
        {view.placed.map((r) =>
          (r.to ?? []).map((t) => {
            const o = view.index.get(t)
            if (!o || (o.id ?? 0) <= (r.id ?? 0)) return null
            return <line key={`${r.id}-${t}`} x1={x(r)} y1={y(r)} x2={x(o)} y2={y(o)} />
          })
        )}
      </g>

      {view.placed.map((r) => {
        const isHere = r.id === here
        const onRoute = route?.has(r.id ?? null) ?? false
        const place = PLACE[(r.tags ?? [])[0] ?? '']

        return (
          <g
            key={r.id}
            className={onPick ? 'cursor-pointer' : undefined}
            onClick={() => r.id != null && onPick?.(r.id)}
          >
            <title>
              {`${r.title ?? 'Unknown room'}\nLich room ${r.id}`}
            </title>

            {/* The target is the whole cell, not the mark inside it. A room
                drawn at six units is a six-pixel thing to hit otherwise. */}
            <rect
              x={x(r) - STEP / 2}
              y={y(r) - STEP / 2}
              width={STEP}
              height={STEP}
              fill="transparent"
            />

            <rect
              x={x(r) - BOX / 2}
              y={y(r) - BOX / 2}
              width={BOX}
              height={BOX}
              rx={1.4}
              fill={
                isHere
                  ? 'var(--color-accent)'
                  : onRoute
                    ? 'var(--color-good)'
                    : (place ?? 'var(--color-surface-overlay)')
              }
              stroke={isHere ? 'var(--color-accent)' : 'var(--color-border)'}
              strokeWidth={isHere ? 1.6 : 0.5}
            />

            {/* Where you are, marked by more than a fill so it survives a bad
                monitor and a colour deficiency alike. */}
            {isHere && (
              <rect
                x={x(r) - STEP * 0.55}
                y={y(r) - STEP * 0.55}
                width={STEP * 1.1}
                height={STEP * 1.1}
                rx={2}
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth={0.8}
                opacity={0.55}
              />
            )}
          </g>
        )
      })}
    </svg>
  )
}
