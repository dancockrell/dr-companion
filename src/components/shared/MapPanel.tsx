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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadZone, DEFAULT_ZONE } from '../../lib/mapData'
import type { MapZone } from '../../bridge/types'
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
} from 'lucide-react'
import { describeTrail } from '../../lib/trail'
import { useAppStore, isIntentImplemented } from '../../store/useAppStore'
import { bridge } from '../../bridge'
import { isTauri, invokeTauri } from '../../lib/tauri'
import { MapCanvas, MapLegend } from './MapCanvas'
import { useMapDock, setMapDock, ZOOM_MIN, ZOOM_MAX } from '../../lib/mapDock'
import { useMapViewport } from '../../lib/useMapViewport'
import { PlaceSearch } from './PlaceSearch'
import type { PlaceHit } from '../../lib/placeSearch'
import { MapPinBar } from './MapPinBar'
import { QuickTravel } from './QuickTravel'
import { PinEditor } from './PinEditor'
import { RoomNudge } from './RoomNudge'
import { loadPins, addPin, updatePin, removePin, pinFor, type MapPin } from '../../lib/mapPins'
import { isDismissed, dismissNudge, NUDGE_VISIT_THRESHOLD } from '../../lib/pinNudge'
import { uniqueTaskName, pinTaskSource } from '../../lib/pinTaskGenerator'
import { listScripts, writeScript } from '../../lib/scriptFiles'

/**
 * @param plane Fill the height given rather than a fixed box. Set when the map
 *   has a column of its own, where the point is that it is big enough to watch
 *   and a fixed height would waste the space it was given.
 */
export function MapPanel({ plane = false }: { plane?: boolean }) {
  const liveZone = useAppStore((s) => s.mapZone)
  const [builtZone, setBuiltZone] = useState<MapZone | null>(null)

  /**
   * Which zone is on screen, and how you got here.
   *
   * A stack rather than a single id, because following gates without a way
   * back is worse than not following them: three clicks into the trade road
   * and the only route home is knowing which of 85 zones you started in.
   * Empty means "wherever the character is", which is the normal state.
   */
  const [zoneStack, setZoneStack] = useState<string[]>([])
  const browsing = zoneStack[zoneStack.length - 1] ?? null

  // Lich wins when it is connected: it knows where the character actually is
  // and carries tags the shipped cartography does not. But a map that is blank
  // until you connect is a map nobody can judge, and the demo is where most
  // people meet this first, so the built zones stand in.
  useEffect(() => {
    // Browsing wins over the live zone. Following a gate is a deliberate act
    // and the map jumping back the moment Lich sends the next room would make
    // the gates unusable.
    if (liveZone?.ok && !browsing) return
    let cancelled = false
    loadZone(browsing ?? DEFAULT_ZONE).then((z) => {
      if (!cancelled) setBuiltZone(z)
    })
    return () => {
      cancelled = true
    }
  }, [liveZone?.ok, browsing])

  const zone = browsing ? builtZone : liveZone?.ok ? liveZone : builtZone
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
  const poppedOut = !dock.docked
  const setPoppedOut = (v: boolean) => setMapDock({ docked: !v })

  // Asked, not remembered. The map window is a separate webview with its own
  // state, so this panel cannot know from its own memory whether a window it
  // opened is still there or the user closed it by hand.
  useEffect(() => {
    if (!isTauri()) return
    void invokeTauri('map_window_open')
      .then((open) => setPoppedOut(open === true))
      .catch(() => setPoppedOut(false))
  }, [])

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

  async function popOut() {
    try {
      await invokeTauri('open_map_window')
      setPoppedOut(true)
    } catch {
      // Leave the inline map showing rather than hiding it behind a window
      // that never opened.
      setPoppedOut(false)
    }
  }

  async function popBack() {
    try {
      await invokeTauri('close_map_window')
    } finally {
      // In the `finally`, so a close that errored still returns the inline map
      // rather than leaving the panel pointing at a window that is not there.
      setPoppedOut(false)
    }
  }

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
   * Only active once actually zoomed in (`dock.zoom > 1`): at zoom 1 the
   * whole zone already fits the box by design ("a glance that is always
   * complete, never clipped" - MapCanvas's own `fit` mode), and there is
   * nothing to pan.
   */
  const viewport = useMapViewport({
    zoom: dock.zoom,
    onZoomChange: (z) => setMapDock({ zoom: z }),
    min: ZOOM_MIN,
    max: ZOOM_MAX,
  })
  const { containerRef, x: panX, y: panY, dragging, handlers, zoomBy, centerOn, resetPan } = viewport

  const here = useAppStore((s) => s.mapHere)
  const character = useAppStore((s) => s.character)
  const addLog = useAppStore((s) => s.addLog)

  /**
   * Saved places, and the hotbar under the map that walks to them.
   *
   * Loaded per character (Home for one is not Home for another - see
   * mapPins.ts) straight from localStorage during render rather than kept
   * only in this component's state, so a pin added in the popped-out window
   * shows up here too the next time either one re-renders - both windows
   * read the same storage. `pinVersion` exists only to force a re-read after
   * a write this component made itself, since editing a pin doesn't
   * otherwise touch anything React tracks as having changed.
   */
  const [pinVersion, setPinVersion] = useState(0)
  const { pins, pinsByRoom } = useMemo(() => {
    const list = character ? loadPins(character.name, character.instance) : []
    return { pins: list, pinsByRoom: new Map(list.map((p) => [p.roomId, p])) }
  }, [character, pinVersion])

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

  function pinRoom(id: number) {
    const title = zone?.rooms?.find((r) => r.id === id)?.title ?? `Room ${id}`
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

  function savePin(label: string, color: MapPin['color'], icon: MapPin['icon']) {
    if (!character || !editingRoom) return
    if (editingRoom.existing) {
      updatePin(character.name, character.instance, editingRoom.existing.id, { label, color, icon })
    } else {
      addPin(character.name, character.instance, {
        roomId: editingRoom.id,
        zone: zone?.zone ?? '',
        label,
        color,
        icon,
      })
    }
    setPinVersion((v) => v + 1)
    setEditingRoom(null)
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
    setPinVersion((v) => v + 1)
    setEditingRoom(null)
  }
  // Recenter when the character moves, the zone/level changes, or zoom
  // itself changes - the last one only matters here because the toolbar
  // zoom buttons are the only way in (no wheel while at fit), so unlike the
  // popped-out window there is no cursor position for the button to anchor
  // toward instead.
  const centeredFor = useRef<string | null>(null)
  const onHereAt = useCallback(
    (x: number, y: number) => {
      const key = `${here?.id}:${zoneStack.join('>')}:${level}:${dock.zoom}`
      if (centeredFor.current === key) return
      centeredFor.current = key
      centerOn(x, y)
    },
    [here?.id, zoneStack, level, dock.zoom, centerOn]
  )

  /**
   * Going where the search says the place is.
   *
   * Two things happen and neither of them is walking there. The zone changes
   * so you can see the answer, and a route is asked for so you can decide
   * about it. That is the same contract clicking a room already has, and a
   * search box that moved the character on Enter would be a very different
   * tool from a map.
   *
   * A hit in the character's own zone empties the stack rather than pushing
   * onto it. Pushing would leave a "← Back" that goes back to where you are
   * already standing, which is a button that appears to do nothing.
   */
  function goToPlace(hit: PlaceHit) {
    // The route first. It does not care which zone is drawn and it is the part
    // with a round trip to Lich in it, so it goes out before anything here
    // waits on a file read.
    bridge.requestIntent('map_path', { to: hit.room })

    if (hit.zone === zone?.zone) return

    if (hit.zone === liveZone?.zone) {
      setZoneStack([])
      return
    }

    /*
     * Loaded before it is pushed, which is the opposite of how the gateways do
     * it and is the fix for something you can watch happen.
     *
     * Pushing first leaves `browsing` naming a zone `builtZone` has not caught
     * up with, and for the length of the fetch `zone` is null: the panel falls
     * through to its "nothing asked for yet" state and the title, the map and
     * the search box all blink out together. Picking "Bathhouse, Throne City"
     * from Crossing showed the header reading MAP with an empty panel under
     * it. Loading first means the push and the map arrive in the same render.
     */
    void loadZone(hit.zone).then((z) => {
      // No file for that zone means the index is ahead of the cartography.
      // Staying put is the honest answer; the route was already asked for.
      if (!z) return
      setBuiltZone(z)
      setZoneStack((st) => [...st, hit.zone])
    })
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
            onClick={popBack}
          >
            <PanelRightClose className="w-3 h-3" />
            Bring it back
          </button>
        }
      >
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
        <p className="text-xs text-ink-faint leading-relaxed">
          Nothing asked for yet. Press refresh, or move a room and it will
          arrive on its own.
        </p>
      </Shell>
    )
  }

  if (!zone.ok) {
    return (
      <Shell plane={plane} onRefresh={refresh} onPopOut={isTauri() ? popOut : undefined}>
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
      right={
        <div className="flex items-center gap-2">
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
                  onClick={() => setLevel(lv)}
                >
                  {lv}
                </button>
              ))}
            </div>
          )}
          {/* Zoom belongs to the plane and height belongs to the stack.
              In a plane the height already comes from the column and the
              divider, so a grow/shrink toggle there would be a second control
              fighting the first; in the stack the box is too small for zoom to
              show you anything the fit does not. */}
          {plane && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="rounded p-1 text-ink-faint hover:text-ink disabled:opacity-40"
                title="Zoom out"
                disabled={dock.zoom <= ZOOM_MIN}
                onClick={() => zoomBy(1 / 1.3)}
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                className="min-w-8 rounded px-1 text-xs tabular-nums text-ink-faint hover:text-ink"
                title="Back to the whole zone"
                onClick={() => {
                  setMapDock({ zoom: 1 })
                  resetPan()
                }}
              >
                {dock.zoom === 1 ? 'fit' : `${dock.zoom.toFixed(1)}x`}
              </button>
              <button
                type="button"
                className="rounded p-1 text-ink-faint hover:text-ink disabled:opacity-40"
                title="Zoom in"
                disabled={dock.zoom >= ZOOM_MAX}
                onClick={() => zoomBy(1.3)}
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {!plane && (
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
          )}
        </div>
      }
    >
      {/* Above the map rather than beside the title, because the answer it
          gives is a place on the map and the two want to be read together.
          It costs one row and gives back the thing the map could not do. */}
      <PlaceSearch here={zone.zone} onPick={goToPlace} />

      {/* Home, hangouts, whatever is worth one click - independent of
          whichever zone is currently drawn, since these walk by room id. */}
      <MapPinBar
        pins={pins}
        onGo={(pin) => goThere(pin.roomId)}
        onEdit={(pin) => setEditingRoom({ id: pin.roomId, title: pin.label, existing: pin })}
        onAddHere={hereId != null ? () => pinRoom(hereId) : undefined}
      />
      <QuickTravel onWalk={goThere} />

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
      <div
        ref={dock.zoom > 1 ? containerRef : undefined}
        className={`relative rounded ${
          dock.zoom > 1 ? `overflow-hidden ${dragging ? 'cursor-grabbing' : 'cursor-grab'}` : 'overflow-hidden'
        } ${plane ? 'flex-1 min-h-0' : ''}`}
        style={{
          // The page, behind and around the chart. Letterboxing in the app's
          // dark surface would read as the map having been cut off rather than
          // as a sheet that does not fill the box.
          background: 'var(--map-ground)',
          ...(plane ? {} : { height: tall ? 320 : 168 }),
          ...(dock.zoom > 1 ? { touchAction: 'none' } : {}),
        }}
        {...(dock.zoom > 1
          ? {
              onWheel: handlers.onWheel,
              onPointerDown: handlers.onPointerDown,
              onPointerMove: handlers.onPointerMove,
              onPointerUp: handlers.onPointerUp,
              onClickCapture: handlers.onClickCapture,
            }
          : {})}
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
        {dock.zoom > 1 ? (
          // Zoomed: natural-size drawing under a translate+scale transform,
          // panned and zoomed the same way the popped-out window is (see
          // useMapViewport) - click-and-drag, and the wheel anchored on the
          // cursor rather than always re-centring on the box.
          <div
            className={`${standingIn ? 'grayscale-[60%] opacity-70' : ''} ${
              dragging ? '' : 'transition-transform duration-150 ease-out'
            }`}
            style={{
              position: 'absolute',
              transform: `translate(${panX}px, ${panY}px) scale(${dock.zoom})`,
              transformOrigin: '0 0',
              ...(demoStandIn ? { filter: 'grayscale(0.85) brightness(0.55)' } : {}),
            }}
          >
            <MapCanvas
              zone={zone}
              level={z}
              onRoute={onRoute}
              onPick={goThere}
              onZone={(id) => setZoneStack((st) => [...st, id])}
              trail={trail}
              onHereAt={onHereAt}
              pins={pinsByRoom}
              onPinRoom={pinRoom}
            />
          </div>
        ) : (
          // Fit: the whole zone visible, always - "a glance that is always
          // complete, never clipped." No pan needed because nothing is cut
          // off to pan toward.
          <div
            className={standingIn ? 'grayscale-[60%] opacity-70' : undefined}
            style={{
              width: '100%',
              height: '100%',
              ...(demoStandIn ? { filter: 'grayscale(0.85) brightness(0.55)' } : {}),
            }}
          >
            <MapCanvas
              zone={zone}
              level={z}
              onRoute={onRoute}
              fit
              onPick={goThere}
              onZone={(id) => setZoneStack((st) => [...st, id])}
              trail={trail}
              pins={pinsByRoom}
              onPinRoom={pinRoom}
            />
          </div>
        )}

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
            onClick={() => setZoneStack((st) => st.slice(0, -1))}
            className="rounded border border-border px-2 py-0.5 text-ink-muted hover:text-ink"
          >
            ← Back
          </button>
          <button
            type="button"
            onClick={() => setZoneStack([])}
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

      <div className="flex items-center justify-between gap-2">
        <MapLegend
          kinds={[...new Set((zone?.rooms ?? []).flatMap((r) => r.tags ?? []))]}
        />
        {/* What the trail says, in words.
         *
         * The stroke on the chart answers "where" and this answers "what is
         * happening", which is the question you actually have when you look
         * back at a window a script has been driving for an hour. It sits
         * beside the room count because that is the line the eye already goes
         * to for the state of the map rather than the state of the game. */}
        <span className="text-xs text-ink-faint shrink-0 truncate" title={describeTrail(trail)}>
          {trail.recent.length > 0
            ? describeTrail(trail)
            : `${zone.rooms?.length ?? 0} rooms${zone.truncated ? ` of ${zone.total}, capped` : ''}`}
        </span>
      </div>

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
    </>
  )
}

function Shell({
  children,
  title,
  onRefresh,
  onPopOut,
  right,
  plane = false,
}: {
  children: React.ReactNode
  title?: string
  onRefresh?: () => void
  onPopOut?: () => void
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
      <header className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-medium text-ink-faint uppercase tracking-wider min-w-0">
          <MapIcon className="w-3.5 h-3.5 shrink-0" />
          {/* Zone first, and it keeps the room. The shrink factors are the
              whole point: both truncate, but the name gives up width ten times
              faster, so "Abandoned Mine and Lairocott Brach" stays readable
              while a long name loses its tail. The map is of a place. */}
          <span className="min-w-0 shrink truncate">{title ?? 'Map'}</span>
          {who && (
            <>
              <span className="shrink-0" aria-hidden="true">
                ·
              </span>
              {/* Left in its own case. The zone is a heading and shouts; a
                  character's name is a name, and DAN THE BOLD reads like the
                  app is addressing him. */}
              <span className="min-w-0 shrink-[10] truncate normal-case tracking-normal text-ink-muted">
                {who}
              </span>
            </>
          )}
        </h3>
        <div className="flex items-center gap-2 shrink-0">
          {right}
          {onPopOut && (
            <button
              type="button"
              className="p-1 rounded text-ink-faint hover:text-ink"
              title="Open the map in its own window"
              onClick={onPopOut}
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
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
