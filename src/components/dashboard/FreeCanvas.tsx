import { useCallback, useEffect, useRef, useState } from 'react'
import { GripVertical } from 'lucide-react'
import { cn } from '../../lib/cn'
import {
  MIN_H,
  MIN_W,
  adjustKeyboardRect,
  clampToBounds,
  gridSlot,
  type KeyboardRectAction,
  type Rect,
} from '../../lib/freeLayout'
import type { PanelId } from '../../lib/layout'

export interface Placed {
  id: PanelId
  rect?: Rect
  node: React.ReactNode
}

type Edge = 'n' | 's' | 'e' | 'w'

/**
 * The grab area on each edge, in pixels.
 *
 * Eight is what Windows itself uses for a window border and it is the number
 * worth copying rather than improving on: it is small enough not to steal
 * clicks from the panel's own content and large enough to hit without aiming.
 */
const GRAB = 8

/**
 * Eight handles, the way every window on this machine resizes.
 *
 * Corners come last so they win where they overlap an edge. Both cover the
 * same few pixels, and grabbing a corner and getting one axis is the more
 * annoying of the two possible mistakes.
 *
 * The cursors are the standard ones, and they matter more than they look: a
 * resize edge with no cursor change is an edge nobody discovers.
 */
const HANDLES: Array<{ edges: Edge[]; cursor: string; style: React.CSSProperties }> = [
  { edges: ['n'], cursor: 'cursor-ns-resize', style: { top: 0, left: GRAB, right: GRAB, height: GRAB } },
  { edges: ['s'], cursor: 'cursor-ns-resize', style: { bottom: 0, left: GRAB, right: GRAB, height: GRAB } },
  { edges: ['w'], cursor: 'cursor-ew-resize', style: { left: 0, top: GRAB, bottom: GRAB, width: GRAB } },
  { edges: ['e'], cursor: 'cursor-ew-resize', style: { right: 0, top: GRAB, bottom: GRAB, width: GRAB } },
  { edges: ['n', 'w'], cursor: 'cursor-nwse-resize', style: { top: 0, left: 0, width: GRAB, height: GRAB } },
  { edges: ['n', 'e'], cursor: 'cursor-nesw-resize', style: { top: 0, right: 0, width: GRAB, height: GRAB } },
  { edges: ['s', 'w'], cursor: 'cursor-nesw-resize', style: { bottom: 0, left: 0, width: GRAB, height: GRAB } },
  { edges: ['s', 'e'], cursor: 'cursor-nwse-resize', style: { bottom: 0, right: 0, width: GRAB, height: GRAB } },
]

/**
 * Panels go where you put them.
 *
 * Pointer events rather than HTML5 drag and drop: native drag gives a ghost
 * image, a forbidden cursor over anything that is not a registered target, and
 * no position until the drop. None of that is wanted here, where the panel
 * should simply follow the pointer.
 *
 * The two rules are enforced on drop rather than during the drag, so the panel
 * tracks the pointer exactly and settles when released. Fighting the pointer
 * mid-drag feels like the app arguing with you.
 */
export function FreeCanvas({
  items,
  onPlace,
  onReflow,
}: {
  items: Placed[]
  onPlace: (id: PanelId, rect: Rect) => void
  /** Back to the automatic flow. Freeform should not be a one-way door. */
  onReflow?: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const [bounds, setBounds] = useState({ w: 0, h: 0 })
  const [drag, setDrag] = useState<{
    id: PanelId
    mode: 'move' | 'resize'
    /** Which edges are being pulled. Empty for a move. */
    edges: Edge[]
    rect: Rect
    startX: number
    startY: number
    from: Rect
  } | null>(null)
  const [keyboard, setKeyboard] = useState<{ id: PanelId; from: Rect; rect: Rect } | null>(null)
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    const el = host.current
    if (!el) return
    const ro = new ResizeObserver(([e]) =>
      setBounds({ w: e.contentRect.width, h: e.contentRect.height })
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // A panel that has never been placed gets packed in rather than piled at the
  // origin, so turning freeform on does not scatter everything.
  const placed = new Map<PanelId, Rect>()
  const taken: Rect[] = []
  for (const item of items) {
    const rect =
      item.rect ??
      gridSlot(items.indexOf(item), items.length, {
        w: bounds.w || 1200,
        h: bounds.h || 800,
      })
    placed.set(item.id, rect)
    taken.push(rect)
  }

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      setDrag((d) => {
        if (!d) return d
        const dx = e.clientX - d.startX
        const dy = e.clientY - d.startY
        if (d.mode === 'move') {
          return { ...d, rect: { ...d.from, x: d.from.x + dx, y: d.from.y + dy } }
        }

        // Pulling a top or left edge moves the corner as well as the size, and
        // the minimum has to be applied to the size before the origin follows
        // it. Doing it the other way round lets a panel dragged past its own
        // minimum keep walking left while staying the same width, which looks
        // exactly like the panel escaping the cursor.
        let { x, y, w, h } = d.from
        if (d.edges.includes('e')) w = Math.max(MIN_W, d.from.w + dx)
        if (d.edges.includes('s')) h = Math.max(MIN_H, d.from.h + dy)
        if (d.edges.includes('w')) {
          w = Math.max(MIN_W, d.from.w - dx)
          x = d.from.x + (d.from.w - w)
        }
        if (d.edges.includes('n')) {
          h = Math.max(MIN_H, d.from.h - dy)
          y = d.from.y + (d.from.h - h)
        }
        return { ...d, rect: { x, y, w, h } }
      })
    },
    []
  )

  /**
   * Put a panel in front of the others.
   *
   * Writes only when it is not already on top. Raising on every pointerdown
   * would persist a layout change on every single click into a panel, which
   * is a lot of storage churn for a value that did not change.
   */
  const raise = useCallback(
    (id: PanelId) => {
      const rect = placed.get(id)
      if (!rect) return
      let top = 0
      let topId: PanelId | null = null
      for (const [otherId, r] of placed) {
        const z = r.z ?? 0
        if (z >= top) {
          top = z
          topId = otherId
        }
      }
      if (topId === id) return
      onPlace(id, { ...rect, z: top + 1 })
    },
    [placed, onPlace]
  )

  const onPointerUp = useCallback(() => {
    setDrag((d) => {
      if (!d) return null
      // Dropped where it was dropped.
      //
      // This used to call resolveCollisions, which shoved the panel out of
      // anything it landed on. That is the behaviour Dan described as sticky,
      // and it is worth being precise about why it was wrong rather than just
      // deleting it: it made the canvas a tiling layout wearing a window
      // manager's clothes. You could put a panel anywhere except where you
      // aimed, and two panels could never share space even when the whole
      // point was to park one over another.
      //
      // Panels now overlap, and `z` decides what is in front. Still clamped to
      // the canvas, because a panel dragged off the edge is a panel nobody can
      // get back - overlapping is a choice the player made, off-screen is not.
      onPlace(d.id, clampToBounds(d.rect, bounds))
      return null
    })
  }, [bounds, onPlace, placed])

  /*
   * Attached for the life of the component, not for the life of a drag.
   *
   * They used to be attached in an effect gated on `drag`, which meant they
   * did not exist until React had committed the state set during pointerdown.
   * Every movement before that commit was lost, so a quick grab-and-throw
   * moved the panel a little or not at all, and the panel appeared to stick.
   *
   * Both handlers already no-op when there is no drag in progress, so leaving
   * them attached costs one pair of listeners and removes the race entirely.
   * pointercancel is included because a captured pointer taken away by the OS
   * would otherwise leave a panel following the cursor forever.
   */
  useEffect(() => {
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [onPointerMove, onPointerUp])

  return (
    <div ref={host} className="relative h-full w-full overflow-hidden">
      {onReflow && (
        <button
          type="button"
          onClick={onReflow}
          className="absolute right-1 top-1 z-30 rounded px-1.5 py-0.5 text-xs text-ink-faint hover:text-ink"
          title="Put the panels back into columns"
        >
          reflow
        </button>
      )}
      {/* Keep panel-local z values inside one layer. Persisted panel order is
          intentionally unbounded, and the active panel uses 9999, but neither
          should ever cover canvas chrome such as the reflow escape hatch. */}
      <div className="absolute inset-0 z-10">
      {items.map((item) => {
        const live = drag?.id === item.id
          ? drag.rect
          : keyboard?.id === item.id
            ? keyboard.rect
            : placed.get(item.id)!
        const shown = clampToBounds(live, bounds.w ? bounds : { w: 1200, h: 800 })
        const dragging = drag?.id === item.id || keyboard?.id === item.id
        const manipulating = keyboard?.id === item.id

        return (
          <div
            key={item.id}
            className={cn(
              'absolute flex flex-col overflow-hidden rounded-lg border bg-surface-raised',
              dragging ? 'border-accent shadow-lg' : 'border-border'
            )}
            style={{
              left: shown.x,
              top: shown.y,
              width: shown.w,
              height: shown.h,
              // The dragged panel is always in front while it is moving, so it
              // is never lost behind something it is being dragged across.
              // Otherwise the persisted order decides.
              zIndex: dragging ? 9999 : 10 + (shown.z ?? 0),
            }}
            // Capture, so clicking anything inside raises the panel without
            // the content having to know this canvas exists. Not preventDefault
            // and not stopPropagation: the click must still reach the button
            // the player was actually aiming at.
            onPointerDownCapture={() => raise(item.id)}
          >
            {/* Thinned from a py-1 bar with a 14px icon to this: still its own
                row (an absolute overlay here would land in the same corner
                pixels the resize handles already claim, at `GRAB` below, and
                lose the drag to whichever paints on top), but the smallest
                strip that keeps a comfortable pointer target rather than the
                icon's own bounding box. That reserved row was pure "useless
                menu" for any panel not actively being reordered. */}
            <button
              type="button"
              className="flex h-5 shrink-0 cursor-grab touch-none items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent active:cursor-grabbing"
              onPointerDown={(e) => {
                e.preventDefault()
                e.currentTarget.setPointerCapture(e.pointerId)
                setDrag({
                  id: item.id,
                  mode: 'move',
                  edges: [],
                  rect: shown,
                  from: shown,
                  startX: e.clientX,
                  startY: e.clientY,
                })
              }}
              title="Drag to move"
              aria-label={`Move or resize ${item.id} panel`}
              aria-describedby={manipulating ? `arrange-help-${item.id}` : undefined}
              aria-pressed={manipulating}
              onKeyDown={(e) => {
                const current = keyboard?.id === item.id ? keyboard : null
                if (!current && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault()
                  setKeyboard({ id: item.id, from: shown, rect: shown })
                  setAnnouncement(`${item.id} panel arrangement started. Arrow keys move. Shift plus arrows resize. Page Up and Page Down change stacking. Enter saves. Escape cancels.`)
                  return
                }
                if (!current) return
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setKeyboard(null)
                  setAnnouncement(`${item.id} panel changes cancelled.`)
                  return
                }
                if (e.key === 'Enter') {
                  e.preventDefault()
                  onPlace(item.id, current.rect)
                  setKeyboard(null)
                  setAnnouncement(`${item.id} panel saved.`)
                  return
                }
                const direction = e.key === 'ArrowLeft' ? 'left' : e.key === 'ArrowRight' ? 'right' : e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowDown' ? 'down' : null
                const action: KeyboardRectAction | null = e.key === 'PageUp'
                  ? 'bring-forward'
                  : e.key === 'PageDown'
                    ? 'send-backward'
                    : direction
                      ? e.shiftKey
                        ? direction === 'left' ? 'shrink-width' : direction === 'right' ? 'grow-width' : direction === 'up' ? 'shrink-height' : 'grow-height'
                        : `move-${direction}`
                      : null
                if (!action) return
                e.preventDefault()
                const rect = adjustKeyboardRect(current.rect, action, bounds.w ? bounds : { w: 1200, h: 800 })
                setKeyboard({ ...current, rect })
                setAnnouncement(`${item.id}: x ${Math.round(rect.x)}, y ${Math.round(rect.y)}, width ${Math.round(rect.w)}, height ${Math.round(rect.h)}, layer ${rect.z ?? 0}.`)
              }}
            >
              <GripVertical className="h-3 w-3 shrink-0 text-ink-faint" />
            </button>

            {manipulating && (
              <p id={`arrange-help-${item.id}`} className="shrink-0 px-2 py-1 text-xs text-ink-faint">
                Arrows move · Shift + arrows resize · Page Up/Down layer · Enter save · Escape cancel
              </p>
            )}

            <div className="min-h-0 flex-1 overflow-auto p-1.5">{item.node}</div>

            {/* All eight, the way every window on this machine resizes.
             *
             * It used to be the bottom-right corner alone, which is where
             * people reach first and not where they reach only. A panel at the
             * bottom of the canvas cannot be made shorter from a corner that
             * only grows downward, and one at the right edge cannot be made
             * narrower without first moving it.
             *
             * The corners are listed after the edges so they win the overlap:
             * both cover the same few pixels, and grabbing a corner and getting
             * one axis is the more annoying of the two mistakes. */}
            {HANDLES.map(({ edges, cursor, style }) => (
              <span
                key={edges.join('')}
                className={`absolute touch-none ${cursor}`}
                style={style}
                onPointerDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  e.currentTarget.setPointerCapture(e.pointerId)
                  setDrag({
                    id: item.id,
                    mode: 'resize',
                    edges,
                    rect: shown,
                    from: shown,
                    startX: e.clientX,
                    startY: e.clientY,
                  })
                }}
              />
            ))}
          </div>
        )
      })}
      </div>
      <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
    </div>
  )
}
