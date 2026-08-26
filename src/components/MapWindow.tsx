/**
 * The map, popped out into its own window.
 *
 * This exists because of how the map is actually used. It is not a lookup you
 * open, read and close — players know which rooms break scripts and want the
 * map *visible* while they are doing something else. That is a second window
 * you can size and park, not a taller section of a 520px panel.
 *
 * It is a separate webview, so it has its own JavaScript context and its own
 * bridge connection. That is fine: the Lich bridge serves multiple clients,
 * and the mock runs in-process per window. It means this window keeps working
 * if the main one is busy, and it means neither can corrupt the other's state.
 */
import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Layers, ZoomIn, ZoomOut, Tag } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { bridge } from '../bridge'
import type { IntentName } from '../bridge/types'
import { MapCanvas, MapLegend } from './shared/MapCanvas'

const ZOOMS = [1, 1.5, 2, 3]

export function MapWindow() {
  const zone = useAppStore((s) => s.mapZone)
  const path = useAppStore((s) => s.mapPath)
  const connected = useAppStore((s) => s.bridgeConnected)
  const connectBridge = useAppStore((s) => s.connectBridge)

  const [level, setLevel] = useState<number | null>(null)
  const [zoom, setZoom] = useState(1.5)
  const [labels, setLabels] = useState(false)

  // This window connects for itself. It did not inherit the main window's
  // socket, because it does not share its JavaScript at all.
  useEffect(() => {
    connectBridge()
  }, [connectBridge])

  useEffect(() => {
    if (connected) bridge.requestIntent('map_zone' as IntentName)
  }, [connected])

  const levels = useMemo(() => {
    if (!zone?.rooms) return [0]
    return [...new Set(zone.rooms.map((r) => r.z ?? 0))].sort((a, b) => a - b)
  }, [zone])

  const trail = useAppStore((s) => s.mapTrail)

  const onRoute = useMemo(
    () => new Set((path?.ok ? (path.rooms ?? []) : []).map((r) => r.id)),
    [path]
  )

  const z = level ?? levels[0] ?? 0

  return (
    <div className="h-full w-full flex flex-col bg-surface text-ink">
      <header className="shrink-0 flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <h1 className="text-sm font-semibold truncate">
            {zone?.ok ? (zone.name ?? `Zone ${zone.zone}`) : 'Map'}
          </h1>
          <p className="text-xs text-ink-faint truncate">
            {zone?.ok
              ? `${zone.rooms?.length ?? 0}${
                  zone.truncated ? ` of ${zone.total} rooms (capped)` : ' rooms'
                }`
              : connected
                ? 'Waiting for a zone'
                : 'Not connected'}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {levels.length > 1 && (
            <div className="flex items-center gap-1">
              <Layers className="w-3.5 h-3.5 text-ink-faint" />
              {levels.map((lv) => (
                <button
                  key={lv}
                  type="button"
                  className={`text-xs rounded px-1.5 py-0.5 border ${
                    z === lv
                      ? 'border-accent text-accent bg-accent/10'
                      : 'border-border text-ink-faint'
                  }`}
                  onClick={() => setLevel(lv)}
                >
                  {lv}
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            className={`p-1 rounded border ${
              labels ? 'border-accent text-accent' : 'border-border text-ink-faint'
            }`}
            title="Show room names"
            onClick={() => setLabels((v) => !v)}
          >
            <Tag className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            className="p-1 rounded border border-border text-ink-faint hover:text-ink"
            title="Zoom out"
            onClick={() =>
              setZoom((v) => ZOOMS[Math.max(0, ZOOMS.indexOf(v) - 1)] ?? ZOOMS[0])
            }
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className="p-1 rounded border border-border text-ink-faint hover:text-ink"
            title="Zoom in"
            onClick={() =>
              setZoom(
                (v) => ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(v) + 1)] ?? v
              )
            }
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className="p-1 rounded border border-border text-ink-faint hover:text-ink"
            title="Ask Lich for this zone again"
            onClick={() => bridge.requestIntent('map_zone' as IntentName)}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-auto p-3">
        {zone?.ok ? (
          <MapCanvas
            zone={zone}
            level={z}
            onRoute={onRoute}
            scale={zoom}
            labels={labels}
            onPick={(id) => bridge.requestIntent('map_path' as IntentName, { to: id })}
            trail={trail}
          />
        ) : (
          <p className="text-xs text-ink-faint">
            {zone?.reason ??
              (connected
                ? 'Nothing yet. Press refresh, or move a room.'
                : 'No bridge connected.')}
          </p>
        )}
      </main>

      <footer className="shrink-0 flex items-center justify-between gap-3 border-t border-border px-3 py-2">
        <MapLegend />
        <span className="text-xs text-ink-faint">
          {path?.ok
            ? `${path.steps} rooms to ${
                path.rooms?.[path.rooms.length - 1]?.title ?? path.to
              }`
            : 'Click a room for its route'}
        </span>
      </footer>
    </div>
  )
}
