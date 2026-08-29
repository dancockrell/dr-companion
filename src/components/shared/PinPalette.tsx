/**
 * Every preset pin type, in one grab-and-drag row - drag one onto a room on
 * the map to place it there directly.
 *
 * QuickTravel's four buttons (bank/healer/guild/shop) already do this, but
 * they are also a live "nearest" search, which only those four categories
 * have a game query for. The other forty-six presets have no such query -
 * dragging is the only way to place them, so they need their own row rather
 * than being squeezed into QuickTravel's.
 *
 * Fifty icons do not fit in a row at any reasonable width, so this scrolls -
 * with real pointer-driven drag-to-scroll, the same mechanic and the same
 * reasoning as PinEditor's own icon picker (see that file's header): native
 * wheel/trackpad overflow-x-auto is not what "grab and drag" means. A drag
 * that ends over a preset button must not also select it as a click, which
 * is what the `moved` flag below is for.
 */
import { useRef } from 'react'
import { PIN_PRESETS, PIN_COLOR_HEX, PIN_DRAG_TYPE } from '../../lib/mapPins'
import { PIN_ICON_COMPONENT } from '../../lib/pinIcons'

export function PinPalette() {
  const rowRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ startX: number; startScroll: number; moved: boolean } | null>(null)

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = rowRef.current
    if (!el) return
    dragRef.current = { startX: e.clientX, startScroll: el.scrollLeft, moved: false }
    el.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = rowRef.current
    const drag = dragRef.current
    if (!el || !drag) return
    const dx = e.clientX - drag.startX
    if (Math.abs(dx) > 4) drag.moved = true
    el.scrollLeft = drag.startScroll - dx
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    rowRef.current?.releasePointerCapture(e.pointerId)
  }
  // Capture phase, so a drag that ends on a preset button never also fires
  // that button's own drag-start-adjacent click.
  const onClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (dragRef.current?.moved) {
      e.preventDefault()
      e.stopPropagation()
    }
    dragRef.current = null
  }

  return (
    <div
      ref={rowRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onClickCapture={onClickCapture}
      title="Drag any of these onto a room on the map to pin it there"
      className="flex w-full min-w-0 cursor-grab gap-1 overflow-x-auto active:cursor-grabbing [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {PIN_PRESETS.map((preset, i) => {
        const Icon = PIN_ICON_COMPONENT[preset.icon]
        return (
          <button
            key={`${preset.label}-${i}`}
            type="button"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(
                PIN_DRAG_TYPE,
                JSON.stringify({ label: preset.label, icon: preset.icon, color: preset.color })
              )
              e.dataTransfer.effectAllowed = 'copy'
            }}
            title={`${preset.label} (drag onto a room on the map)`}
            aria-label={preset.label}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border hover:border-accent/60"
          >
            <Icon className="h-3.5 w-3.5" style={{ color: PIN_COLOR_HEX[preset.color] }} />
          </button>
        )
      })}
    </div>
  )
}
