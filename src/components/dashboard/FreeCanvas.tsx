import { useCallback, useEffect, useRef, useState } from 'react'
import { GripVertical } from 'lucide-react'
import { cn } from '../../lib/cn'
import {
  MIN_H,
  MIN_W,
  clampToBounds,
  firstFreeSlot,
  resolveCollisions,
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
      firstFreeSlot({ w: Math.min(360, bounds.w || 360), h: 220 }, taken, {
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

  const onPointerUp = useCallback(() => {
    setDrag((d) => {
      if (!d) return null
      const others = [...placed.entries()]
        .filter(([id]) => id !== d.id)
        .map(([, r]) => r)
      onPlace(d.id, resolveCollisions(d.rect, others, bounds))
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
      {items.map((item) => {
        const live = drag?.id === item.id ? drag.rect : placed.get(item.id)!
        const shown = clampToBounds(live, bounds.w ? bounds : { w: 1200, h: 800 })
        const dragging = drag?.id === item.id

        return (
          <div
            key={item.id}
            className={cn(
              'absolute flex flex-col overflow-hidden rounded-lg border bg-surface-raised',
              dragging
                ? 'z-20 border-accent shadow-lg'
                : 'z-10 border-border'
            )}
            style={{ left: shown.x, top: shown.y, width: shown.w, height: shown.h }}
          >
            <div
              className="flex cursor-grab touch-none items-center gap-1 px-1.5 py-1 active:cursor-grabbing"
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
            >
              <GripVertical className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">{item.node}</div>

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
  )
}
