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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, Layers, ZoomIn, ZoomOut, Tag, Download, Upload } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { bridge } from '../bridge'
import { roomKind } from '../lib/mapData'
import { MapCanvas, MapLegend } from './shared/MapCanvas'
import { MapPinBar } from './shared/MapPinBar'
import { QuickTravel } from './shared/QuickTravel'
import { PinPalette } from './shared/PinPalette'
import { PinEditor } from './shared/PinEditor'
import { RoomNudge } from './shared/RoomNudge'
import { PlaceSearch } from './shared/PlaceSearch'
import { useZoneBrowsing } from '../lib/useZoneBrowsing'
import { loadPins, addPin, updatePin, removePin, pinFor, type MapPin } from '../lib/mapPins'
import { exportPinsToFile, importPinsFromFile } from '../lib/pinsFile'
import { loadPlayerMarker, savePlayerMarker } from '../lib/playerMarker'
import { PlayerMarkerEditor } from './shared/PlayerMarkerEditor'
import { PIN_ICON_COMPONENT } from '../lib/pinIcons'
import { isDismissed, dismissNudge, NUDGE_VISIT_THRESHOLD } from '../lib/pinNudge'
import { uniqueTaskName, pinTaskSource } from '../lib/pinTaskGenerator'
import { listScripts, writeScript } from '../lib/scriptFiles'
import { isTauri } from '../lib/tauri'
import { useMapDock, setMapDock, WINDOW_ZOOM_MIN, WINDOW_ZOOM_MAX } from '../lib/mapDock'
import { useMapViewport } from '../lib/useMapViewport'

export function MapWindow() {
  const liveZone = useAppStore((s) => s.mapZone)
  const { zone, browsing, zoneStack, pushZone, popZone, resetZone, goToPlace } =
    useZoneBrowsing(liveZone)
  const path = useAppStore((s) => s.mapPath)
  const connected = useAppStore((s) => s.bridgeConnected)
  const connectBridge = useAppStore((s) => s.connectBridge)

  const [level, setLevel] = useState<number | null>(null)
  /**
   * Zoom, remembered.
   *
   * It reset to 1.5 on every open, which for a window whose entire purpose is
   * to be left up and watched means re-setting it every session. Stored beside
   * the docked map's zoom rather than sharing that number: docked, zoom is a
   * multiple of fit-the-zone; here it is pixels per map unit, and one field
   * would silently mean something different in each window.
   */
  const zoom = useMapDock().windowZoom
  const setZoom = (z: number) => setMapDock({ windowZoom: z })
  const [labels, setLabels] = useState(false)

  /**
   * Scroll-wheel zoom anchored at the cursor, and click-and-drag panning.
   *
   * Replaces plain `overflow-auto` scrolling. A window whose whole point is
   * to be left open and watched deserves to be zoomed and panned the way any
   * map is - toward wherever you're pointing, by grabbing the sheet - not by
   * hunting for a scrollbar or clicking a zoom button four times and landing
   * somewhere else on the chart.
   */
  const {
    containerRef,
    contentRef,
    x: panX,
    y: panY,
    zoom: viewZoom,
    dragging,
    handlers,
    zoomBy,
    centerOn,
    resetPan,
  } = useMapViewport({
    zoom,
    onZoomChange: setZoom,
    min: WINDOW_ZOOM_MIN,
    max: WINDOW_ZOOM_MAX,
  })

  // This window connects for itself. It did not inherit the main window's
  // socket, because it does not share its JavaScript at all.
  useEffect(() => {
    connectBridge()
  }, [connectBridge])

  useEffect(() => {
    if (connected) bridge.requestIntent('map_zone')
  }, [connected])

  const levels = useMemo(() => {
    if (!zone?.rooms) return [0]
    return [...new Set(zone.rooms.map((r) => r.z ?? 0))].sort((a, b) => a - b)
  }, [zone])

  const trail = useAppStore((s) => s.mapTrail)
  const character = useAppStore((s) => s.character)
  const addLog = useAppStore((s) => s.addLog)
  const hereId = useAppStore((s) => s.mapHere?.id ?? null)

  /** The character's own mark on the map - see playerMarker.ts and MapPanel.tsx's matching state. */
  const [markerVersion, setMarkerVersion] = useState(0)
  const [editingMarker, setEditingMarker] = useState(false)
  const playerMarker = useMemo(
    () => (character ? loadPlayerMarker(character.name, character.instance) : undefined),
    [character, markerVersion]
  )

  const onRoute = useMemo(
    () => new Set((path?.ok ? (path.rooms ?? []) : []).map((r) => r.id)),
    [path]
  )

  // Same pin store as the docked panel (see MapPanel.tsx) - a separate
  // webview with its own JavaScript context, but the same localStorage, so a
  // pin added in either window is there the next time this one re-renders.
  // Read straight from storage during render; pinVersion exists only to
  // force a re-read after a write this window made itself.
  const [pinVersion, setPinVersion] = useState(0)
  const { pins, pinsByRoom } = useMemo(() => {
    const list = character ? loadPins(character.name, character.instance) : []
    return { pins: list, pinsByRoom: new Map(list.map((p) => [p.roomId, p])) }
  }, [character, pinVersion])

  const [editingRoom, setEditingRoom] = useState<{ id: number; title: string; existing?: MapPin } | null>(
    null
  )

  function goThere(roomId: number) {
    bridge.requestIntent('map_path', { to: roomId })
    bridge.requestIntent('map_walk', { to: roomId })
  }

  // knownTitle: see MapPanel.tsx's matching note - a nearest-search result
  // is often not in the currently drawn zone's room list at all.
  function pinRoom(id: number, knownTitle?: string) {
    const title = knownTitle ?? zone?.rooms?.find((r) => r.id === id)?.title ?? `Room ${id}`
    setEditingRoom({ id, title, existing: pinFor(pins, id) })
  }

  const hereVisits = hereId != null ? trail.visits[hereId] : undefined
  const showNudge =
    !!character &&
    hereId != null &&
    hereVisits !== undefined &&
    hereVisits >= NUDGE_VISIT_THRESHOLD &&
    !pinFor(pins, hereId) &&
    !isDismissed(character.name, character.instance, hereId)

  function savePin(label: string, color: MapPin['color'], icon: MapPin['icon'], note: MapPin['note']) {
    if (!character || !editingRoom) return
    if (editingRoom.existing) {
      updatePin(character.name, character.instance, editingRoom.existing.id, { label, color, icon, note })
    } else {
      addPin(character.name, character.instance, {
        roomId: editingRoom.id,
        zone: zone?.zone ?? '',
        label,
        color,
        icon,
        note,
      })
    }
    setPinVersion((v) => v + 1)
    setEditingRoom(null)
  }

  /** A preset dragged in from QuickTravel and dropped on a room - see MapPanel.tsx's matching function for why this skips the editor modal. */
  function dropPin(roomId: number, preset: { label: string; icon: MapPin['icon']; color: MapPin['color'] }) {
    if (!character) return
    const already = pinFor(pins, roomId)
    if (already) {
      updatePin(character.name, character.instance, already.id, preset)
    } else {
      addPin(character.name, character.instance, {
        roomId,
        zone: zone?.zone ?? '',
        label: preset.label,
        color: preset.color,
        icon: preset.icon,
      })
    }
    setPinVersion((v) => v + 1)
  }

  /** Save/load pins as a shared file - see pinsFile.ts and MapPanel.tsx's matching pair. */
  async function doExportPins() {
    try {
      const { path } = await exportPinsToFile()
      addLog(`Pins saved to ${path}`)
    } catch (e) {
      addLog(String(e), 'error')
    }
  }
  async function doImportPins() {
    try {
      const { imported, skipped, note } = await importPinsFromFile()
      if (note) {
        addLog(note, 'warn')
        return
      }
      addLog(
        `Imported ${imported} pin${imported === 1 ? '' : 's'}${skipped ? ` (${skipped} skipped)` : ''} from dr-companion-pins.yaml`
      )
      setPinVersion((v) => v + 1)
    } catch (e) {
      addLog(String(e), 'error')
    }
  }

  async function createTaskForPin(pin: MapPin) {
    const existingNames = (await listScripts()).filter((s) => s.lang === 'python').map((s) => s.name)
    const name = uniqueTaskName(existingNames, pin)
    try {
      const path = await writeScript('python', name, pinTaskSource(pin))
      addLog(`Task "${name}" written for ${pin.label} (${path || 'python/tasks/user/'}).`)
    } catch (e) {
      addLog(`Could not write a task for ${pin.label}: ${e instanceof Error ? e.message : e}`, 'error')
    }
    setEditingRoom(null)
  }

  function deletePin() {
    if (!character || !editingRoom?.existing) return
    removePin(character.name, character.instance, editingRoom.existing.id)
    setPinVersion((v) => v + 1)
    setEditingRoom(null)
  }

  const z = level ?? levels[0] ?? 0

  /**
   * Recenter on "here" when the character moves or the level changes - not
   * on every zoom change, which is what the old scroll-based centering did.
   * That made sense when zoom had no anchor point of its own; now that wheel
   * zoom anchors on the cursor and the buttons anchor on the box center (see
   * useMapViewport), re-centering on every zoom step would fight both and
   * always snap back to "here" the moment you zoomed toward anything else.
   */
  const centeredFor = useRef<string | null>(null)
  const onHereAt = useCallback(
    (x: number, y: number) => {
      const key = `${zone?.here}:${z}`
      if (centeredFor.current === key) return
      centeredFor.current = key
      centerOn(x, y)
    },
    [zone?.here, z, centerOn]
  )

  return (
    <>
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
            title="Show room names" aria-label="Show room names"
            onClick={() => setLabels((v) => !v)}
          >
            <Tag className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            className="p-1 rounded border border-border text-ink-faint hover:text-ink disabled:opacity-40"
            title="Zoom out" aria-label="Zoom out"
            disabled={zoom <= WINDOW_ZOOM_MIN}
            onClick={() => zoomBy(1 / 1.3)}
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className="min-w-10 rounded px-1 text-xs tabular-nums text-ink-faint hover:text-ink"
            title="Reset pan"
            onClick={() => resetPan()}
          >
            {zoom.toFixed(1)}x
          </button>
          <button
            type="button"
            className="p-1 rounded border border-border text-ink-faint hover:text-ink disabled:opacity-40"
            title="Zoom in" aria-label="Zoom in"
            disabled={zoom >= WINDOW_ZOOM_MAX}
            onClick={() => zoomBy(1.3)}
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className="p-1 rounded border border-border text-ink-faint hover:text-ink"
            title="Ask Lich for this zone again" aria-label="Ask Lich for this zone again"
            onClick={() => bridge.requestIntent('map_zone')}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          {/* Pins as a file - see pinsFile.ts's header. */}
          {isTauri() && character && (
            <>
              <button
                type="button"
                className="p-1 rounded border border-border text-ink-faint hover:text-ink"
                title="Save every character's pins to dr-companion-pins.yaml, in your Genie Config folder"
                aria-label="Export pins to file"
                onClick={() => void doExportPins()}
              >
                <Download className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                className="p-1 rounded border border-border text-ink-faint hover:text-ink"
                title="Load pins from dr-companion-pins.yaml in your Genie Config folder - a guildmate's shared file, or your own from another machine"
                aria-label="Import pins from file"
                onClick={() => void doImportPins()}
              >
                <Upload className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </header>

      <div className="shrink-0 space-y-1.5 border-b border-border px-3 py-1.5">
        {/* Missing entirely before this: the window built to be left open and
            watched could not search for a place or follow a gateway to
            another zone, while the small docked panel beside it could do
            both. Same component, same onZone wiring MapPanel.tsx uses -
            useZoneBrowsing is the shared piece that makes both surfaces
            capable of the same trip planning. */}
        <PlaceSearch here={zone?.zone} onPick={goToPlace} />

        {browsing && (
          <div className="flex items-center gap-1 text-xs">
            <button
              type="button"
              onClick={popZone}
              className="rounded border border-border px-2 py-0.5 text-ink-muted hover:text-ink"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={resetZone}
              className="rounded border border-accent/40 bg-accent/10 px-2 py-0.5 text-accent"
            >
              Where I am
            </button>
            <span className="truncate text-ink-faint">
              {zone?.name ?? 'Loading'}
              {zoneStack.length > 1 ? ` — ${zoneStack.length} gates out` : ''}
            </span>
          </div>
        )}

        {(pins.length > 0 || hereId != null) && (
          <>
            {/* One shared flex-wrap row, not two - see MapPinBar.tsx's note. */}
            <div className="flex flex-wrap items-center gap-1.5">
              <MapPinBar
                pins={pins}
                onGo={(pin) => goThere(pin.roomId)}
                onEdit={(pin) => setEditingRoom({ id: pin.roomId, title: pin.label, existing: pin })}
                onAddHere={hereId != null ? () => pinRoom(hereId) : undefined}
              />
              <QuickTravel onWalk={goThere} onPin={(hit) => pinRoom(hit.id, hit.title)} />
              {character && playerMarker && (
                <button
                  type="button"
                  onClick={() => setEditingMarker(true)}
                  title="Customize your mark on the map"
                  aria-label="Customize your mark on the map"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border hover:border-accent/60"
                >
                  <span
                    className="flex h-4 w-4 items-center justify-center rounded-full"
                    style={{ background: playerMarker.color }}
                  >
                    {(() => {
                      const Icon = PIN_ICON_COMPONENT[playerMarker.icon]
                      return <Icon className="h-2.5 w-2.5" color="var(--map-ground)" strokeWidth={3} />
                    })()}
                  </span>
                </button>
              )}
            </div>
            {/* Every preset pin type, drag-and-drop onto a room - see PinPalette.tsx's own header. */}
            <PinPalette />
            {showNudge && hereId != null && (
              <RoomNudge
                visits={hereVisits as number}
                onPin={() => pinRoom(hereId)}
                onDismiss={() => {
                  if (character) dismissNudge(character.name, character.instance, hereId)
                  setPinVersion((v) => v + 1)
                }}
              />
            )}
          </>
        )}
      </div>

      <main
        ref={containerRef}
        className={`flex-1 min-h-0 overflow-hidden relative ${
          dragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        style={{ touchAction: 'none' }}
        onWheel={handlers.onWheel}
        onPointerDown={handlers.onPointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onPointerCancel={handlers.onPointerCancel}
        onClickCapture={handlers.onClickCapture}
      >
        {zone?.ok ? (
          <div
            ref={contentRef}
            className={dragging ? '' : 'transition-transform duration-150 ease-out'}
            style={{
              position: 'absolute',
              transform: `translate3d(${panX}px, ${panY}px, 0) scale(${viewZoom})`,
              transformOrigin: '0 0',
              willChange: 'transform',
            }}
          >
            <MapCanvas
              zone={zone}
              level={z}
              onRoute={onRoute}
              labels={labels}
              onPick={goThere}
              onZone={pushZone}
              trail={trail}
              onHereAt={onHereAt}
              pins={pinsByRoom}
              onPinRoom={pinRoom}
              onDropPin={dropPin}
              playerMarker={playerMarker}
            />
          </div>
        ) : (
          <p className="p-3 text-xs text-ink-faint">
            {zone?.reason ??
              (connected
                ? 'Nothing yet. Press refresh, or move a room.'
                : 'No bridge connected.')}
          </p>
        )}
      </main>

      <footer className="shrink-0 flex items-center justify-between gap-3 border-t border-border px-3 py-2">
        {/* Same `roomKind` and `onRoute` the canvas colours by (see MapPanel's
            own copy of this line) - without it this legend always renders
            with no `kinds` at all and silently shows only "you," forever,
            no matter what the window is actually drawing. */}
        <MapLegend
          kinds={[
            ...new Set((zone?.ok ? zone.rooms ?? [] : []).map((r) => roomKind(r, zone?.here, onRoute))),
          ]}
        />
        <span className="text-xs text-ink-faint">
          {path?.ok
            ? `${path.steps} rooms to ${
                path.rooms?.[path.rooms.length - 1]?.title ?? path.to
              }`
            : 'Scroll to zoom, drag to pan, click a room to walk there'}
        </span>
      </footer>
      </div>
      {editingRoom && (
        <PinEditor
          roomId={editingRoom.id}
          roomTitle={editingRoom.title}
          existing={editingRoom.existing}
          onSave={savePin}
          onDelete={editingRoom.existing ? deletePin : undefined}
          onClose={() => setEditingRoom(null)}
          onCreateTask={isTauri() ? createTaskForPin : undefined}
        />
      )}
      {editingMarker && playerMarker && character && (
        <PlayerMarkerEditor
          marker={playerMarker}
          onClose={() => setEditingMarker(false)}
          onSave={(m) => {
            savePlayerMarker(character.name, character.instance, m)
            setMarkerVersion((v) => v + 1)
            setEditingMarker(false)
          }}
        />
      )}
    </>
  )
}
