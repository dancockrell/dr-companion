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

const PRESETS: { tag: string; label: string; icon: LucideIcon }[] = [
  { tag: 'bank', label: 'Bank', icon: Landmark },
  { tag: 'healer', label: 'Healer', icon: HeartPulse },
  { tag: 'guild', label: 'Guild', icon: Shield },
  { tag: 'shop', label: 'Shop', icon: ShoppingBag },
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
      <span className="text-xs text-ink-faint">Nearest:</span>
      {PRESETS.map(({ tag, label, icon: Icon }) => (
        <button
          key={tag}
          type="button"
          onClick={() => ask(tag)}
          className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
            activeTag === tag
              ? 'border-accent text-accent'
              : 'border-border text-ink-muted hover:text-ink'
          }`}
        >
          <Icon className="h-3 w-3" />
          {label}
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
