import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/cn.ts'
import {
  foldCramped,
  measure,
  MIN_REGION,
  moveBoundary,
  type Dock,
} from '../../lib/dock.ts'
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
  const drag = useRef<{ index: number; start: number } | null>(null)

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

  const onMove = useCallback(
    (e: PointerEvent) => {
      const d = drag.current
      if (!d || !extent) return
      const position = horizontal ? e.clientX : e.clientY
      onChange(moveBoundary(shown, d.index, position - d.start, extent))
      d.start = position
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
              title="Bring this one back into the window" aria-label="Bring this one back into the window"
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
          className="flex min-h-0 min-w-0 flex-col overflow-auto"
          // Regions take the even orders and boundaries the odd ones, so the
          // two lists interleave without having to be built as one.
          style={{ order: i * 2, flexGrow: region.size, flexShrink: 1, flexBasis: 0 }}
        >
          {/* Every panel in the region is visible. No tabs.
           *
           * Folding used to turn a region into a tab strip, which is a menu:
           * one thing shown, everything else hidden behind a click, and no way
           * to see two things at once. The brief was the opposite of that —
           * dense and unpackable, not hidden.
           *
           * So a crowded region stacks its panels instead. Each keeps a hairline
           * header carrying its name and its controls, and the content below is
           * whatever that panel can show in the height it has. */}
          {region.panels.map((id) => (
            <section key={id} className="flex min-h-0 shrink-0 flex-col">
              <div className="flex items-center gap-1 px-2 pt-1.5">
                <span className="text-xs uppercase tracking-wide text-ink-faint">
                  {title(id)}
                </span>
                {onPopOut && (
                  <button
                    type="button"
                    onClick={() => onPopOut(id)}
                    title="Open this one in its own window"
                    className="ml-auto text-xs text-ink-faint hover:text-ink"
                  >
                    ↗
                  </button>
                )}
              </div>
              <div className="min-h-0 px-2 pb-2">{render(id)}</div>
            </section>
          ))}
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
          role="separator"
          tabIndex={0}
          aria-label={`Resize ${title(region.panels[0])} and ${title(shown.regions[i + 1].panels[0])}`}
          aria-orientation={horizontal ? 'vertical' : 'horizontal'}
          aria-valuemin={Math.round((MIN_REGION / Math.max(extent, 1)) * 100)}
          aria-valuemax={Math.round((1 - MIN_REGION / Math.max(extent, 1)) * 100)}
          aria-valuenow={Math.round((measure(shown, extent || 1)[i] / Math.max(extent, 1)) * 100)}
          aria-valuetext={`${Math.round(measure(shown, extent || 1)[i])} pixels to ${title(region.panels[0])}`}
          title="Drag or use arrow keys to resize; Home and End move to the limits."
          onPointerDown={(e) => {
            e.preventDefault()
            drag.current = { index: i, start: horizontal ? e.clientX : e.clientY }
            document.body.style.cursor = horizontal ? 'col-resize' : 'row-resize'
            document.body.style.userSelect = 'none'
          }}
          onKeyDown={(e) => {
            if (!extent) return
            const [decrease, increase] = horizontal ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
            if (![decrease, increase, 'Home', 'End'].includes(e.key)) return
            e.preventDefault()
            const sizes = measure(shown, extent)
            const delta = e.key === decrease
              ? -20
              : e.key === increase
                ? 20
                : e.key === 'Home'
                  ? MIN_REGION - sizes[i]
                  : sizes[i + 1] - MIN_REGION
            onChange(moveBoundary(shown, i, delta, extent))
          }}
        />
      ))}
    </div>
  )
}
