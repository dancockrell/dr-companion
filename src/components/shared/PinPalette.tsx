/**
 * The vocabulary end of the single map-tool rail. Operational controls
 * (saved, pin-here, nearest, player marker) sit immediately before this
 * component; these are the place meanings a player can apply to any room.
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

export interface PinBrush {
  label: string
  icon: (typeof PIN_PRESETS)[number]['icon']
  color: (typeof PIN_PRESETS)[number]['color']
}

const GROUP_STARTS = new Set(['Healer', 'Shop', 'Smithy', 'Landmark', 'Hunting Spot', 'Hangout'])

export function PinPalette({ selected, onSelect }: { selected?: PinBrush | null; onSelect?: (preset: PinBrush | null) => void }) {
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
      title="Place symbols — click one, then a room; or drag it onto a room"
      className="grid min-w-0 flex-1 auto-cols-max grid-flow-col grid-rows-2 gap-1 overflow-x-auto cursor-grab active:cursor-grabbing [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {PIN_PRESETS.map((preset, i) => {
        const Icon = PIN_ICON_COMPONENT[preset.icon]
        // Quiet dividers preserve the compact icon-only row while making
        // its vocabulary scannable: home/banking, services, shops,
        // gathering, places, danger, and social/logistics.
        const startsGroup = GROUP_STARTS.has(preset.label)
        return (
          <button
            key={`${preset.label}-${i}`}
            type="button"
            aria-pressed={selected?.label === preset.label}
            onClick={() => onSelect?.(selected?.label === preset.label ? null : preset)}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(
                PIN_DRAG_TYPE,
                JSON.stringify({ label: preset.label, icon: preset.icon, color: preset.color })
              )
              e.dataTransfer.effectAllowed = 'copy'
            }}
            title={`${preset.label} — click, then click a room; or drag directly onto a room`}
            aria-label={preset.label}
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border hover:border-accent/60 ${startsGroup ? 'ml-1.5' : ''} ${selected?.label === preset.label ? 'border-accent bg-accent/20 ring-1 ring-accent' : 'border-border'}`}
          >
            <Icon className="h-3.5 w-3.5" style={{ color: PIN_COLOR_HEX[preset.color] }} />
          </button>
        )
      })}
    </div>
  )
}
