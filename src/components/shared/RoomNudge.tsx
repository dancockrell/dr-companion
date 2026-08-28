/**
 * "You've stood here N times - pin it?"
 *
 * A single dismissible line, not a modal or a toast that steals focus - the
 * player is standing in the room anyway, and the answer is usually either
 * "sure, one click" or "no, and don't ask about this room again," both of
 * which fit in one line beside the map.
 */
import { X, MapPin as MapPinIcon } from 'lucide-react'

export function RoomNudge({
  visits,
  onPin,
  onDismiss,
}: {
  visits: number
  onPin: () => void
  onDismiss: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded border border-accent/30 bg-accent/5 px-2 py-1 text-xs">
      <span className="text-ink-muted">
        You&apos;ve stood here {visits} times — worth pinning?
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onPin}
          className="flex items-center gap-1 rounded border border-accent/40 px-1.5 py-0.5 text-accent hover:bg-accent/10"
        >
          <MapPinIcon className="h-3 w-3" />
          Pin it
        </button>
        <button
          type="button"
          title="Don't ask about this room again"
          onClick={onDismiss}
          className="p-0.5 text-ink-faint hover:text-ink"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}
