/**
 * A panel you can move, resize and close.
 *
 * The controls live on the title bar and are all one click: up, down, collapse.
 * Resizing is a drag on the bottom edge. No menus — everything is where you can
 * see it, and nothing needs opening first to find out what it does.
 */
import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { ChevronUp, ChevronDown, ChevronsUp, ChevronsDown } from 'lucide-react'

export function Panel({
  title,
  icon,
  actions,
  children,
  closed,
  height,
  canMoveUp,
  canMoveDown,
  onMove,
  onToggle,
  onResize,
}: {
  title: string
  icon?: ReactNode
  /** Panel-specific controls, shown before the layout controls. */
  actions?: ReactNode
  children: ReactNode
  closed?: boolean
  height?: number
  canMoveUp: boolean
  canMoveDown: boolean
  onMove: (delta: number) => void
  onToggle: () => void
  onResize: (height: number) => void
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null)

  // Drag state lives in a ref, not React state: a resize fires on every mouse
  // move, and re-rendering the whole panel per pixel makes the drag feel like
  // it is catching on something.
  const drag = useRef<{ startY: number; startH: number } | null>(null)

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!drag.current) return
      const next = drag.current.startH + (e.clientY - drag.current.startY)
      onResize(Math.max(64, Math.min(1200, next)))
    },
    [onResize]
  )

  const endDrag = useCallback(() => {
    drag.current = null
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', endDrag)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', endDrag)
    }
  }, [onMouseMove, endDrag])

  function startDrag(e: React.MouseEvent) {
    e.preventDefault()
    drag.current = {
      startY: e.clientY,
      startH: height ?? bodyRef.current?.offsetHeight ?? 200,
    }
    // Set on the body, so the cursor stays a resize cursor even when the
    // pointer runs off the panel mid-drag.
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
  }

  return (
    <section className="rounded-xl border border-border bg-surface-raised">
      <header className="flex items-center justify-between gap-2 px-3 py-1.5">
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs font-medium text-ink-faint uppercase tracking-wider min-w-0 hover:text-ink"
          onClick={onToggle}
          title={closed ? 'Open' : 'Collapse'}
        >
          {icon}
          <span className="truncate">{title}</span>
          {closed ? (
            <ChevronDown className="w-3 h-3 shrink-0" />
          ) : (
            <ChevronUp className="w-3 h-3 shrink-0" />
          )}
        </button>

        <div className="flex items-center gap-1 shrink-0">
          {actions}
          <button
            type="button"
            className="p-0.5 rounded text-ink-faint hover:text-ink disabled:opacity-25"
            title="Move up"
            disabled={!canMoveUp}
            onClick={() => onMove(-1)}
          >
            <ChevronsUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className="p-0.5 rounded text-ink-faint hover:text-ink disabled:opacity-25"
            title="Move down"
            disabled={!canMoveDown}
            onClick={() => onMove(1)}
          >
            <ChevronsDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {!closed && (
        <>
          <div
            ref={bodyRef}
            className="px-3 pb-2 overflow-auto"
            style={height ? { height } : undefined}
          >
            {children}
          </div>

          {/* Grab strip. Tall enough to hit without being a visible bar. */}
          <div
            className="h-1.5 cursor-ns-resize group flex items-center justify-center"
            onMouseDown={startDrag}
            onDoubleClick={() => onResize(0)}
            title="Drag to resize, double-click to fit"
          >
            <div className="h-0.5 w-8 rounded-full bg-border group-hover:bg-ink-faint" />
          </div>
        </>
      )}
    </section>
  )
}
