/**
 * The map.
 *
 * Drawn from Lich's own room graph, which carries the layout the community's
 * cartographers built: `genie_pos` gives each room an x/y/z, `wayto` gives the
 * links, and it is all keyed to Lich room ids. So this is their map work,
 * reached through the data Lich already holds on the player's machine — not a
 * copy of anyone's files, and not a second geography of our own that could
 * disagree with the one `#goto` actually uses.
 *
 * Deliberately not an interactive travel control. Clicking a room asks for a
 * route and shows it; it does not walk anywhere. Moving stays a decision the
 * player makes with the route in front of them.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Map as MapIcon,
  RefreshCw,
  Layers,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { bridge } from '../../bridge'
import type { IntentName } from '../../bridge/types'

/** Room box size and spacing, in SVG units. */
const BOX = 14
const PAD = 26

/**
 * Two heights, because this sits near the top of a 780px window.
 *
 * A map belongs with the location it describes — it is orientation, not a
 * feature to scroll to — but at full size near the top it would push the
 * vitals and the primary action off screen, which is a worse trade. So it
 * opens small enough to see where you are and expands when you want to read
 * it.
 */
const HEIGHT_COMPACT = 'max-h-40'
const HEIGHT_TALL = 'max-h-80'

export function MapPanel() {
  const zone = useAppStore((s) => s.mapZone)
  const path = useAppStore((s) => s.mapPath)
  const connected = useAppStore((s) => s.bridgeConnected)
  const [level, setLevel] = useState<number | null>(null)
  const [tall, setTall] = useState(false)

  // Ask once when the panel appears with a live bridge, and whenever the
  // character changes room enough for the zone to have changed.
  const hereId = useAppStore((s) => s.mapHere?.id ?? null)
  useEffect(() => {
    if (connected) bridge.requestIntent('map_zone' as IntentName)
  }, [connected, hereId])

  const levels = useMemo(() => {
    if (!zone?.rooms) return []
    return [...new Set(zone.rooms.map((r) => r.z ?? 0))].sort((a, b) => a - b)
  }, [zone])

  // Rooms on the level being shown. Elanthia is not flat: towers, cellars and
  // bridges share x/y with whatever is above or below them, and drawing every
  // level at once produces a knot rather than a map.
  const shown = useMemo(() => {
    if (!zone?.rooms) return []
    const z = level ?? levels[0] ?? 0
    return zone.rooms.filter((r) => (r.z ?? 0) === z && r.x !== null && r.y !== null)
  }, [zone, level, levels])

  const view = useMemo(() => {
    if (!shown.length) return null
    const xs = shown.map((r) => r.x as number)
    const ys = shown.map((r) => r.y as number)
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    return {
      minX,
      minY,
      w: Math.max(...xs) - minX + PAD * 2,
      h: Math.max(...ys) - minY + PAD * 2,
    }
  }, [shown])

  const onPath = useMemo(
    () => new Set((path?.ok ? path.rooms ?? [] : []).map((r) => r.id)),
    [path]
  )

  if (!connected) {
    return (
      <Shell>
        <p className="text-xs text-ink-faint leading-relaxed">
          No bridge. In Mock this shows a small invented town; on Live Lich it
          shows the zone you are standing in.
        </p>
      </Shell>
    )
  }

  // "No map" and "an empty map" are different answers and must not look alike.
  if (!zone) {
    return (
      <Shell onRefresh={() => bridge.requestIntent('map_zone' as IntentName)}>
        <p className="text-xs text-ink-faint leading-relaxed">
          Nothing asked for yet. Press refresh, or move a room and it will
          arrive on its own.
        </p>
      </Shell>
    )
  }

  if (!zone.ok) {
    return (
      <Shell onRefresh={() => bridge.requestIntent('map_zone' as IntentName)}>
        <p className="text-xs text-warn leading-relaxed">
          {zone.reason ?? 'Lich has no map for where you are.'}
        </p>
      </Shell>
    )
  }

  return (
    <Shell
      title={zone.name ?? `Zone ${zone.zone}`}
      onRefresh={() => bridge.requestIntent('map_zone' as IntentName)}
      right={
        <div className="flex items-center gap-2">
          {levels.length > 1 && (
            <div className="flex items-center gap-1">
              <Layers className="w-3 h-3 text-ink-faint" />
              {levels.map((z) => (
                <button
                  key={z}
                  type="button"
                  className={`text-[10px] rounded px-1.5 py-0.5 border ${
                    (level ?? levels[0]) === z
                      ? 'border-accent text-accent bg-accent/10'
                      : 'border-border text-ink-faint'
                  }`}
                  onClick={() => setLevel(z)}
                >
                  {z}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="p-1 rounded text-ink-faint hover:text-ink"
            title={tall ? 'Shrink the map' : 'Give the map more room'}
            onClick={() => setTall((v) => !v)}
          >
            {tall ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      }
    >
      {view && (
        <div
          className={`overflow-auto rounded-lg border border-border bg-surface ${
            tall ? HEIGHT_TALL : HEIGHT_COMPACT
          }`}
        >
          <svg
            viewBox={`0 0 ${view.w} ${view.h}`}
            className="w-full"
            style={{ minWidth: Math.min(view.w * 2, 1400) }}
          >
            {/* Links first, so rooms sit on top of them. */}
            {shown.map((r) =>
              (r.to ?? []).map((t) => {
                const other = shown.find((o) => o.id === t)
                // Only draw an edge when both ends are on this level. A link
                // that leaves the zone or changes floor is real, but drawing
                // it to nowhere would invent a corridor.
                if (!other || (other.id ?? 0) <= (r.id ?? 0)) return null
                return (
                  <line
                    key={`${r.id}-${t}`}
                    x1={(r.x as number) - view.minX + PAD}
                    y1={(r.y as number) - view.minY + PAD}
                    x2={(other.x as number) - view.minX + PAD}
                    y2={(other.y as number) - view.minY + PAD}
                    stroke="var(--color-border)"
                    strokeWidth={1.5}
                  />
                )
              })
            )}

            {shown.map((r) => {
              const here = r.id === zone.here
              const routed = onPath.has(r.id)
              return (
                <g key={r.id}>
                  <title>
                    {`${r.title ?? 'Unknown'}\nLich room ${r.id}` +
                      (r.uid ? `\ngame uid ${r.uid}` : '') +
                      (r.tags?.length ? `\n${r.tags.join(', ')}` : '')}
                  </title>
                  <rect
                    x={(r.x as number) - view.minX + PAD - BOX / 2}
                    y={(r.y as number) - view.minY + PAD - BOX / 2}
                    width={BOX}
                    height={BOX}
                    rx={3}
                    className="cursor-pointer"
                    fill={
                      here
                        ? 'var(--color-accent)'
                        : routed
                          ? 'var(--color-good)'
                          : r.tags?.length
                            ? 'var(--color-surface-overlay)'
                            : 'var(--color-surface-raised)'
                    }
                    stroke={
                      here
                        ? 'var(--color-accent)'
                        : r.tags?.length
                          ? 'var(--color-info)'
                          : 'var(--color-border)'
                    }
                    strokeWidth={here ? 2 : 1}
                    onClick={() =>
                      bridge.requestIntent('map_path' as IntentName, { to: r.id })
                    }
                  />
                </g>
              )
            })}
          </svg>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 text-[10px] text-ink-faint">
        <span>
          {zone.rooms?.length ?? 0}
          {zone.truncated ? ` of ${zone.total} rooms (capped)` : ' rooms'}
          {levels.length > 1 ? `, level ${level ?? levels[0]}` : ''}
        </span>
        <span>Click a room for the route. Nothing moves.</span>
      </div>

      {path?.ok && (
        <p className="text-[11px] text-good leading-snug">
          {path.steps} rooms to {path.rooms?.[path.rooms.length - 1]?.title ?? path.to}.
          Not moving — this is the route only.
        </p>
      )}
      {path && !path.ok && (
        <p className="text-[11px] text-warn leading-snug">{path.reason}</p>
      )}
    </Shell>
  )
}

function Shell({
  children,
  title,
  onRefresh,
  right,
}: {
  children: React.ReactNode
  title?: string
  onRefresh?: () => void
  right?: React.ReactNode
}) {
  return (
    <section className="space-y-2 rounded-xl border border-border bg-surface-raised p-3">
      <header className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-medium text-ink-faint uppercase tracking-wider">
          <MapIcon className="w-3.5 h-3.5" />
          {title ?? 'Map'}
        </h3>
        <div className="flex items-center gap-2">
          {right}
          {onRefresh && (
            <button
              type="button"
              className="p-1 rounded text-ink-faint hover:text-ink"
              title="Ask Lich for this zone again"
              onClick={onRefresh}
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </header>
      {children}
    </section>
  )
}
