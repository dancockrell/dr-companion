import type { PlayerMarker } from '../../lib/playerMarker'
import type { MapPin } from '../../lib/mapPins'
import { PIN_ICON_COMPONENT } from '../../lib/pinIcons'
import { useDragScroll } from '../../lib/useDragScroll'
import { MapPinBar } from './MapPinBar'
import { QuickTravel } from './QuickTravel'
import { PinPalette, type PinBrush } from './PinPalette'

/**
 * The one map-tool rail used by both the docked map and the map window.
 * Keeping the marker, saved/current pins, nearest queries and symbol palette
 * here prevents either surface from quietly regrowing its own button sizes,
 * ordering or scrolling behavior.
 */
export function MapToolRail({
  marker,
  onCustomizeMarker,
  pins,
  onGoPin,
  onEditPin,
  onAddHere,
  onWalk,
  onPinNearest,
  selected,
  onSelect,
}: {
  marker?: PlayerMarker
  onCustomizeMarker?: () => void
  pins: MapPin[]
  onGoPin: (pin: MapPin) => void
  onEditPin: (pin: MapPin) => void
  onAddHere?: () => void
  onWalk: (roomId: number) => void
  onPinNearest: (hit: { id: number; title: string }) => void
  selected?: PinBrush | null
  onSelect: (preset: PinBrush | null) => void
}) {
  const drag = useDragScroll()

  return (
    <div
      ref={drag.ref}
      className={`no-scrollbar relative grid min-w-0 shrink-0 auto-cols-max grid-flow-col grid-rows-2 gap-1 overflow-x-auto touch-none ${drag.dragging ? 'cursor-grabbing select-none' : 'cursor-grab'}`}
      aria-label="Map pins and places"
      title="Map tools — grab to scroll; click a symbol then a room, or drag a symbol directly onto a room"
      onPointerDown={drag.onPointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerUp}
      onPointerCancel={drag.onPointerCancel}
    >
      {marker && onCustomizeMarker && (
        <button
          type="button"
          onClick={onCustomizeMarker}
          title="Customize your mark on the map"
          aria-label="Customize your mark on the map"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-surface-raised hover:border-accent/60"
        >
          <span
            className="flex h-5 w-5 items-center justify-center rounded-full"
            style={{ background: marker.color }}
          >
            {(() => {
              const Icon = PIN_ICON_COMPONENT[marker.icon]
              return <Icon className="h-3 w-3" color="var(--map-ground)" strokeWidth={3} />
            })()}
          </span>
        </button>
      )}
      <MapPinBar
        pins={pins}
        onGo={onGoPin}
        onEdit={onEditPin}
        onAddHere={onAddHere}
      />
      <QuickTravel onWalk={onWalk} onPin={onPinNearest} />
      <PinPalette selected={selected} onSelect={onSelect} />
    </div>
  )
}
