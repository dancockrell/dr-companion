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
import { Landmark, HeartPulse, Shield, ShoppingBag, MapPin as MapPinIcon, type LucideIcon } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { bridge } from '../../bridge'
import { PIN_DRAG_TYPE, PIN_COLOR_HEX, type PinIcon, type PinColor } from '../../lib/mapPins'

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

  // A fragment, not its own toolbar: these four fixed-square controls are
  // direct members of MapPanel's shared two-row pin grid. The answer floats
  // below that rail instead of becoming a wide grid cell and breaking it.
  return (
    <>
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
          className={`grid h-8 w-8 shrink-0 place-items-center rounded border bg-surface-raised ${
            activeTag === tag ? 'border-accent' : 'border-border hover:border-accent/60'
          }`}
        >
          {/* Tinted with the same colour this button pins with, at rest -
            * not only once active. Four icon-only buttons with no colour cue
            * read as "four copies of one button" at a glance (Dan: "these
            * seem to be two copies of basically the same thing"), because
            * the icon shape alone is too small to tell apart quickly. The
            * colour is also a preview of what the pin will look like on the
            * map once dropped, so it is not a cue invented just for this row. */}
          <Icon className="h-4 w-4" style={{ color: PIN_COLOR_HEX[color] }} />
        </button>
      ))}
      {answered &&
        (mapNearest.ok && mapNearest.rooms?.length ? (
          <div className="absolute left-0 top-full z-40 mt-1 flex max-w-full flex-wrap items-center gap-1 rounded border border-border bg-surface-raised p-1 shadow-lg">
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
          <span className="absolute left-0 top-full z-40 mt-1 rounded border border-border bg-surface-raised px-2 py-1 text-xs text-ink-faint shadow-lg">{mapNearest.reason ?? 'none nearby'}</span>
        ))}
    </>
  )
}
