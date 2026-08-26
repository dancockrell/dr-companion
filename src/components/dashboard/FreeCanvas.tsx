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
        const next =
          d.mode === 'move'
            ? { ...d.from, x: d.from.x + dx, y: d.from.y + dy }
            : {
                ...d.from,
                w: Math.max(MIN_W, d.from.w + dx),
                h: Math.max(MIN_H, d.from.h + dy),
              }
        return { ...d, rect: next }
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

  useEffect(() => {
    if (!drag) return
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [drag, onPointerMove, onPointerUp])

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
                setDrag({
                  id: item.id,
                  mode: 'move',
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

            {/* Resize from the corner, which is where everyone reaches for it. */}
            <span
              className="absolute bottom-0 right-0 h-3.5 w-3.5 cursor-nwse-resize touch-none"
              onPointerDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setDrag({
                  id: item.id,
                  mode: 'resize',
                  rect: shown,
                  from: shown,
                  startX: e.clientX,
                  startY: e.clientY,
                })
              }}
            />
          </div>
        )
      })}
    </div>
  )
}
