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
 * Fifty icons do not fit at any reasonable width. The parent owns one
 * two-row drag-scroll surface for operational controls and this vocabulary;
 * returning a fragment here makes these buttons real members of that grid
 * instead of creating a second rail with different behavior.
 */
import { PIN_PRESETS, PIN_COLOR_HEX, PIN_DRAG_TYPE } from '../../lib/mapPins'
import { PinIconGlyph } from './PinIconGlyph'

export interface PinBrush {
  label: string
  icon: (typeof PIN_PRESETS)[number]['icon']
  color: (typeof PIN_PRESETS)[number]['color']
}

const GROUP_STARTS = new Set(['Healer', 'Shop', 'Smithy', 'Landmark', 'Hunting Spot', 'Hangout'])

export function PinPalette({ selected, onSelect }: { selected?: PinBrush | null; onSelect?: (preset: PinBrush | null) => void }) {
  return (
    <>
      {PIN_PRESETS.map((preset, i) => {
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
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded border bg-surface-raised hover:border-accent/60 ${startsGroup ? 'ml-1.5' : ''} ${selected?.label === preset.label ? 'border-accent bg-accent/20 ring-1 ring-accent' : 'border-border'}`}
          >
            <PinIconGlyph icon={preset.icon} className="h-4 w-4 object-contain" style={{ color: PIN_COLOR_HEX[preset.color] }} />
          </button>
        )
      })}
    </>
  )
}
