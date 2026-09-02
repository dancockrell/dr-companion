/**
 * The map, inline in the panel.
 *
 * Drawn from Lich's own room graph, which carries the layout the community's
 * cartographers built: `genie_pos` gives each room an x/y/z, `wayto` gives the
 * links, and it is all keyed to Lich room ids. So this is their map work,
 * reached through data Lich already holds on the player's machine — not a copy
 * of anyone's files, and not a second geography of our own free to disagree
 * with the one `#goto` actually uses.
 *
 * The drawing lives in MapCanvas, shared with the popped-out window, so the
 * glance and the watch cannot drift into two different maps.
 *
 * A travel control, at Dan's explicit instruction: clicking a room shows the
 * route and walks it, via map_walk starting Lich's own go2. That reverses
 * this file's original design, where a route was previewed and moving stayed
 * a separate decision - see the comment on `goThere` below.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Map as MapIcon,
  RefreshCw,
  Layers,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  PanelRightClose,
  ZoomIn,
  ZoomOut,
  Download,
  Upload,
} from 'lucide-react'
import { useAppStore, isIntentImplemented } from '../../store/useAppStore'
import { bridge } from '../../bridge'
import { isTauri } from '../../lib/tauri'
import { MapCanvas } from './MapCanvas'
import { useMapDock, setMapDock, ZOOM_MIN, ZOOM_MAX } from '../../lib/mapDock'
import { useMapViewport } from '../../lib/useMapViewport'
import { PlaceSearch } from './PlaceSearch'
import { useZoneBrowsing } from '../../lib/useZoneBrowsing'
import { ZoneLoadNotice } from './ZoneLoadNotice'
import type { PinBrush } from './PinPalette'
import { MapToolRail } from './MapToolRail'
import { PinEditor } from './PinEditor'
import { RoomNudge } from './RoomNudge'
import { addPin, updatePin, removePin, pinFor, type MapPin } from '../../lib/mapPins'
import { exportPinsToFile, readPinsImportPreview, type PinImportPreview } from '../../lib/pinsFile'
import { PinImportDialog } from './PinImportDialog'
import { savePlayerMarker } from '../../lib/playerMarker'
import { useMapPins, usePinsByRoom, usePlayerMarker } from '../../lib/useMapState'
import { PlayerMarkerEditor } from './PlayerMarkerEditor'
import { isDismissed, dismissNudge, NUDGE_VISIT_THRESHOLD } from '../../lib/pinNudge'
import { uniqueTaskName, pinTaskSource } from '../../lib/pinTaskGenerator'
import { listScripts, writeScript } from '../../lib/scriptFiles'
import { closePanelWindow, openPanelWindow, usePanelWindows } from '../../lib/panelWindows'

/**
 * @param plane Fill the height given rather than a fixed box. Set when the map
 *   has a column of its own, where the point is that it is big enough to watch
 *   and a fixed height would waste the space it was given.
 */
export function MapPanel({ plane = false }: { plane?: boolean }) {
  const liveZone = useAppStore((s) => s.mapZone)
  const {
    zone,
    browsing,
    zoneStack,
    zoneLoading,
    zoneLoadError,
    retryZone,
    pushZone,
    popZone,
    resetZone,
    goToPlace,
  } = useZoneBrowsing(liveZone)
  const path = useAppStore((s) => s.mapPath)
  const connected = useAppStore((s) => s.bridgeConnected)
  const hereId = useAppStore((s) => s.mapHere?.id ?? null)
  /**
   * The character's own idea of where it is (`DRRoom`/`Room.current`, on
   * every status tick) versus the map's (`map_here`, a separate query). They
   * are supposed to be the same Lich room id and nothing has ever checked —
   * see issue #6. Only compare when both sides actually know something; a
   * missing value on either side is silence, not a mismatch.
   */
  const characterRoomId = useAppStore((s) => s.character?.location.roomId ?? null)
  const roomMismatch =
    hereId !== null && characterRoomId !== null && String(hereId) !== characterRoomId

  /**
   * True whenever the map on screen is the bundled demo cartography standing
   * in for a live query that failed — issue #36. The banner above the canvas
   * says so in words, but a banner can scroll out of view in a dense panel
   * and the map itself kept rendering exactly as confidently as real data.
   * A player who only glances at the canvas, not the text above it, could
   * walk past a fully-populated map of a place they are not standing in. This
   * drives a persistent, un-scrollable treatment on the canvas itself rather
   * than relying on the banner alone. Same condition as the banner below, on
   * purpose — one boolean, two renderings of the same fact.
   */
  const standingIn = connected && liveZone !== null && !liveZone.ok

  const [level, setLevel] = useState<number | null>(null)
  const [tall, setTall] = useState(false)
  const dock = useMapDock()
  const windows = usePanelWindows()
  const poppedOut = windows.open.includes('map')

  // Native lifecycle events reconcile this shared registry after manual close,
  // while command failures retain the last known state and expose Retry.

  useEffect(() => {
    if (connected) bridge.requestIntent('map_zone')
  }, [connected, hereId])

  const levels = useMemo(() => {
    if (!zone?.rooms) return []
    return [...new Set(zone.rooms.map((r) => r.z ?? 0))].sort((a, b) => a - b)
  }, [zone])

  const trail = useAppStore((s) => s.mapTrail)

  const onRoute = useMemo(
    () => new Set((path?.ok ? (path.rooms ?? []) : []).map((r) => r.id)),
    [path]
  )

  const popOut = () => openPanelWindow('map', 'Map')
  const popBack = () => closePanelWindow('map')
  const windowError = windows.errors.map
  const windowFailure = windowError ? (
    <button
      type="button"
      className="rounded border border-warn/50 bg-warn/10 px-2 py-1 text-left text-xs text-warn"
      onClick={() => void (poppedOut ? popBack() : popOut())}
    >
      {windowError} Retry.
    </button>
  ) : null

  const refresh = () => bridge.requestIntent('map_zone')

  /**
   * Scroll-wheel zoom anchored at the cursor, and click-and-drag panning -
   * same interaction, same hook, as the popped-out window (useMapViewport).
   * Previously this scrolled a container sized to a percentage of the box
   * and centred itself with raw `scrollLeft`/`scrollTop` math on every zoom
   * step; replaced so the docked panel and the popped-out window - which
   * this file's own header already insists must never draw two different
   * maps - don't feel like two different products once you try to move
   * around either one.
   *
   * Active at every zoom, including fit. Keeping one fitted drawing under one
   * transform avoids the old discontinuity where crossing 1x swapped between
   * two differently sized SVGs and made cursor-anchored zoom jump.
   */
  const onMapZoomChange = useCallback((z: number) => setMapDock({ zoom: z }), [])
  const viewport = useMapViewport({
    zoom: dock.zoom,
    onZoomChange: onMapZoomChange,
    min: ZOOM_MIN,
    max: ZOOM_MAX,
  })
  const { containerRef, contentRef, x: panX, y: panY, dragging, handlers, zoomBy, fitView } = viewport

  // The zone's own drawn proportions, reported by MapCanvas. Null until the
  // first zone has rooms to measure, which is also the state where the box
  // should behave exactly as it always did - see the container's style.
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null)

  // A room update must update the view, not only the red "here" marker in an
  // off-screen part of a previously panned map. Return the docked map to fit
  // when live location changes; deliberate browsing keeps its own view.
  useEffect(() => {
    if (browsing) return
    fitView()
  }, [browsing, fitView, hereId, level, zone?.zone])

  const character = useAppStore((s) => s.character)
  const addLog = useAppStore((s) => s.addLog)

  /**
   * The character's own mark on the map - see playerMarker.ts. The shared
   * subscribed snapshot updates after this webview's saves and after the
   * popped-out webview writes the same persistent store.
   */
  const [editingMarker, setEditingMarker] = useState(false)
  const [pinImport, setPinImport] = useState<PinImportPreview | null>(null)
  const playerMarker = usePlayerMarker(character?.name, character?.instance)

  /**
   * Saved places, and the hotbar under the map that walks to them.
   *
   * Loaded per character (Home for one is not Home for another - see
   * mapPins.ts) through a stable external-store snapshot. Local writes notify
   * this document immediately, while `storage` events synchronize the other
   * webview without depending on an unrelated render.
   */
  const [pinBrush, setPinBrush] = useState<PinBrush | null>(null)
  const pins = useMapPins(character?.name, character?.instance)
  const pinsByRoom = usePinsByRoom(pins)

  // Either a fresh pin on this room (no `existing`) or an edit of one already
  // there - one piece of state either way, since PinEditor is the same modal
  // for both and only ever one can be open.
  const [editingRoom, setEditingRoom] = useState<{ id: number; title: string; existing?: MapPin } | null>(
    null
  )

  function goThere(roomId: number) {
    // The preview still fires alongside it - a route highlighted on the
    // chart is useful information about a trip that is now actually
    // happening, not just theoretical. See the comment on the room click
    // handler below for why this now moves the character at all.
    bridge.requestIntent('map_path', { to: roomId })
    bridge.requestIntent('map_walk', { to: roomId })
  }

  /**
   * @param knownTitle Pass this when the caller already has the room's real
   *   name from somewhere other than the drawn zone - QuickTravel's nearest
   *   results are found via a separate map_nearest query and are often not
   *   in the currently drawn zone's room list at all, so the `zone?.rooms`
   *   lookup below would silently fall back to "Room 1234" for a bank the
   *   game happily named. Letting the caller hand over what it already
   *   knows beats re-deriving it badly.
   */
  function pinRoom(id: number, knownTitle?: string) {
    const title = knownTitle ?? zone?.rooms?.find((r) => r.id === id)?.title ?? `Room ${id}`
    setEditingRoom({ id, title, existing: pinFor(pins, id) })
  }

  // "You've stood here N times - pin it?" Only for the room the character is
  // standing in right now, not a scan across every room ever visited - the
  // question only makes sense about somewhere you could pin with one click.
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
    setEditingRoom(null)
  }

  /**
   * A preset dragged in from QuickTravel and dropped on a room - creates the
   * pin immediately, skipping the editor modal entirely. That is the whole
   * point of a drag: the icon and label were already chosen by picking which
   * button to drag, so asking again in a dialog would make the gesture no
   * faster than right-click-and-fill-in-the-form. If the room already has a
   * pin, it is overwritten rather than stacked - the same rule addPin's
   * caller already follows everywhere else a room can only carry one pin.
   */
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
  }

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
      const { preview, note, error } = await readPinsImportPreview()
      if (note) {
        addLog(note, 'warn')
        return
      }
      if (error) {
        addLog(error, 'error')
        return
      }
      if (preview) setPinImport(preview)
    } catch (e) {
      addLog(String(e), 'error')
    }
  }

  // Writes a real python/tasks/user/walk_to_<pin>.py - see pinTaskGenerator.ts
  // for why generation, not overwrite, is the right default the moment a
  // player might have edited a previously-generated file by hand.
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
    setEditingRoom(null)
  }
  if (!connected) {
    return (
      <Shell plane={plane}>
        <p className="text-xs text-ink-faint leading-relaxed">
          No bridge. In Mock this shows a small invented town; on Live Lich it
          shows the zone you are standing in.
        </p>
      </Shell>
    )
  }

  // The map is in its own window. Say where it went and offer it back, rather
  // than leaving a mystery gap under the location line.
  if (poppedOut) {
    return (
      <Shell
        plane={plane}
        title="Map"
        right={
          <button
            type="button"
            className="flex items-center gap-1 text-xs rounded border border-border px-2 py-0.5 text-ink-muted hover:text-ink"
            onClick={() => void popBack()}
            disabled={windows.pending.map === 'closing'}
          >
            <PanelRightClose className="w-3 h-3" />
            {windows.pending.map === 'closing' ? 'Closing…' : 'Bring it back'}
          </button>
        }
      >
        {windowFailure}
        <p className="text-xs text-ink-faint leading-relaxed">
          Open in its own window, where it is big enough to watch.
        </p>
      </Shell>
    )
  }

  // "No map" and "an empty map" are different answers, and must not look alike.
  if (!zone) {
    return (
      <Shell plane={plane} onRefresh={refresh} onPopOut={isTauri() ? popOut : undefined}>
        {windowFailure}
        <ZoneLoadNotice
          loading={zoneLoading}
          error={zoneLoadError}
          onRetry={retryZone}
          hasMap={false}
        />
        {!zoneLoading && !zoneLoadError && (
          <p className="text-xs text-ink-faint leading-relaxed">
            Nothing asked for yet. Press refresh, or move a room and it will
            arrive on its own.
          </p>
        )}
      </Shell>
    )
  }

  if (!zone.ok) {
    return (
      <Shell plane={plane} onRefresh={refresh} onPopOut={isTauri() ? popOut : undefined}>
        {windowFailure}
        <p className="text-xs text-warn leading-relaxed">
          {zone.reason ?? 'Lich has no map for where you are.'}
        </p>
        <MapdbInstallControl />
      </Shell>
    )
  }

  const z = level ?? levels[0] ?? 0

  // True whenever the drawn zone is the bundled stand-in rather than Lich's
  // own geography for where the character actually is - see issue #36. The
  // banner below already says so in words, but words scroll out of view and
  // this map is watched more than it is read. The fix has to hold up the way
  // the issue's own bar states it: force mapZone to {ok:false} against a
  // connected bridge and confirm the rendered map cannot be mistaken for
  // live data, not just that a sentence above it once said so.
  const demoStandIn = connected && liveZone !== null && !liveZone.ok

  return (
    <>
    <Shell
      plane={plane}
      title={zone.name ?? `Zone ${zone.zone}`}
      onRefresh={refresh}
      onPopOut={isTauri() ? popOut : undefined}
      onExportPins={isTauri() && character ? doExportPins : undefined}
      onImportPins={isTauri() && character ? doImportPins : undefined}
      search={<PlaceSearch here={zone.zone} onPick={goToPlace} onZone={pushZone} />}
      right={
        <div className="flex items-center gap-2">
          {/* Levels and zoom, in the header itself rather than a row of
              their own below it. That second row was a real fix for a real
              measurement once (the docked card's 300px title box left "Dan
              the Bold" rendering at 0px when these were squeezed in beside
              it), but the map now lives in a plane wide enough - 800px and
              up, measured - that the old squeeze does not happen, and a
              second row was 30px of chrome bought for a problem this layout
              no longer has. Docked stays narrow and keeps only the levels
              plus a height toggle, no zoom row it never had. */}
          {levels.length > 1 && (
            <div className="flex items-center gap-1">
              <Layers className="w-3 h-3 text-ink-faint" />
              {levels.map((lv) => (
                <button
                  key={lv}
                  type="button"
                  className={`text-xs rounded px-1.5 py-0.5 border ${
                    z === lv
                      ? 'border-accent text-accent bg-accent/10'
                      : 'border-border text-ink-faint'
                  }`}
                  aria-label={`Level ${lv}`}
                  aria-pressed={z === lv}
                  onClick={() => setLevel(lv)}
                >
                  {lv}
                </button>
              ))}
            </div>
          )}
          {plane ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="rounded p-1 text-ink-faint hover:text-ink disabled:opacity-40"
                title="Zoom out"
                aria-label="Zoom out"
                disabled={dock.zoom <= ZOOM_MIN}
                onClick={() => zoomBy(1 / 1.3)}
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                className="min-w-8 rounded px-1 text-xs tabular-nums text-ink-faint hover:text-ink"
                title="Back to the whole zone"
                onClick={() => fitView()}
              >
                {dock.zoom === 1 ? 'fit' : `${dock.zoom.toFixed(1)}x`}
              </button>
              <button
                type="button"
                className="rounded p-1 text-ink-faint hover:text-ink disabled:opacity-40"
                title="Zoom in"
                aria-label="Zoom in"
                disabled={dock.zoom >= ZOOM_MAX}
                onClick={() => zoomBy(1.3)}
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="p-1 rounded text-ink-faint hover:text-ink"
              title={tall ? 'Shrink the map' : 'Give the map more room'}
              aria-label={tall ? 'Shrink the map' : 'Give the map more room'}
              onClick={() => setTall((v) => !v)}
            >
              {tall ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>
      }
    >
      {windowFailure}
      <ZoneLoadNotice loading={zoneLoading} error={zoneLoadError} onRetry={retryZone} />

      <MapToolRail
        marker={character ? playerMarker : undefined}
        onCustomizeMarker={character && playerMarker ? () => setEditingMarker(true) : undefined}
        pins={pins}
        onGoPin={(pin) => goThere(pin.roomId)}
        onEditPin={(pin) => setEditingRoom({ id: pin.roomId, title: pin.label, existing: pin })}
        onAddHere={hereId != null ? () => pinRoom(hereId) : undefined}
        onWalk={goThere}
        onPinNearest={(hit) => pinRoom(hit.id, hit.title)}
        selected={pinBrush}
        onSelect={setPinBrush}
      />

      {showNudge && hereId != null && (
        <RoomNudge
          visits={hereVisits as number}
          onPin={() => pinRoom(hereId)}
          onDismiss={() => {
            if (character) dismissNudge(character.name, character.instance, hereId)
          }}
        />
      )}

      {/*
       * This is the common shape of "no map database", not the `!zone.ok`
       * branch above. That branch only fires when even the shipped built-in
       * cartography fails to load — but the built-in zone loads successfully
       * almost always, so `zone` here is quietly the bundled Crossing data,
       * not live Lich geography, and nothing said so. Checking `liveZone`
       * directly rather than the merged `zone` is what actually catches it:
       * connected, asked, and told no. Verified against a running mock by
       * forcing mapZone to {ok:false} — the merged `zone` still rendered the
       * full built-in Crossing map with no visible sign anything was wrong.
       */}
      {demoStandIn && (
        <div className="rounded border border-warn/30 bg-warn/5 px-2 py-1.5">
          <p className="text-xs text-warn leading-snug">
            {liveZone?.reason ?? 'Lich has no map for where you are.'} Showing
            the built-in Crossing map below instead — it is not where you are.
          </p>
          <MapdbInstallControl />
        </div>
      )}

      {roomMismatch && (
        <p className="text-xs text-warn leading-snug" title={`Map says room ${hereId}; character reports room ${characterRoomId}`}>
          Map and character disagree about the room — the map may be drawing
          the wrong place.
        </p>
      )}

      {/* A real height, not a max. `fit` scales the zone into whatever box it
          is given, and a max-height box collapses to the content's own size —
          which for a small zone is a stamp in the corner.
          In plane mode the height comes from the column instead. */}
      <div className={plane ? 'flex min-h-0 flex-1 gap-2' : 'contents'}>
      <div
        ref={containerRef}
        title="Map colours: dark you, red hazard, blue bank/healer/guild/shop"
        className={`relative rounded ${
          `overflow-hidden ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`
        } ${plane ? (naturalSize ? 'h-full min-h-0' : 'flex-1 min-h-0') : ''}`}
        style={{
          // The page, behind and around the chart. Letterboxing in the app's
          // dark surface would read as the map having been cut off rather than
          // as a sheet that does not fill the box.
          background: 'var(--map-ground)',
          ...(plane ? {} : { height: tall ? 320 : 168 }),
          // Take the width the chart actually occupies, not the whole column.
          //
          // `fit` preserves the zone's aspect, so a portrait zone (Crossing is
          // 995x1148) in a landscape column drew at 54% of the width and left
          // 351px painted as bare page - it read as a half-empty sheet rather
          // than as space. Giving the box the zone's own aspect ratio makes
          // the browser derive the width from the height, so the page ends
          // where the chart does and the remainder becomes a real slot beside
          // it. CSS derives it rather than a measured pixel width, which keeps
          // it correct through column drags and window resizes without a
          // second size observer. `maxWidth` matters for the opposite case: a
          // landscape zone would otherwise demand more width than the column
          // has, and is letterboxed vertically instead, exactly as before.
          ...(plane && naturalSize
            ? { aspectRatio: `${naturalSize.w} / ${naturalSize.h}`, maxWidth: '100%', flex: '0 1 auto' }
            : {}),
          touchAction: 'none',
        }}
        onWheel={handlers.onWheel}
        onPointerDown={handlers.onPointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onPointerCancel={handlers.onPointerCancel}
        onClickCapture={handlers.onClickCapture}
      >
        {/* Pinned to this box, not to the zoomed/panned content inside it — a
         * sibling of the scaled div below, not a child, so panning or zooming
         * the demo map cannot carry the badge out of view the way scrolling
         * past the banner above already can. This is the un-scrollable half
         * of issue #36's fix; the banner text is the explanation, this is
         * the thing that survives a glance that skips the text entirely. */}
        {standingIn && (
          <div
            className="pointer-events-none absolute left-1.5 top-1.5 z-10 rounded border border-warn/50 bg-surface/90 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-warn shadow"
            title="Bundled Crossing map, not Lich's view of where you are"
          >
            Demo map — not your location
          </div>
        )}
        <div
          ref={contentRef}
          className={`${standingIn ? 'grayscale-[60%] opacity-70' : ''} ${
            dragging ? '' : 'transition-transform duration-150 ease-out'
          }`}
          style={{
            position: 'absolute',
            inset: 0,
            transform: `translate3d(${panX}px, ${panY}px, 0) scale(${dock.zoom})`,
            transformOrigin: '0 0',
            willChange: 'transform',
            ...(demoStandIn ? { filter: 'grayscale(0.85) brightness(0.55)' } : {}),
          }}
        >
          <MapCanvas
            zone={zone}
            level={z}
            onRoute={onRoute}
            fit
            onNaturalSize={setNaturalSize}
            onPick={pinBrush ? (roomId) => { dropPin(roomId, pinBrush); setPinBrush(null) } : goThere}
            onZone={pushZone}
            trail={trail}
            pins={pinsByRoom}
            onPinRoom={pinRoom}
            onDropPin={dropPin}
            playerMarker={playerMarker}
          />
        </div>
        {/* A watermark on the map itself, not just a banner above it. The
         * banner is what explains why; this is what keeps a glance from
         * mistaking demo cartography for the character's real location even
         * after the explanation has scrolled out of view - which is the bar
         * issue #36 sets: "cannot be mistaken for live data." */}
        {demoStandIn && (
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            aria-hidden="true"
          >
            <span className="rotate-[-18deg] select-none rounded border border-warn/40 bg-surface/70 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-warn">
              Demo cartography — not your location
            </span>
          </div>
        )}
      </div>
      {/* The width the chart does not need, kept as a real slot rather than
          spent on bare page. Deliberately empty until something earns it: an
          empty bordered box would be chrome, and this app's own standard is
          to draw nothing rather than draw a placeholder. It reserves the
          space in the layout so a priority panel can land here without
          another column negotiation. */}
      {plane && naturalSize && (
        <aside className="min-h-0 min-w-0 flex-1" aria-label="Reserved for a priority panel" />
      )}
      </div>

      {/* The way back.
       *
       * Only present while browsing, because it is the only state it means
       * anything in. Two buttons rather than one: back is a step, and "where I
       * am" is the thing you actually want after wandering four zones out and
       * realising the character has moved. */}
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

      {path?.ok && (
        <p className="text-xs text-good leading-snug">
          {path.steps} rooms to{' '}
          {path.rooms?.[path.rooms.length - 1]?.title ?? path.to}
        </p>
      )}
      {path && !path.ok && (
        <p className="text-xs text-warn leading-snug">{path.reason}</p>
      )}
      </Shell>
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
            setEditingMarker(false)
          }}
        />
      )}
      {pinImport && (
        <PinImportDialog
          preview={pinImport}
          onClose={() => setPinImport(null)}
          onResult={addLog}
        />
      )}
    </>
  )
}

function Shell({
  children,
  title,
  onRefresh,
  onPopOut,
  onExportPins,
  onImportPins,
  search,
  right,
  plane = false,
}: {
  children: React.ReactNode
  title?: string
  onRefresh?: () => void
  onPopOut?: () => void
  /** Write every character's pins to the shared Genie config file. See pinsFile.ts. */
  onExportPins?: () => void
  /** Read that same file back in, merging it into this browser's own pins. */
  onImportPins?: () => void
  /** Search belongs to the map heading and shares that line until its result list opens. */
  search?: React.ReactNode
  right?: React.ReactNode
  plane?: boolean
}) {
  /**
   * Who this map is of.
   *
   * It sits here because the portrait box gave up its name line to make room
   * for the doll, and a name nowhere in the window is a real problem the
   * moment two characters are logged in: every panel looks the same and
   * nothing says which one you are driving.
   *
   * Read from the store rather than passed down, because every branch of this
   * panel goes through Shell and threading it through five call sites to say
   * the same thing five times is how one of them ends up missing it.
   */
  const who = useAppStore((s) => s.character)?.name

  return (
    <section
      className={`flex flex-col gap-1.5 p-2 ${
        // In a plane the section owns the column, so it becomes the flex
        // container the map body stretches inside. Otherwise it sizes to its
        // own content like any other panel.
        plane ? 'flex flex-col h-full min-h-0' : ''
      }`}
    >
      <header className="flex min-w-0 items-start gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-medium text-ink-faint uppercase tracking-wider min-w-0">
          <MapIcon className="w-3.5 h-3.5 shrink-0" />
          {/* Zone first, and it keeps the room. The shrink factors are the
              whole point: both truncate, but the name gives up width ten times
              faster, so "Abandoned Mine and Lairocott Brach" stays readable
              while a long name loses its tail. The map is of a place. */}
          {/* title on both, because the shrink ranking above decides who gets
              cut and nothing was deciding where the cut text went. Measured on
              the real app: "Dan the Bold" rendering in 30px of the 71 it wants
              - about "Dan…" - and the zone 4px short of fitting, with no way
              to read either in full. The ranking is right; losing the text
              outright was not part of it. */}
          <span className="min-w-0 shrink truncate" title={title ?? 'Map'}>
            {title ?? 'Map'}
          </span>
          {who && (
            <>
              <span className="shrink-0" aria-hidden="true">
                ·
              </span>
              {/* Left in its own case. The zone is a heading and shouts; a
                  character's name is a name, and DAN THE BOLD reads like the
                  app is addressing him.
                  `min-w-0` here let flexbox take this span all the way to a
                  literal zero pixels wide in a small card - not "Dan…", not
                  one character, nothing rendered at all - which is worse
                  than the truncation this was built for: a panel with no
                  name in it is exactly the ambiguity this line exists to
                  remove. A `ch`-based floor guarantees a sliver survives
                  even when the header has almost no room left, while still
                  giving up width ten times faster than the zone name. */}
              <span
                className="min-w-[3ch] shrink-[10] truncate normal-case tracking-normal text-ink-muted"
                title={who}
              >
                {who}
              </span>
            </>
          )}
        </h3>
        {search && <div className="min-w-[10rem] flex-1">{search}</div>}
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          {right}
          {onPopOut && (
            <button
              type="button"
              className="p-1 rounded text-ink-faint hover:text-ink"
              title="Open the map in its own window" aria-label="Open the map in its own window"
              onClick={onPopOut}
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
          {onRefresh && (
            <button
              type="button"
              className="p-1 rounded text-ink-faint hover:text-ink"
              title="Ask Lich for this zone again" aria-label="Ask Lich for this zone again"
              onClick={onRefresh}
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
          {/* Pins as a file, not just this browser's own storage - saved into
            * the same Config folder highlights.cfg/aliases.cfg already live
            * in, so it travels with the rest of a shared config. See
            * pinsFile.ts's header for the whole story. */}
          {onExportPins && (
            <button
              type="button"
              className="p-1 rounded text-ink-faint hover:text-ink"
              title="Save every character's pins to dr-companion-pins.yaml, in your Genie Config folder"
              aria-label="Export pins to file"
              onClick={onExportPins}
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          )}
          {onImportPins && (
            <button
              type="button"
              className="p-1 rounded text-ink-faint hover:text-ink"
              title="Load pins from dr-companion-pins.yaml in your Genie Config folder - a guildmate's shared file, or your own from another machine"
              aria-label="Import pins from file"
              onClick={onImportPins}
            >
              <Upload className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </header>
      {children}
    </section>
  )
}

/**
 * The fix for "Lich has no map for where you are", right where that message
 * is read. `install_mapdb` runs download-prime-map (or repository) through
 * Lich's own Script.start and answers as soon as the script has started, not
 * when the download finishes — so this has to track its own started/failed
 * state rather than borrowing the map's present/absent state, and it must
 * never claim the map is fixed just because the request was accepted.
 */
function MapdbInstallControl() {
  const bridgeIntents = useAppStore((s) => s.bridgeIntents)
  const install = useAppStore((s) => s.mapdbInstall)
  const installMapdb = useAppStore((s) => s.installMapdb)

  // A bridge too old to say what it implements is treated as able to, same
  // as every other intent — see isIntentImplemented. Only an explicit "no"
  // hides the control.
  if (!isIntentImplemented(bridgeIntents, 'install_mapdb')) return null

  if (install?.status === 'started') {
    return (
      <p className="mt-1.5 text-xs text-ink-faint leading-relaxed">
        {install.detail ??
          'Started. The map will fill in once Lich finishes the download — this can take a minute.'}
      </p>
    )
  }

  return (
    <div className="mt-1.5 flex items-start gap-2">
      <button
        type="button"
        disabled={install?.status === 'starting'}
        onClick={installMapdb}
        className="shrink-0 text-xs rounded border border-border px-2 py-1 text-ink-muted hover:text-ink disabled:opacity-50"
      >
        {install?.status === 'starting'
          ? 'Asking Lich…'
          : install?.status === 'failed'
            ? 'Try again'
            : 'Fetch the map database'}
      </button>
      {install?.status === 'failed' && (
        <p className="text-xs text-warn leading-relaxed">{install.detail}</p>
      )}
    </div>
  )
}
