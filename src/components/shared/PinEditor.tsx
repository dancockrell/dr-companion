/**
 * Naming and colouring a pin.
 *
 * A centered modal rather than a popover anchored to the room that was
 * clicked, on purpose: the docked panel and the popped-out window size and
 * lay out the map completely differently (a 300px column versus a whole
 * window), and an anchored popover would need its own positioning math in
 * each. A modal needs none - it is the same component either place, which is
 * the same reason MapCanvas itself is shared rather than drawn twice.
 */
import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { PIN_COLORS, PIN_COLOR_HEX, type PinColor, type MapPin } from '../../lib/mapPins'

export function PinEditor({
  roomId,
  roomTitle,
  existing,
  onSave,
  onDelete,
  onClose,
}: {
  roomId: number
  roomTitle: string
  /** Editing an existing pin rather than creating one on this room. */
  existing?: MapPin
  onSave: (label: string, color: PinColor) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const [label, setLabel] = useState(existing?.label ?? roomTitle)
  const [color, setColor] = useState<PinColor>(existing?.color ?? 'blue')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xs rounded-lg border border-border bg-surface p-3 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-ink">
          {existing ? 'Edit pin' : 'Pin this room'}
        </h3>
        <p className="mt-0.5 text-xs text-ink-faint truncate">
          Room {roomId}
          {roomTitle ? ` — ${roomTitle}` : ''}
        </p>

        <label className="mt-3 block text-xs text-ink-faint">
          Label
          <input
            type="text"
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && label.trim()) onSave(label.trim(), color)
              if (e.key === 'Escape') onClose()
            }}
            className="mt-1 w-full rounded border border-border bg-surface-overlay px-2 py-1 text-sm text-ink"
            placeholder="Home, Bank, Favorite hunting spot…"
          />
        </label>

        <div className="mt-3 flex items-center gap-1.5">
          {PIN_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              title={c}
              onClick={() => setColor(c)}
              className={`h-6 w-6 shrink-0 rounded-full border-2 ${
                color === c ? 'border-ink' : 'border-transparent'
              }`}
              style={{ background: PIN_COLOR_HEX[c] }}
            />
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          {existing && onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              className="flex items-center gap-1 rounded border border-danger/40 px-2 py-1 text-xs text-danger hover:bg-danger/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-border px-2 py-1 text-xs text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!label.trim()}
              onClick={() => onSave(label.trim(), color)}
              className="rounded bg-accent px-2 py-1 text-xs font-semibold text-surface disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
