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
import { Landmark, HeartPulse, Shield, ShoppingBag, type LucideIcon } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { bridge } from '../../bridge'

const PRESETS: { tag: string; label: string; icon: LucideIcon }[] = [
  { tag: 'bank', label: 'Bank', icon: Landmark },
  { tag: 'healer', label: 'Healer', icon: HeartPulse },
  { tag: 'guild', label: 'Guild', icon: Shield },
  { tag: 'shop', label: 'Shop', icon: ShoppingBag },
]

export function QuickTravel({ onWalk }: { onWalk: (roomId: number) => void }) {
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

  return (
    <div className="flex flex-wrap items-center gap-1.5">
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
              <button
                key={r.id}
                type="button"
                title={r.title ?? undefined}
                onClick={() => {
                  if (r.id != null) onWalk(r.id)
                  setActiveTag(null)
                }}
                className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-xs text-accent"
              >
                {r.title ?? `Room ${r.id}`} · {r.steps ?? '?'} rooms
              </button>
            ))}
          </div>
        ) : (
          <span className="text-xs text-ink-faint">{mapNearest.reason ?? 'none nearby'}</span>
        ))}
    </div>
  )
}
