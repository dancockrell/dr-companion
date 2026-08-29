/**
 * Nearest bank, nearest healer, nearest guild - computed on the spot rather
 * than saved. This is the other half of "a lot of buttons to just run to
 * common locations" from a saved pin: a pin is a fixed room you chose once,
 * this is "wherever the closest one happens to be from here right now,"
 * which moves with the character the way a pin never does.
 *
 * Always asks for up to three hits and shows whichever come back, rather
 * than having a separate "nearest 1" button and a separate "nearest 3"
 * button - "closest bank" and "closest 3 healers" turn out to be one
 * mechanism once the query itself always asks for a few and lets the player
 * pick from what's actually nearby.
 */
import { useState } from 'react'
import { Landmark, HeartPulse, Shield, ShoppingBag, MapPin as MapPinIcon, Compass, type LucideIcon } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { bridge } from '../../bridge'
import { PIN_DRAG_TYPE, type PinIcon, type PinColor } from '../../lib/mapPins'

const PRESETS: { tag: string; label: string; icon: LucideIcon; pinIcon: PinIcon; color: PinColor }[] = [
  { tag: 'bank', label: 'Bank', icon: Landmark, pinIcon: 'landmark', color: 'gold' },
  { tag: 'healer', label: 'Healer', icon: HeartPulse, pinIcon: 'heart-pulse', color: 'green' },
  { tag: 'guild', label: 'Guild', icon: Shield, pinIcon: 'shield', color: 'purple' },
  { tag: 'shop', label: 'Shop', icon: ShoppingBag, pinIcon: 'shopping-bag', color: 'blue' },
]

export function QuickTravel({
  onWalk,
  onPin,
}: {
  onWalk: (roomId: number) => void
  /**
   * Pin a nearest-search result directly, without walking there first.
   *
   * The nearest-bank/healer/guild/shop answer is exactly the pin a lot of
   * players would want and never get around to setting - finding it once
   * already did the work a pin exists to skip doing again. Optional: a
   * caller with nowhere to put a pin (no character yet) just doesn't offer
   * the button, same as MapPinBar's own onAddHere.
   */
  onPin?: (hit: { id: number; title: string }) => void
}) {
  const mapNearest = useAppStore((s) => s.mapNearest)
  const [activeTag, setActiveTag] = useState<string | null>(null)

  function ask(tag: string) {
    setActiveTag(tag)
    bridge.requestIntent('map_nearest', { tag, count: 3 })
  }

  // Only render an answer for the query that's actually in flight - a stale
  // mapNearest from a previous button press, still sitting in the store when
  // a new one is clicked, must not flash as this button's own result for the
  // instant before the fresh reply arrives.
  const answered = activeTag !== null && mapNearest?.tag === activeTag

  // A fragment, not its own wrapping div - see MapPinBar.tsx's matching
  // note. The caller puts this in a shared flex-wrap row with MapPinBar.
  return (
    <>
      <span className="flex items-center text-ink-faint" title="Nearest: find the closest bank, healer, guild or shop from here">
        <Compass className="h-3 w-3" />
      </span>
      {PRESETS.map(({ tag, label, icon: Icon, pinIcon, color }) => (
        <button
          key={tag}
          type="button"
          onClick={() => ask(tag)}
          // Click still asks "nearest" - dragging is the second, separate
          // gesture this same button now supports. The two never conflict:
          // a click never fires a dragstart, and a drag that ends off any
          // room just does nothing rather than also triggering a search.
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(
              PIN_DRAG_TYPE,
              JSON.stringify({ label, icon: pinIcon, color })
            )
            e.dataTransfer.effectAllowed = 'copy'
          }}
          title={`Nearest ${label} (drag onto a room on the map to pin it there directly)`}
          aria-label={`Nearest ${label}`}
          className={`flex items-center rounded-full border px-1.5 py-0.5 ${
            activeTag === tag
              ? 'border-accent text-accent'
              : 'border-border text-ink-muted hover:text-ink'
          }`}
        >
          <Icon className="h-3 w-3" />
        </button>
      ))}
      {answered &&
        (mapNearest.ok && mapNearest.rooms?.length ? (
          <div className="flex flex-wrap items-center gap-1">
            {mapNearest.rooms.map((r) => (
              <div
                key={r.id}
                className="flex items-center overflow-hidden rounded-full border border-accent/40 bg-accent/10 text-xs text-accent"
              >
                <button
                  type="button"
                  title={r.title ?? undefined}
                  onClick={() => {
                    if (r.id != null) onWalk(r.id)
                    setActiveTag(null)
                  }}
                  className="px-2 py-0.5"
                >
                  {r.title ?? `Room ${r.id}`} · {r.steps ?? '?'} rooms
                </button>
                {/* The point of asking "nearest bank" is usually to stop
                    having to ask again - this is that, one click sooner
                    than walk-there-then-right-click. */}
                {onPin && r.id != null && (
                  <button
                    type="button"
                    title={`Pin ${r.title ?? 'this room'}`}
                    aria-label={`Pin ${r.title ?? 'this room'}`}
                    onClick={() => onPin({ id: r.id as number, title: r.title ?? `Room ${r.id}` })}
                    className="border-l border-accent/30 px-1.5 py-0.5 text-accent hover:bg-accent/20"
                  >
                    <MapPinIcon className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <span className="text-xs text-ink-faint">{mapNearest.reason ?? 'none nearby'}</span>
        ))}
    </>
  )
}
