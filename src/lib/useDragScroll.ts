import { useRef, type PointerEvent as ReactPointerEvent } from 'react'

/**
 * Grab-and-drag panning for a scrollable element, in place of hunting for a
 * thin scrollbar thumb. Pair with a `no-scrollbar` class (see index.css) to
 * hide the visible rail — a trackpad or a mouse wheel still scrolls the
 * element normally either way; this only adds "grab the content and pull".
 * Shared by `CombatRadar`'s corner panes and `ClassicRoomText`'s room-text
 * box, and meant for anywhere else that wants the same gesture rather than
 * a second copy of it.
 *
 * The one thing a drag must never do is also fire whatever it happened to
 * release on top of — a pan that ends over a button must not click it.
 * Past a small movement threshold the gesture is committed to being a
 * drag, and the click the browser fires on release is swallowed with a
 * one-shot capture-phase listener, which runs before the target's own
 * click handler ever sees the event.
 */
export function useDragScroll() {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef({ down: false, moved: false, x: 0, y: 0, left: 0, top: 0 })
  const DRAG_THRESHOLD_PX = 4

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el) return
    drag.current = { down: true, moved: false, x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
    el.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = ref.current
    const d = drag.current
    if (!el || !d.down) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) d.moved = true
    if (d.moved) {
      el.scrollLeft = d.left - dx
      el.scrollTop = d.top - dy
    }
  }

  const endDrag = () => {
    const el = ref.current
    const d = drag.current
    if (el && d.moved) {
      const swallow = (ev: MouseEvent) => {
        ev.stopPropagation()
        ev.preventDefault()
      }
      el.addEventListener('click', swallow, { capture: true, once: true })
    }
    drag.current.down = false
    drag.current.moved = false
  }

  return {
    ref,
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  }
}
