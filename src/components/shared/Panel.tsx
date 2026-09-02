/**
 * A panel you can drag, resize and collapse.
 *
 * Reordering is drag and drop, because that is the obvious gesture — pick the
 * panel up, put it where you want it. It used to be a pair of step arrows,
 * which is what you build when you have not built dragging yet: moving a panel
 * four places meant pressing an arrow four times and watching the layout hop.
 *
 * Resizing is a drag on the bottom edge. Collapsing is a click on the title.
 * No menus: every control is visible and does one thing.
 */
import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import {
  ChevronUp,
  ChevronDown,
  GripVertical,
  ExternalLink,
} from 'lucide-react'

export function Panel({
  title,
  icon,
  actions,
  children,
  closed,
  height,
  dragging,
  dropBefore,
  dropAfter,
  onDragStart,
  onDragEnd,
  onDragOverPanel,
  onDropPanel,
  onToggle,
  onResize,
  onPopOut,
}: {
  title: string
  icon?: ReactNode
  /** Panel-specific controls, shown before the grip. */
  actions?: ReactNode
  /** Absent in the browser, where there are no windows to pop into. */
  onPopOut?: () => void
  children: ReactNode
  closed?: boolean
  height?: number
  /** This panel is the one being dragged. */
  dragging?: boolean
  /** Show an insertion line above or below, as the drop target. */
  dropBefore?: boolean
  dropAfter?: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onDragOverPanel: (before: boolean) => void
  onDropPanel: () => void
  onToggle: () => void
  onResize: (height: number) => void
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null)

  // Resize state lives in a ref, not React state: a drag fires on every mouse
  // move, and re-rendering the whole panel per pixel makes it feel like it is
  // catching on something.
  const resize = useRef<{ startY: number; startH: number } | null>(null)

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!resize.current) return
      const next = resize.current.startH + (e.clientY - resize.current.startY)
      onResize(Math.max(64, Math.min(1200, next)))
    },
    [onResize]
  )

  const endResize = useCallback(() => {
    resize.current = null
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', endResize)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', endResize)
    }
  }, [onMouseMove, endResize])

  function startResize(e: React.MouseEvent) {
    e.preventDefault()
    resize.current = {
      startY: e.clientY,
      startH: height ?? bodyRef.current?.offsetHeight ?? 200,
    }
    // Set on the body so the cursor stays a resize cursor even when the
    // pointer runs off the panel mid-drag.
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
  }

  return (
    <section
      className={`relative rounded-xl border bg-surface-raised transition-opacity ${
        dragging ? 'opacity-40 border-accent' : 'border-border'
      }`}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        // Which half the cursor is in decides whether the panel lands above or
        // below this one, so a drop is never ambiguous.
        const box = e.currentTarget.getBoundingClientRect()
        onDragOverPanel(e.clientY < box.top + box.height / 2)
      }}
      onDrop={(e) => {
        e.preventDefault()
        onDropPanel()
      }}
    >
      {dropBefore && <Insertion position="top" />}
      {dropAfter && <Insertion position="bottom" />}

      <header className="flex items-center justify-between gap-2 px-2 py-0.5">
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs font-medium text-ink-faint uppercase tracking-wide min-w-0 hover:text-ink"
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
          {onPopOut && (
            <button
              type="button"
              className="p-0.5 rounded text-ink-faint hover:text-ink"
              title="Open in its own window" aria-label="Open in its own window"
              onClick={onPopOut}
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
          {/* Only the grip is draggable, not the whole panel, so selecting text
              or pressing a button inside does not start a drag. */}
          <span
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move'
              // Firefox refuses to start a drag with no payload at all.
              e.dataTransfer.setData('text/plain', title)
              onDragStart()
            }}
            onDragEnd={onDragEnd}
            className="p-0.5 rounded text-ink-faint hover:text-ink cursor-grab active:cursor-grabbing"
            title="Drag to reorder"
          >
            <GripVertical className="w-3.5 h-3.5" />
          </span>
        </div>
      </header>

      {!closed && (
        <>
          <div
            ref={bodyRef}
            className="px-2 pb-1 overflow-auto"
            style={height ? { height } : undefined}
          >
            {children}
          </div>

          {/* Grab strip. Tall enough to hit, quiet enough not to be furniture. */}
          <div
            className="h-1.5 cursor-ns-resize group flex items-center justify-center"
            onMouseDown={startResize}
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

function Insertion({ position }: { position: 'top' | 'bottom' }) {
  return (
    <div
      className={`absolute left-0 right-0 h-0.5 bg-accent rounded-full pointer-events-none ${
        position === 'top' ? '-top-1.5' : '-bottom-1.5'
      }`}
    />
  )
}
