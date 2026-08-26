import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/cn'
import {
  activate,
  foldCramped,
  measure,
  moveBoundary,
  type Dock,
} from '../../lib/dock'
import type { PanelId } from '../../lib/layout'

/**
 * Regions with shared boundaries, folding into decks as space runs out.
 *
 * One observer on the container, not one per panel. That is the fix for the
 * stickiness: previously every panel measured itself and re-decided its own
 * density, so six observers each reacted to a resize by changing a layout the
 * others were mid-measurement of, and nothing settled.
 *
 * Here the container measures once, arithmetic decides how many regions that
 * width can carry, and everything below follows from that single number.
 */
export function DockView({
  dock,
  onChange,
  title,
  render,
  onPopOut,
  out,
  onPopBack,
}: {
  dock: Dock
  onChange: (next: Dock) => void
  title: (id: PanelId) => string
  render: (id: PanelId) => React.ReactNode
  /** Tear a panel into its own window. Survives from the old stack layout. */
  onPopOut?: (id: PanelId) => void
  /** Panels currently living in their own windows. */
  out?: PanelId[]
  onPopBack?: (id: PanelId) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const [extent, setExtent] = useState(0)
  const drag = useRef<{ index: number; startX: number } | null>(null)

  const horizontal = dock.axis === 'row'

  useEffect(() => {
    const el = host.current
    if (!el) return
    const ro = new ResizeObserver(([e]) =>
      setExtent(horizontal ? e.contentRect.width : e.contentRect.height)
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [horizontal])

  // Folding is derived from the measured extent rather than stored, so the
  // arrangement the player chose survives a window they made narrow and then
  // wide again. Their layout is the input; what fits is a view of it.
  const shown = extent > 0 ? foldCramped(dock, extent) : dock
  const sizes = extent > 0 ? measure(shown, extent) : []

  const onMove = useCallback(
    (e: PointerEvent) => {
      const d = drag.current
      if (!d || !extent) return
      onChange(moveBoundary(shown, d.index, e.clientX - d.startX, extent))
      d.startX = e.clientX
    },
    [extent, onChange, shown]
  )

  const onUp = useCallback(() => {
    drag.current = null
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  useEffect(() => {
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [onMove, onUp])

  return (
    <div
      ref={host}
      className={cn('relative flex h-full w-full min-h-0 min-w-0', horizontal ? 'flex-row' : 'flex-col')}
    >
      {/* A panel in its own window is not lost, it is elsewhere. Without this
          the only way back was to know the window existed. */}
      {out && out.length > 0 && (
        <div className="absolute right-1 top-1 z-30 flex gap-1" style={{ order: 999 }}>
          {out.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onPopBack?.(id)}
              title="Bring this one back into the window"
              className="rounded border border-border bg-surface-raised px-1.5 py-0.5 text-xs text-ink-faint hover:text-ink"
            >
              {title(id)}
            </button>
          ))}
        </div>
      )}

      {shown.regions.map((region, i) => (
        <div
          key={region.id}
          className="flex min-h-0 min-w-0 flex-col"
          // Regions take the even orders and boundaries the odd ones, so the
          // two lists interleave without having to be built as one.
          style={{
            order: i * 2,
            [horizontal ? 'width' : 'height']: sizes[i] ? `${sizes[i]}px` : undefined,
          }}
        >
          {/* Tabs only where there is a deck. A single panel does not need a
              tab telling it what it is; the panel already says so. */}
          {region.panels.length > 1 && (
            <div className="flex shrink-0 gap-px overflow-x-auto border-b border-border">
              {region.panels.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onChange(activate(shown, id))}
                  className={cn(
                    'shrink-0 px-2 py-1 text-xs',
                    id === region.active
                      ? 'bg-surface-raised text-ink'
                      : 'text-ink-faint hover:text-ink-muted'
                  )}
                >
                  {title(id)}
                </button>
              ))}
              {onPopOut && (
                <button
                  type="button"
                  onClick={() => onPopOut(region.active)}
                  title="Open this one in its own window"
                  className="ml-auto shrink-0 px-2 py-1 text-xs text-ink-faint hover:text-ink"
                >
                  pop out
                </button>
              )}
            </div>
          )}

          <div className="min-h-0 min-w-0 flex-1 overflow-auto">
            {render(region.panels.length > 1 ? region.active : region.panels[0])}
          </div>
        </div>
      ))}

      {/* Boundaries sit between regions, so there is one fewer than regions
          and dragging one takes from a neighbour rather than from nowhere. */}
      {shown.regions.slice(0, -1).map((region, i) => (
        <span
          key={`b:${region.id}`}
          className={cn(
            'shrink-0 touch-none bg-border/60 hover:bg-ink-faint',
            horizontal ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize'
          )}
          style={{ order: i * 2 + 1 }}
          onPointerDown={(e) => {
            e.preventDefault()
            drag.current = { index: i, startX: e.clientX }
            document.body.style.cursor = horizontal ? 'col-resize' : 'row-resize'
            document.body.style.userSelect = 'none'
          }}
        />
      ))}
    </div>
  )
}
