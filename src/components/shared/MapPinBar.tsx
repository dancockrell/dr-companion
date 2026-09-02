/**
 * Saved places: one button, not one button per place.
 *
 * This used to draw a separate pill for every pin - fine at three or four,
 * and exactly the "many editors, you need 1 for all of them" complaint the
 * moment a player actually uses the feature: 50 preset types and no cap on
 * how many pins a room can carry means this row was always going to grow
 * without bound. A single button opening a list scales the same at 3 pins
 * and at 300; a row of pills does not.
 *
 * Shared between the docked panel and the popped-out window for the same
 * reason MapCanvas is: two places that must never grow two different sets of
 * buttons for the same saved places.
 */
import { useEffect, useRef, useState } from 'react'
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
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  // Closes on a click anywhere else, and on Escape - a dropdown that only
  // closes by picking something or hunting for the toggle button again is
  // one people stop opening.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.ctrlKey && e.shiftKey)) {
        e.preventDefault()
        e.stopImmediatePropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (pins.length === 0 && !onAddHere) return null
  const savedPinCountLabel = `${pins.length} saved ${pins.length === 1 ? 'pin' : 'pins'}`

  // A fragment, not a rail of its own: MapPanel makes saved pins and pin-here
  // peers of every other fixed-square control in its shared two-row grid.
  return (
    <>
      {pins.length > 0 && (
        <div className="relative h-8 w-8 shrink-0" ref={boxRef} data-gameplay-shortcuts={open ? 'suspend' : undefined}>
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setOpen((o) => !o)}
            title={`${savedPinCountLabel} - click to browse`}
            aria-label={savedPinCountLabel}
            aria-expanded={open}
            aria-controls="saved-pins-list"
            className={`relative grid h-8 w-8 place-items-center rounded border bg-surface-raised ${
              open ? 'border-accent text-accent' : 'border-border text-ink-muted hover:text-ink'
            }`}
          >
            <MapPinIcon className="h-4 w-4" />
            <span className="absolute -right-1.5 -top-1.5 min-w-4 rounded-full bg-accent px-0.5 text-center text-xs font-bold leading-4 text-surface" aria-hidden>{pins.length}</span>
          </button>
          {open && (
            <div
              id="saved-pins-list"
              aria-label="Saved pins"
              className="absolute left-0 top-full z-20 mt-1 max-h-64 w-56 overflow-y-auto rounded border border-border bg-surface-raised shadow-lg"
            >
              {pins.map((pin) => {
                const Icon = pin.icon ? PIN_ICON_COMPONENT[pin.icon] : MapPinIcon
                return (
                  <div
                    key={pin.id}
                    className="group flex items-center gap-1.5 border-b border-border/50 px-2 py-1 last:border-b-0 hover:bg-surface-overlay focus-within:bg-surface-overlay"
                  >
                    <Icon className="h-3 w-3 shrink-0" style={{ color: PIN_COLOR_HEX[pin.color] }} />
                    <button
                      type="button"
                      disabled={disabled}
                      title={`Walk to ${pin.label} (room ${pin.roomId})`}
                      onClick={() => {
                        onGo(pin)
                        setOpen(false)
                      }}
                      className="min-w-0 flex-1 truncate text-left text-xs text-ink-muted hover:text-ink disabled:opacity-40"
                    >
                      {pin.label}
                    </button>
                    <button
                      type="button"
                      title="Edit this pin"
                      aria-label={`Edit ${pin.label}`}
                      onClick={() => {
                        onEdit(pin)
                        setOpen(false)
                      }}
                      className="shrink-0 rounded p-0.5 text-ink-faint outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
      {onAddHere && (
        <button
          type="button"
          title="Pin the room you are standing in"
          aria-label="Pin the room you are standing in"
          onClick={onAddHere}
          className="relative grid h-8 w-8 shrink-0 place-items-center rounded border border-dashed border-border bg-surface-raised text-ink-faint hover:border-accent/60 hover:text-accent"
        >
          <MapPinIcon className="h-4 w-4" />
          <Plus className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full bg-surface" strokeWidth={3} />
        </button>
      )}
    </>
  )
}
