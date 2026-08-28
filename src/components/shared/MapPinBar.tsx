/**
 * Hotbuttons for saved places: click one and go there, the same as clicking
 * the room itself on the chart. This is the part of the feature that never
 * needs the map on screen at all - Home is one click whether the map is
 * showing The Crossing or a gate three zones away, because map_walk works
 * off the room id a pin carries, not whatever zone happens to be drawn.
 *
 * Shared between the docked panel and the popped-out window for the same
 * reason MapCanvas is: two places that must never grow two different sets of
 * buttons for the same saved places.
 */
import { MapPin as MapPinIcon, Pencil, Plus } from 'lucide-react'
import { PIN_COLOR_HEX, type MapPin } from '../../lib/mapPins'
import { PIN_ICON_COMPONENT } from '../../lib/pinIcons'

export function MapPinBar({
  pins,
  onGo,
  onEdit,
  onAddHere,
  disabled,
}: {
  pins: MapPin[]
  onGo: (pin: MapPin) => void
  onEdit: (pin: MapPin) => void
  /** Pin whichever room the character is standing in right now. Omitted when that isn't known (not connected, or Lich hasn't said where "here" is yet). */
  onAddHere?: () => void
  /** True while a walk is already in flight - a second click would just queue behind go2's own refusal, so the buttons say so instead of pretending to be idle. */
  disabled?: boolean
}) {
  if (pins.length === 0 && !onAddHere) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {pins.map((pin) => {
        const Icon = pin.icon ? PIN_ICON_COMPONENT[pin.icon] : null
        return (
        <div
          key={pin.id}
          className="group flex items-center overflow-hidden rounded-full border border-border"
          style={{ borderLeftColor: PIN_COLOR_HEX[pin.color], borderLeftWidth: 3 }}
        >
          <button
            type="button"
            disabled={disabled}
            title={`Walk to ${pin.label} (room ${pin.roomId})`}
            onClick={() => onGo(pin)}
            className="flex items-center gap-1 px-2 py-0.5 text-xs text-ink-muted hover:text-ink disabled:opacity-40"
          >
            {Icon && <Icon className="h-3 w-3" style={{ color: PIN_COLOR_HEX[pin.color] }} />}
            {pin.label}
          </button>
          <button
            type="button"
            title="Edit this pin"
            onClick={() => onEdit(pin)}
            className="px-1 py-0.5 text-ink-faint opacity-0 hover:text-ink group-hover:opacity-100"
          >
            <Pencil className="h-3 w-3" />
          </button>
        </div>
        )
      })}
      {onAddHere && (
        <button
          type="button"
          title="Pin the room you are standing in"
          onClick={onAddHere}
          className="flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-ink-faint hover:border-accent/60 hover:text-accent"
        >
          <Plus className="h-3 w-3" />
          <MapPinIcon className="h-3 w-3" />
          Pin here
        </button>
      )}
    </div>
  )
}
