import { useCallback, useEffect, useRef, useState } from 'react'
import { clampSplitterValue, splitterRange } from '../../lib/splitterRange'

/**
 * A draggable divider between two columns.
 *
 * The companion and the room started at a fixed half each, which is the right
 * default and the wrong permanent arrangement: someone reading a long room
 * description wants the right side wider, and someone watching a map through a
 * hunting loop wants the left. A split you cannot move is a decision taken on
 * the player's behalf every session.
 *
 * Behaves the way a Windows splitter behaves, which is the whole brief. Wide
 * enough to hit, a resize cursor so it is discoverable, and it keeps the
 * cursor while you drag even when the pointer runs off the edge of it.
 */
export function Splitter({
  value,
  onChange,
  min = 0.25,
  max = 0.75,
  /**
   * 'vertical' (default) draws a vertical bar and splits left/right columns
   * by X - the original shape. 'horizontal' draws a horizontal bar and
   * splits top/bottom panes by Y, for a column that stacks rather than sits
   * side by side (Game above Channels, say). Same drag mechanics either
   * way; only the axis read from the pointer and the bar's own dimensions
   * change.
   */
  orientation = 'vertical',
  label,
  defaultValue,
}: {
  /** The first column/pane's share, 0 to 1. */
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  orientation?: 'vertical' | 'horizontal'
  /** Names the two surfaces this divider resizes. */
  label: string
  /** Product default used by double-click; midpoint when omitted. */
  defaultValue?: number
}) {
  const [dragging, setDragging] = useState(false)
  const host = useRef<HTMLDivElement>(null)
  const horizontal = orientation === 'horizontal'
  const range = splitterRange(min, max)
  const emit = useCallback(
    (next: number) => onChange(clampSplitterValue(next, range)),
    [onChange, range.min, range.max]
  )

  const shareAt = useCallback(
    (clientPos: number) => {
      const parent = host.current?.parentElement
      if (!parent) return null
      const box = parent.getBoundingClientRect()
      const extent = horizontal ? box.height : box.width
      const origin = horizontal ? box.top : box.left
      if (extent <= 0) return null
      return clampSplitterValue((clientPos - origin) / extent, range)
    },
    [range.min, range.max, horizontal]
  )

  /**
   * Pointer capture, rather than listeners hung on the window.
   *
   * The first version attached pointermove in an effect keyed on a `dragging`
   * state flag, and lost every movement between the press and React committing
   * that state. A quick grab-and-throw did nothing at all, which is the exact
   * thing that makes a divider feel broken.
   *
   * Capture also means the events keep arriving when the pointer leaves the
   * eight pixels of the divider, which it does immediately, and releases
   * automatically if the pointer is cancelled — so there is no way to end a
   * drag with the body cursor still overridden.
   */
  /**
   * The pointer currently dragging, held in a ref rather than in state.
   *
   * A ref because it has to be readable in the very next event. React state
   * has not committed by the time the first pointermove arrives, which is what
   * made a quick grab-and-throw move nothing at all — twice, once with window
   * listeners and again with a `dragging` flag.
   *
   * `hasPointerCapture` would also be synchronous and is not used as the gate,
   * because capture only exists for a real pointer: it cannot be established
   * for a synthesised event, so gating on it makes this control untestable
   * without a physical mouse. The capture is still taken, for the behaviour it
   * gives real input.
   */
  const activePointer = useRef<number | null>(null)

  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    activePointer.current = e.pointerId
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Not a live pointer, which happens under synthetic events. The ref above
      // is the gate, so the drag still works without it.
    }
    setDragging(true)
    document.body.style.cursor = horizontal ? 'row-resize' : 'col-resize'
    // Otherwise the drag selects whatever text it passes over.
    document.body.style.userSelect = 'none'
  }

  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    activePointer.current = null
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
    } catch {
      // See above.
    }
    setDragging(false)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  // A component unmounted mid-drag would otherwise leave the whole app stuck
  // showing a resize cursor with text selection disabled.
  useEffect(
    () => () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    },
    []
  )

  return (
    <div
      ref={host}
      role="separator"
      aria-label={label}
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
      aria-valuemin={Math.round(range.min * 100)}
      aria-valuemax={Math.round(range.max * 100)}
      aria-valuenow={Math.round(clampSplitterValue(value, range) * 100)}
      aria-valuetext={`${Math.round(clampSplitterValue(value, range) * 100)}% to the first pane`}
      tabIndex={0}
      title={`${label}. Drag or use arrow keys to resize; Home/End move to the limits; double-click restores the default.`}
      onPointerDown={start}
      onPointerMove={(e) => {
        if (activePointer.current !== e.pointerId) return
        const next = shareAt(horizontal ? e.clientY : e.clientX)
        if (next !== null) emit(next)
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => emit(defaultValue ?? (range.min + range.max) / 2)}
      // Arrow keys, because a divider that only answers to the mouse is one
      // more thing that cannot be reached without it. Up/down for a
      // horizontal bar, left/right for a vertical one - whichever axis the
      // bar actually moves along.
      onKeyDown={(e) => {
        const [dec, inc] = horizontal ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight']
        if (![dec, inc, 'Home', 'End'].includes(e.key)) return
        e.preventDefault()
        if (e.key === dec) emit(value - 0.02)
        if (e.key === inc) emit(value + 0.02)
        if (e.key === 'Home') emit(range.min)
        if (e.key === 'End') emit(range.max)
      }}
      className={
        horizontal
          ? `h-2 w-full shrink-0 cursor-row-resize touch-none border-y transition-colors ${
              dragging ? 'border-accent bg-accent/25' : 'border-border bg-surface hover:bg-surface-overlay'
            }`
          : `w-2 shrink-0 cursor-col-resize touch-none border-x transition-colors ${
              dragging ? 'border-accent bg-accent/25' : 'border-border bg-surface hover:bg-surface-overlay'
            }`
      }
    />
  )
}
