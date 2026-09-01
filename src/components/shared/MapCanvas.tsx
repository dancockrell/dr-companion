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
import { useEffect, useMemo, useRef, useState } from 'react'
import type { MapZone, MapZoneRoom } from '../../bridge/types'
import { inkFor } from '../../lib/mapInk'
import { recency, segments, type Trail } from '../../lib/trail'
import { roomKind, type RoomKind } from '../../lib/mapData'
import { PIN_COLOR_HEX, PIN_DRAG_TYPE, type MapPin, type PinIcon, type PinColor } from '../../lib/mapPins'
import type { PlayerMarker } from '../../lib/playerMarker'
import { PIN_ICON_COMPONENT } from '../../lib/pinIcons'
import { RoomHoverCard } from './RoomHoverCard'
import { useAppStore } from '../../store/useAppStore'
import { landmarksFor } from '../../lib/mapLandmarks'
import { deriveMapStamps } from '../../lib/mapStamps'
import { MapStampLayer } from './MapStampLayer'

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

const FILL: Record<RoomKind, string> = {
  // Not the app's accent. Gold on vellum is a wash, and this is the one square
  // on the chart that must never be missed.
  here: 'var(--map-here)',
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
  onZone,
  /** Pixels per map unit. The map's own coordinates are ~20 apart per room. */
  scale = 1,
  /** Room titles alongside the boxes. Only readable once there is room for them. */
  labels = false,
  /** Scale the whole zone to fill the container instead of drawing at size. */
  fit = false,
  /** Where you have been. Drawn as a stroke over the chart. */
  trail,
  /** The "here" room's position, in this draw's own pixel space, once known -
   *  so a viewport can center on it without re-deriving the coordinate math
   *  this component already does. Fires on every render that has a "here"
   *  room, not just the first; a room change is exactly when re-centering
   *  is wanted. */
  onHereAt,
  /** Saved places, keyed by room id, for the small colour-coded marker on a pinned room. */
  pins,
  /** Right-click (or long-press, once this has a touch input) a room to pin it - offered on any room, not just the one you're standing in, since browsing a distant zone to mark its bank is a real use of this. */
  onPinRoom,
  /**
   * A pin type dragged in from somewhere outside the map (QuickTravel's
   * category buttons, for now) and dropped on a room - the instant-placement
   * counterpart to onPinRoom's right-click-then-choose flow. Optional for
   * the same reason onPinRoom is: a caller with nowhere to save a pin (no
   * character yet) simply doesn't wire it up, and the room stops accepting
   * drops rather than accepting one that goes nowhere.
   */
  onDropPin,
  /** The character's own chosen symbol and colour - drawn bigger than any
   *  pin, on the room the map already knows is "here". Optional: a caller
   *  with no character yet just doesn't offer one, and the plain coloured
   *  square kind === 'here' already draws is what shows instead. */
  playerMarker,
}: {
  zone: MapZone
  level: number
  onRoute: Set<number | null>
  onPick: (id: number) => void
  /** Following a room that leads out of the zone. Without it, gateways are inert. */
  onZone?: (zone: string) => void
  scale?: number
  labels?: boolean
  fit?: boolean
  trail?: Trail
  onHereAt?: (x: number, y: number) => void
  pins?: Map<number, MapPin>
  onPinRoom?: (id: number) => void
  onDropPin?: (roomId: number, preset: { label: string; icon: PinIcon; color: PinColor }) => void
  playerMarker?: PlayerMarker
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

  // Rebuilt only when the room set actually changes - not on every trail
  // update, which is the whole reason a window left open to watch a script
  // used to reclassify every room and rebuild this lookup on every tick.
  const index = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms])

  // Same reasoning: `roomKind` runs a couple of regex tests per room, cheap
  // once and wasted work every trail-driven re-render of a 1,000-room zone.
  const kindById = useMemo(
    () => new Map(rooms.map((r) => [r.id, roomKind(r, zone.here, onRoute)])),
    [rooms, zone.here, onRoute]
  )

  // Genie/Elanthipedia-derived place metadata is not a tooltip-only detail.
  // Turn it into a visible landmark layer, below personal pins and the player
  // crest so authored world information enriches rather than competes with
  // the player's own map.
  const landmarks = useMemo(() => {
    const candidates = rooms.flatMap((room) =>
      room.id != null && room.x != null && room.y != null
        ? landmarksFor(room).map((landmark) => ({ room, landmark }))
        : []
    )

    // A guild complex can contribute fifty annotated rooms. Fifty identical
    // guild badges are not fifty useful facts. Keep the strongest named room
    // in each nearby same-kind cluster; different categories never suppress
    // one another, so a bank inside a guild still gets its own mark.
    const radius: Record<(typeof candidates)[number]['landmark']['kind'], number> = {
      bank: 28,
      healer: 32,
      guild: 55,
      shop: 24,
      inn: 28,
      temple: 38,
      travel: 20,
      craft: 34,
      library: 24,
      hunt: 38,
      trainer: 34,
      weapon: 24,
      armor: 24,
      alchemy: 28,
      magic: 28,
      dock: 22,
      portal: 24,
      office: 24,
      justice: 28,
      post: 24,
    }
    const score = ({ landmark }: (typeof candidates)[number]) => {
      const label = landmark.label
      return (/,/.test(label) ? 0 : 8) + (/\b(GL|guild|academy|headquarters|bank|hospital|healer|gate|dock|market|shop|forge|library)\b/i.test(label) ? 6 : 0) - label.length / 100
    }
    const kept: typeof candidates = []
    for (const candidate of [...candidates].sort((a, b) => score(b) - score(a))) {
      const nearSameKind = kept.some((other) => {
        if (other.landmark.kind !== candidate.landmark.kind) return false
        const dx = (other.room.x as number) - (candidate.room.x as number)
        const dy = (other.room.y as number) - (candidate.room.y as number)
        return Math.hypot(dx, dy) < radius[candidate.landmark.kind]
      })
      if (!nearSameKind) kept.push(candidate)
    }
    const byRoom = new Map<number, typeof kept[number]['landmark'][]>()
    for (const { room, landmark } of kept) {
      const id = room.id as number
      byRoom.set(id, [...(byRoom.get(id) ?? []), landmark])
    }
    return byRoom
  },
    [rooms]
  )

  // Landscape context painted like old cartographer's ink, beneath every
  // route and room. Stable per zone and level: returning to Crossing shows
  // the same rivers, woodland, high ground and seal in the same places.
  const stamps = useMemo(
    () => deriveMapStamps({ zone: zone.zone, name: zone.name }, rooms),
    [zone.zone, zone.name, rooms]
  )

  // Who's next to whom, for highlighting a room's connections on hover - a
  // map that lights up where you can actually go from the room the cursor is
  // over is a map that teaches the city, not just displays it. Built once per
  // room set, read on every pointer move rather than walked per hover.
  const neighbors = useMemo(() => {
    const out = new Map<number, Set<number>>()
    const link = (a: number, b: number) => {
      if (!out.has(a)) out.set(a, new Set())
      out.get(a)?.add(b)
    }
    for (const r of rooms) {
      if (r.id == null) continue
      for (const l of r.links ?? (r.to ?? []).map((t) => ({ to: t }))) {
        link(r.id, l.to)
        link(l.to, r.id)
      }
    }
    return out
  }, [rooms])

  const [hoverId, setHoverId] = useState<number | null>(null)
  const hoverNeighbors = hoverId != null ? neighbors.get(hoverId) : undefined

  // Position for RoomHoverCard, in this component's own positioning
  // container - captured on enter rather than tracked on every move, since
  // a room does not move under the cursor and the card only needs to
  // appear near where the hover started.
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const character = useAppStore((s) => s.character)

  // Reports the "here" room's pixel position whenever it is known, so a
  // viewport (useMapViewport) can center on it without re-deriving px/py
  // itself - the same coordinate math kept in exactly one place.
  useEffect(() => {
    if (!onHereAt || !view || zone.here == null) return
    const room = index.get(zone.here)
    if (!room || room.x == null || room.y == null) return
    onHereAt(room.x * scale - view.minX + pad, room.y * scale - view.minY + pad)
  }, [onHereAt, view, zone.here, index, scale, pad])

  if (!view) {
    return (
      <p className="p-3 text-xs text-ink-faint">
        No rooms with coordinates on this level.
      </p>
    )
  }

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
    <div ref={wrapRef} className="relative h-full w-full">
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

      {/* Informative atmosphere, never function. This must stay immediately
          above the paper and below trails, links, rooms, landmarks, pins and
          the player marker; SVG paint order is the contract. */}
      <MapStampLayer
        stamps={stamps}
        xFor={(x) => x * scale - view.minX + pad}
        yFor={(y) => y * scale - view.minY + pad}
        unit={Math.min(scale, Math.max(0.22, Math.min(view.w, view.h) / 160))}
      />

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
        (r.links ?? (r.to ?? []).map((t) => ({ to: t, kind: 'walk' as const }))).map((link, li) => {
          const other = index.get(link.to)
          if (!other || (other.id ?? 0) <= (r.id ?? 0)) return null

          // Lit up when either end is the room under the cursor - a corridor
          // is exactly as much "connected to here" from either side of it.
          const isHovered =
            hoverId != null && (r.id === hoverId || other.id === hoverId)

          const style =
            link.kind === 'enter'
              ? { stroke: 'var(--map-route)', strokeWidth: 0.7 * scale, strokeDasharray: '1.5 1.5', opacity: 0.8 }
              : link.kind === 'climb' || link.kind === 'vertical'
                ? { stroke: 'var(--color-warn)', strokeWidth: 0.9 * scale, strokeDasharray: '0.8 1.2', opacity: 0.9 }
                : { stroke: 'var(--map-line)', strokeWidth: Math.max(0.6, 0.7 * scale), opacity: 0.9 }

          return (
            <line
              // The index is in the key because the rest of it is not unique. Two
              // exits can share a room pair and a kind and still be different
              // moves: north and northeast both run 48 to 49, and "go
              // mahogany gate" and "go mahogany building" are two doors into
              // one place. There are 991 such pairs, and React was dropping one
              // line from every one of them - 991 corridors missing from the
              // chart, with nothing on screen to say so.
              key={`${r.id}-${link.to}-${link.kind}-${li}`}
              x1={px(r)}
              y1={py(r)}
              x2={px(other)}
              y2={py(other)}
              strokeLinecap="round"
              {...style}
              {...(isHovered
                ? {
                    stroke: 'var(--map-here)',
                    strokeWidth: Math.max(1.4, (style.strokeWidth as number) * 1.8),
                    strokeDasharray: undefined,
                    opacity: 1,
                  }
                : {})}
              className="transition-[stroke,stroke-width,opacity] duration-100"
            />
          )
        })
      )}

      {rooms.map((r) => {
        const kind = kindById.get(r.id) ?? 'plain'
        const been = r.id != null ? fresh?.get(r.id) : undefined
        const times = r.id != null ? trail?.visits[r.id] : undefined
        const isHovered = r.id != null && r.id === hoverId
        const isNeighborOfHover = r.id != null && hoverNeighbors?.has(r.id)
        return (
          <g
            key={r.id}
            className="cursor-pointer"
            onClick={() => {
              // A gateway goes through. Routing to a room you are already
              // looking at is the less useful of the two, and a gate is the
              // one mark on the chart whose whole point is the far side.
              if (r.gateway && onZone) onZone(r.gateway.zone)
              else if (r.id) onPick(r.id)
            }}
            onContextMenu={(e) => {
              if (!onPinRoom || r.id == null) return
              e.preventDefault()
              onPinRoom(r.id)
            }}
            onMouseEnter={(e) => {
              if (r.id == null) return
              setHoverId(r.id)
              const box = wrapRef.current?.getBoundingClientRect()
              if (box) setHoverPos({ x: e.clientX - box.left, y: e.clientY - box.top })
            }}
            onMouseLeave={() => {
              if (r.id == null) return
              setHoverId((h) => (h === r.id ? null : h))
              setHoverPos(null)
            }}
            // Drag-and-drop a pin type onto this room. Reuses the same hover
            // lift a mouseenter gives - the room under the drag should read
            // as the drop target the same way it reads as the click target,
            // rather than needing a second visual language just for drags.
            onDragOver={(e) => {
              if (!onDropPin || r.id == null) return
              e.preventDefault()
            }}
            onDragEnter={() => {
              if (onDropPin && r.id != null) setHoverId(r.id)
            }}
            onDragLeave={() => r.id != null && setHoverId((h) => (h === r.id ? null : h))}
            onDrop={(e) => {
              if (!onDropPin || r.id == null) return
              e.preventDefault()
              setHoverId((h) => (h === r.id ? null : h))
              const raw = e.dataTransfer.getData(PIN_DRAG_TYPE)
              if (!raw) return
              try {
                const preset = JSON.parse(raw)
                if (preset?.label && preset?.icon && preset?.color) onDropPin(r.id, preset)
              } catch {
                // Not our drag - some other payload landed here. Ignore it
                // rather than creating a pin from garbage.
              }
            }}
          >
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
            {/* A gate is drawn as a doorway rather than a room, because that
                is what it is: the edge of the sheet, with somewhere else on
                the other side. 310 rooms carry one and every single zone was
                an island until now. */}
            {r.gateway && (
              <rect
                x={px(r) - box * 0.85}
                y={py(r) - box * 0.85}
                width={box * 1.7}
                height={box * 1.7}
                rx={Math.max(2, 3 * scale)}
                fill="none"
                stroke="var(--map-ink)"
                strokeWidth={Math.max(0.7, 0.8 * scale)}
                strokeDasharray={`${1.6 * scale} ${1.2 * scale}`}
                opacity={0.65}
              />
            )}
            <title>
              {`${r.title ?? 'Unknown'}\nLich room ${r.id}` +
                (r.uid ? `\ngame uid ${r.uid}` : '') +
                (r.tags?.length ? `\n${r.tags.join(', ')}` : '') +
                (times ? `\nvisited ${times === 1 ? 'once' : `${times} times`} this session` : '') +
                (r.gateway ? `\n→ ${r.gateway.name}  (click to follow)` : '') +
                (r.leaves?.length ? `\nleaves the zone: ${r.leaves.join(', ')}` : '') +
                (r.id != null && pins?.has(r.id)
                  ? `\n📍 ${pins.get(r.id)?.label}` +
                    // The story, not just the name - "pins tell stories."
                    // A label says what to call the place; this says why
                    // it's worth calling anything at all.
                    (pins.get(r.id)?.note ? `\n${pins.get(r.id)?.note}` : '')
                  : onPinRoom
                    ? '\n(right-click to pin)'
                    : '')}
            </title>
            {/* Hovering a room lifts it: a touch bigger, its own outline, and
                its immediate neighbours dimmed slightly rather than lit -
                the room under the cursor should read as the one thing being
                asked about, with its connections (drawn above) doing the
                "where can I go from here" work instead of every neighbour
                fighting for the same attention. */}
            <rect
              data-here={kind === 'here' ? 'true' : undefined}
              x={px(r) - (isHovered ? box * 0.58 : box / 2)}
              y={py(r) - (isHovered ? box * 0.58 : box / 2)}
              width={isHovered ? box * 1.16 : box}
              height={isHovered ? box * 1.16 : box}
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
                isHovered
                  ? 'var(--map-here)'
                  : kind === 'here'
                    ? 'var(--map-here)'
                    : kind === 'hazard'
                      ? 'var(--color-danger)'
                      : kind === 'service'
                        ? 'var(--map-ink)'
                        : 'var(--map-ink)'
              }
              strokeWidth={isHovered ? 2 * scale : kind === 'here' ? 2.5 * scale : 1 * scale}
              opacity={isNeighborOfHover ? 0.55 : 1}
              className="transition-[opacity] duration-100"
            />
            {labels && r.title && (
              <text
                x={px(r) + box}
                y={py(r) + box / 3}
                fontSize={9 * scale}
                fill="var(--map-ink)"
                className="pointer-events-none select-none"
              >
                {r.title}
              </text>
            )}
          </g>
        )
      })}

      {/* Automatic world landmarks from the cartographers' labels and live
          Lich tags. Smaller and quieter than personal pins, but actual icons
          rather than colored room dust. They remain inside the room's parent
          click target, so clicking one walks there and right-clicking creates
          a personal pin. */}
      {rooms
        .filter((r) => r.id != null && landmarks.has(r.id))
        .flatMap((r) => landmarks.get(r.id!)!.map((landmark, landmarkIndex, roomLandmarks) => {
          const cx = px(r)
          const cy = py(r)
          const radius = Math.max(box * 0.82, 2.1 * scale)
          const angle = roomLandmarks.length > 1 ? (Math.PI * 2 * landmarkIndex) / roomLandmarks.length - Math.PI / 2 : 0
          const fan = roomLandmarks.length > 1 ? radius * 1.15 : 0
          const iconX = cx + Math.cos(angle) * fan
          const iconY = cy + Math.sin(angle) * fan
          const Icon = PIN_ICON_COMPONENT[landmark.icon]
          return (
            <g key={`landmark-${r.id}-${landmark.kind}`} className="pointer-events-none" aria-label={`${landmark.label}: ${landmark.kind}`}>
              <title>{`${landmark.label}\n${landmark.kind} · click to walk · right-click to pin`}</title>
              <circle
                cx={iconX}
                cy={iconY}
                r={radius}
                fill={PIN_COLOR_HEX[landmark.color]}
                stroke="var(--map-ground)"
                strokeWidth={Math.max(0.45, 0.45 * scale)}
                opacity={0.92}
              />
              <svg
                x={iconX - radius * 0.72}
                y={iconY - radius * 0.72}
                width={radius * 1.44}
                height={radius * 1.44}
                viewBox="0 0 24 24"
              >
                <Icon size={24} color="var(--map-ground)" strokeWidth={3} />
              </svg>
            </g>
          )
        }))}

      {/* A saved place, marked on the chart itself rather than only in the
          hotbar below it - so browsing toward one, or noticing you are near
          Home, doesn't require reading a row of buttons that may not even
          be in view in a small docked panel.

          A second, later pass over the rooms - not nested inside each
          room's own <g> above - because SVG paints in document order and a
          badge drawn as a room's own last child still loses to *any* later
          room in the list that happens to overlap it. Dan: "pins go on top
          of the background." Measured on Crossing: a pin one room short of
          the drawing order's end was partly covered by its undecorated
          neighbour. Painting every pin only after every room means a pin is
          never under anything but another pin.

          Every pin used to draw as the same plain dot regardless of which
          icon PinEditor offered - the icon only ever reached MapPinBar's
          chip list, never the map itself, which is the one place a player
          is actually looking while deciding where to walk. Drawn here as
          the real icon (falling back to the plain dot PinIcon leaves
          undefined for a pin saved before icons existed, per mapPins.ts's
          own documented contract), in the map's own background colour so it
          reads against any pin colour without needing a second palette.
          The corpse marker (MapPin.system) gets a visibly larger badge and
          a heavier ring - it is the one pin the app drops for you rather
          than you choosing it, and it is telling you where your body is,
          which outranks every other fact a pin can carry. */}
      {pins &&
        rooms
          .filter((r) => r.id != null && pins.has(r.id))
          .map((r) => {
            const pin = pins.get(r.id!)!
            const cx = px(r) + box * 0.62
            const cy = py(r) - box * 0.62
            const weight = pin.system ? 1.4 : 1
            // Sized off the room's own box, not a fixed constant - a pin is
            // a fact worth noticing, and a badge smaller than the room it
            // sits on (the old `1.8 * scale`, well under half of `box`)
            // cannot carry an icon shape at all. Measured live: on
            // Crossing's 903x1056 viewBox scaled into a 530px docked
            // column, the old radius rendered at roughly one physical pixel
            // - present in the DOM, invisible on screen. 1.15x the room box
            // makes the badge the most prominent single mark on the room
            // rather than the least.
            const radius = Math.max(box * 1.15, 2.4 * scale) * weight
            const Icon = pin.icon ? PIN_ICON_COMPONENT[pin.icon] : null
            return (
              <g key={`pin-${r.id}`} className="pointer-events-none">
                <circle
                  cx={cx}
                  cy={cy}
                  r={radius}
                  fill={PIN_COLOR_HEX[pin.color]}
                  stroke="var(--map-ground)"
                  strokeWidth={Math.max(0.5, 0.5 * scale) * (pin.system ? 1.6 : 1)}
                />
                {Icon && (
                  <svg
                    x={cx - radius * 0.8}
                    y={cy - radius * 0.8}
                    width={radius * 1.6}
                    height={radius * 1.6}
                    viewBox="0 0 24 24"
                  >
                    <Icon size={24} color="var(--map-ground)" strokeWidth={2.75} />
                  </svg>
                )}
              </g>
            )
          })}

      {/* The character's own mark, bigger than any pin and drawn last so
          nothing else on the chart can sit on top of it - Dan: "show where
          the character is with a big player icon coat of arms." A third
          top-level pass for the same reason pins are their own pass now
          (see that block's comment): document order is paint order in SVG,
          and "here" has to outrank a pin on the same room, not just every
          plain room. */}
      {playerMarker &&
        rooms
          .filter((r) => kindById.get(r.id) === 'here')
          .map((r) => {
            const cx = px(r)
            const cy = py(r)
            const radius = Math.max(box * 1.6, 3.2 * scale)
            const Icon = PIN_ICON_COMPONENT[playerMarker.icon]
            return (
              <g key={`you-${r.id}`} className="pointer-events-none">
                <circle
                  cx={cx}
                  cy={cy}
                  r={radius}
                  fill={playerMarker.color}
                  stroke="var(--map-ground)"
                  strokeWidth={Math.max(0.7, 0.7 * scale)}
                />
                <svg x={cx - radius * 0.75} y={cy - radius * 0.75} width={radius * 1.5} height={radius * 1.5} viewBox="0 0 24 24">
                  <Icon size={24} color="var(--map-ground)" strokeWidth={2.75} />
                </svg>
              </g>
            )
          })}
    </svg>
    {hoverId != null && hoverPos && index.get(hoverId) && (
      <RoomHoverCard
        key={hoverId}
        room={index.get(hoverId)!}
        pin={pins?.get(hoverId)}
        x={hoverPos.x}
        y={hoverPos.y}
        character={character?.name ? { name: character.name, instance: character.instance } : null}
      />
    )}
    </div>
  )
}

/**
 * The legend names places the way the game does, and now actually fires.
 *
 * The intent above this line was right and the wiring never worked. It said
 * "service" once, which is not a word DragonRealms uses, and was changed to
 * name real places - bank, healer, guild, temple, gate - by filtering those
 * words against each room's `tags`.
 *
 * Tags are place *names*, not categories. Measured against the real Crossing:
 * 1060 rooms, 352 distinct tags, and **zero** matched any of those eight
 * words. So the place half of this legend could never appear, the bar showed
 * the same three fixed entries forever, and the blue dots all over the map -
 * every bank, healer and shop in town - went unexplained. Dan's reading, "I
 * can't think of any reason to keep this bottom bar", was accurate about the
 * bar as built.
 *
 * It is keyed on `roomKind()` now, which is the function that actually
 * decides a room's colour. One source: this legend cannot describe a colour
 * the map does not draw, and cannot miss one it does.
 *
 * The service entry is still named in game words rather than as "service",
 * because the original objection stands - a twenty-year player reading
 * "service" learns that a programmer wrote the label without looking at the
 * game.
 *
 * Only what is on screen is listed. A legend explaining colours that are not
 * present is furniture.
 */
export function MapLegend({ kinds }: { kinds?: RoomKind[] }) {
  const present = new Set(kinds ?? [])

  const items: Array<[string, string]> = (
    [
      // `here` always: it is the one square that must never be missed, and it
      // is on screen by definition.
      ['here', 'you'],
      ['route', 'route'],
      ['hazard', 'hazard'],
      ['service', 'bank, healer, guild, shop'],
    ] as Array<[RoomKind, string]>
  ).filter(([k]) => k === 'here' || present.has(k))

  // Swatches only, no words beside them - the row this used to be (colour
  // plus its name, repeated per kind) cost real width for something a
  // tooltip says exactly as well. Each swatch still carries its own title,
  // so the information survives; it just is not typeset in the layout by
  // default. "Less talk, more tooltips."
  return (
    <div className="flex flex-wrap items-center gap-1.5" title="Map colours: dark you, red hazard, blue bank/healer/guild/shop">
      {items.map(([kind, label]) => (
        <span
          key={kind}
          title={label}
          className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm"
          style={{ background: 'var(--map-ground)' }}
        >
          <span
            className="inline-block h-2 w-2 rounded-[1px]"
            style={{ background: FILL[kind as RoomKind] }}
          />
        </span>
      ))}
    </div>
  )
}
