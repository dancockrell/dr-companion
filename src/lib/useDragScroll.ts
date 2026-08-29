/**
 * Grab-and-drag scrolling for a plain scrollable box - the Tasks & Scripts
 * grid, once "Lich scripts" alone can be 200+ tiles and a trackpad or a
 * thin scrollbar thumb is the only way to move through it otherwise.
 *
 * Same shape as `useMapViewport.ts`'s pan handling, deliberately: a pointer
 * down/move/up sequence past a small threshold starts a drag, and the
 * following click is suppressed in the capture phase so a drag that happens
 * to end over a tile does not also run it - a real drag and a real click
 * are told apart by distance moved, not by which element the pointer
 * started on, for the same reason the map's own comment gives.
 *
 * Native `overflow: auto` scrolling still works underneath this (wheel,
 * trackpad, scrollbar drag) - this only adds the click-and-drag path on
 * top, the same way the map's zoom/pan hook adds a gesture rather than
 * replacing the browser's own.
 */
import { useCallback, useRef, useState } from 'react'

/** Pointer movement below this, in CSS pixels, still counts as a click. */
const DRAG_THRESHOLD_PX = 4

export interface DragScroll<T extends HTMLElement> {
  /** Attach to the scrollable element itself. */
  containerRef: React.RefObject<T | null>
  /** True while an actual drag (past the threshold) is in progress. */
  dragging: boolean
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void
    onPointerMove: (e: React.PointerEvent) => void
    onPointerUp: (e: React.PointerEvent) => void
    onClickCapture: (e: React.MouseEvent) => void
  }
}

export function useDragScroll<T extends HTMLElement>(): DragScroll<T> {
  const containerRef = useRef<T | null>(null)
  const [dragging, setDragging] = useState(false)

  const drag = useRef<{
    startX: number
    startY: number
    startScrollLeft: number
    startScrollTop: number
    moved: boolean
  } | null>(null)
  // Set the instant a drag crosses the threshold, cleared by the next click
  // - bridges pointerup (where "did this move" is known) and the click
  // event that follows it, since stopPropagation on pointerup does not
  // reach a click; they are unrelated events in the same interaction.
  const suppressNextClick = useRef(false)

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    const el = containerRef.current
    if (!el) return
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      startScrollLeft: el.scrollLeft,
      startScrollTop: el.scrollTop,
      moved: false,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current
    const el = containerRef.current
    if (!d || !el) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      d.moved = true
      setDragging(true)
    }
    if (d.moved) {
      // The content follows the pointer, same as a touch scroll: dragging
      // down moves the scroll position up (toward the start of the list).
      el.scrollLeft = d.startScrollLeft - dx
      el.scrollTop = d.startScrollTop - dy
    }
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (d?.moved) {
      suppressNextClick.current = true
      setDragging(false)
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // Already released, or capture was never set (a non-primary button).
    }
  }, [])

  // Capture phase: runs before a tile's own onClick, so a drag that
  // happened to end over a tile never also runs it.
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (suppressNextClick.current) {
      suppressNextClick.current = false
      e.stopPropagation()
      e.preventDefault()
    }
  }, [])

  return {
    containerRef,
    dragging,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onClickCapture },
  }
}
