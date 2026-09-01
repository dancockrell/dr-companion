/**
 * Cursor-anchored zoom and click-and-drag panning for the map.
 *
 * Before this, both places the map can be zoomed (the docked panel and the
 * popped-out window) only scrolled: `overflow-auto` and native scrollbars,
 * with stepped zoom buttons that always zoomed on the box's own center. That
 * is a spreadsheet's idea of zoom, not a map's - every map worth the name
 * zooms toward wherever the cursor is pointing, and lets you grab the sheet
 * and drag it rather than hunting for a scrollbar thumb. This is that,
 * shared so the docked panel and the popped-out window - which this app's own
 * design already insists must never visually drift apart, see MapCanvas's
 * header comment - don't grow two different feels along with it.
 *
 * Zoom is a controlled value (the caller owns it, usually backed by
 * `MapDock`'s persisted `zoom`/`windowZoom`, since a player's preferred zoom
 * level is worth remembering). Pan is not persisted - nobody expects the map
 * to reopen scrolled to exactly where they left it, and "centered on where
 * you are standing" is a better default every time than "wherever it was."
 *
 * # Why a real drag gesture and not just relying on native scroll
 *
 * Native scroll needs a scrollbar to grab or a trackpad gesture; a mouse
 * user has to find the thin strip at the edge of the box. Click-and-drag
 * works everywhere a pointer works, which is the whole reason every mapping
 * product ships it. It has to coexist with clicking a room to ask for a
 * route, and the two are told apart by distance moved, not by which element
 * the pointer started on: a real drag that happens to start over a room must
 * not also fire that room's click.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

/** Pointer movement below this, in CSS pixels, still counts as a click. */
const DRAG_THRESHOLD_PX = 4

/** Wheel notch to zoom-factor. One notch is a comfortable, visible step. */
const WHEEL_ZOOM_FACTOR = 1.12

export function clampMapPan(
  pan: { x: number; y: number },
  viewport: { width: number; height: number },
  content: { width: number; height: number },
  zoom: number
): { x: number; y: number } {
  const axis = (value: number, viewSize: number, contentSize: number) => {
    if (viewSize <= 0 || contentSize <= 0) return value
    const scaled = contentSize * zoom
    if (scaled <= viewSize) return (viewSize - scaled) / 2
    return Math.min(0, Math.max(viewSize - scaled, value))
  }
  return {
    x: axis(pan.x, viewport.width, content.width),
    y: axis(pan.y, viewport.height, content.height),
  }
}

export interface MapViewportOptions {
  zoom: number
  onZoomChange: (zoom: number) => void
  min: number
  max: number
}

export interface MapViewport {
  /** Attach to the element the pan/zoom gesture happens over. */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** Attach to the single layer that receives translate/scale. Live drags
   * update this element directly so a 1,000-room SVG is not reconciled for
   * every pointer event. */
  contentRef: React.RefObject<HTMLDivElement | null>
  /** Pan offset, in CSS pixels. Apply as `translate(x, y) scale(zoom)`. */
  x: number
  y: number
  zoom: number
  /** True while an actual drag (past the threshold) is in progress. */
  dragging: boolean
  /** Spread onto the container. */
  handlers: {
    onWheel: (e: React.WheelEvent) => void
    onPointerDown: (e: React.PointerEvent) => void
    onPointerMove: (e: React.PointerEvent) => void
    onPointerUp: (e: React.PointerEvent) => void
    onPointerCancel: (e: React.PointerEvent) => void
    onClickCapture: (e: React.MouseEvent) => void
  }
  zoomBy: (factor: number) => void
  /** Recenter the content point (px, py) — in the same unscaled pixel space
   *  the content is drawn in — in the middle of the container. */
  centerOn: (px: number, py: number) => void
  /** Pan back to the origin without changing zoom. */
  resetPan: () => void
}

export function useMapViewport({ zoom, onZoomChange, min, max }: MapViewportOptions): MapViewport {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)

  // Refs, not state: read inside event handlers that fire many times a
  // second during a drag, where a state closure would be one render stale.
  // Synced in an effect rather than during render - the values are only ever
  // read from event handlers and other effects, never during rendering
  // itself, so there is no correctness reason to write them earlier, and
  // writing during render is the pattern React's own lint rule exists to
  // catch (it can silently disagree with what concurrent rendering commits).
  const panRef = useRef(pan)
  const zoomRef = useRef(zoom)
  const bounded = useCallback((candidate: { x: number; y: number }, atZoom = zoomRef.current) => {
    const container = containerRef.current
    const content = contentRef.current
    if (!container || !content) return candidate
    return clampMapPan(
      candidate,
      { width: container.clientWidth, height: container.clientHeight },
      {
        width: Math.max(content.offsetWidth, content.scrollWidth),
        height: Math.max(content.offsetHeight, content.scrollHeight),
      },
      atZoom
    )
  }, [])

  useEffect(() => {
    zoomRef.current = zoom
    const next = bounded(pan, zoom)
    panRef.current = next
    if (contentRef.current) {
      contentRef.current.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${zoom})`
    }
    if (next.x !== pan.x || next.y !== pan.y) setPan(next)
  }, [bounded, pan, zoom])

  useEffect(() => {
    const container = containerRef.current
    const content = contentRef.current
    if (!container || !content || typeof ResizeObserver === 'undefined') return
    const keepInBounds = () => setPan((current) => bounded(current))
    const observer = new ResizeObserver(keepInBounds)
    observer.observe(container)
    observer.observe(content)
    return () => observer.disconnect()
  }, [bounded])

  const drag = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(
    null
  )
  // Set the instant a drag crosses the threshold, cleared by the next click.
  // Bridges pointerup (where "did this move" is known) and the click event
  // that follows it, since stopPropagation on pointerup does not reach a
  // click - they are unrelated events in the same interaction.
  const suppressNextClick = useRef(false)

  const clampZoom = useCallback((z: number) => Math.min(max, Math.max(min, z)), [min, max])

  const zoomAt = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      const current = zoomRef.current
      const next = clampZoom(current * factor)
      if (next === current) return

      // Written eagerly, not left for the effect above to pick up next
      // render. `zoom` is a controlled prop that only reaches this hook again
      // after onZoomChange -> the caller's setState -> a re-render -> the
      // effect - and a burst of calls that all land before that round trip
      // completes (a fast flick of the wheel, or two zoom-in clicks close
      // together) would otherwise all read the same stale `current`, compute
      // the same `next`, and collapse into a single step. Measured: three
      // rapid clicks on the zoom-in button reached 1.3x instead of 2.2x.
      // Safe to set ahead of the prop actually arriving because `next` is
      // exactly the value that round trip is going to deliver.
      zoomRef.current = next

      const rect = containerRef.current?.getBoundingClientRect()
      if (rect && clientX !== undefined && clientY !== undefined) {
        // The content point under the cursor before the zoom must be the same
        // content point under the cursor after it - otherwise zooming in on
        // a room on the far side of a large zone recenters on the middle of
        // the box instead, and the player loses the thing they zoomed in to
        // look at.
        const cx = clientX - rect.left
        const cy = clientY - rect.top
        const ratio = next / current
        setPan((p) => bounded({
          x: cx - (cx - p.x) * ratio,
          y: cy - (cy - p.y) * ratio,
        }, next))
      }
      onZoomChange(next)
    },
    [bounded, clampZoom, onZoomChange]
  )

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()
      zoomAt(e.deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR, e.clientX, e.clientY)
    },
    [zoomAt]
  )

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: panRef.current.x,
      originY: panRef.current.y,
      moved: false,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      d.moved = true
      setDragging(true)
    }
    if (d.moved) {
      const next = bounded({ x: d.originX + dx, y: d.originY + dy })
      panRef.current = next
      if (contentRef.current) {
        contentRef.current.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${zoomRef.current})`
      }
    }
  }, [bounded])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (d?.moved) {
      suppressNextClick.current = true
      setDragging(false)
      setPan(panRef.current)
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // Already released, or capture was never set (a non-primary button).
    }
  }, [])

  const onPointerCancel = useCallback((e: React.PointerEvent) => {
    drag.current = null
    setDragging(false)
    setPan(panRef.current)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // Capture may already have been released by the browser.
    }
  }, [])

  // Capture phase: runs before a room's own onClick, so a drag that happened
  // to end over a room never also asks Lich for a route to it.
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (suppressNextClick.current) {
      suppressNextClick.current = false
      e.stopPropagation()
      e.preventDefault()
    }
  }, [])

  const zoomBy = useCallback(
    (factor: number) => {
      const rect = containerRef.current?.getBoundingClientRect()
      // No cursor position to anchor to (a toolbar button, not a wheel) - the
      // box's own center is the only sensible point to zoom toward.
      zoomAt(factor, rect ? rect.left + rect.width / 2 : undefined, rect ? rect.top + rect.height / 2 : undefined)
    },
    [zoomAt]
  )

  const centerOn = useCallback((px: number, py: number) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setPan(bounded({
      x: rect.width / 2 - px * zoomRef.current,
      y: rect.height / 2 - py * zoomRef.current,
    }))
  }, [bounded])

  const resetPan = useCallback(() => setPan(bounded({ x: 0, y: 0 })), [bounded])

  return {
    containerRef,
    contentRef,
    x: pan.x,
    y: pan.y,
    zoom,
    dragging,
    handlers: { onWheel, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture },
    zoomBy,
    centerOn,
    resetPan,
  }
}
