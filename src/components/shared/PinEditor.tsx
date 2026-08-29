/**
 * Naming, colouring and icon-ing a pin.
 *
 * A centered modal rather than a popover anchored to the room that was
 * clicked, on purpose: the docked panel and the popped-out window size and
 * lay out the map completely differently (a 300px column versus a whole
 * window), and an anchored popover would need its own positioning math in
 * each. A modal needs none - it is the same component either place, which is
 * the same reason MapCanvas itself is shared rather than drawn twice.
 */
import { useMemo, useState } from 'react'
import { Trash2, Search } from 'lucide-react'
import {
  PIN_COLORS,
  PIN_COLOR_HEX,
  PIN_ICONS,
  PIN_PRESETS,
  type PinColor,
  type PinIcon,
  type MapPin,
} from '../../lib/mapPins'
import { PIN_ICON_COMPONENT } from '../../lib/pinIcons'

export function PinEditor({
  roomId,
  roomTitle,
  existing,
  onSave,
  onDelete,
  onClose,
  onCreateTask,
}: {
  roomId: number
  roomTitle: string
  /** Editing an existing pin rather than creating one on this room. */
  existing?: MapPin
  onSave: (label: string, color: PinColor, icon: PinIcon | undefined, note: string | undefined) => void
  onDelete?: () => void
  onClose: () => void
  /**
   * Write a real python/tasks/user/walk_to_<pin>.py for this pin. Only
   * offered once a pin actually exists (not while creating one) - a task
   * generated for a pin the player then cancels out of saving would be a
   * file on disk with nothing behind it.
   */
  onCreateTask?: (pin: MapPin) => void
}) {
  const [label, setLabel] = useState(existing?.label ?? roomTitle)
  const [color, setColor] = useState<PinColor>(existing?.color ?? 'blue')
  const [icon, setIcon] = useState<PinIcon | undefined>(existing?.icon)
  const [note, setNote] = useState(existing?.note ?? '')

  const save = () => {
    if (!label.trim()) return
    onSave(label.trim(), color, icon, note.trim() || undefined)
  }

  /**
   * Filtering 372 icons by name - a single scrolling row was the right call
   * at 50 (see git history), and stopped being one well before 372: even
   * grab-and-drag scrolling means dragging past three hundred icons to find
   * one. Dan's own follow-up - "make the picker bigger so that we have more
   * room to work in there" - is what makes the fix a wider dialog and a
   * wrapping grid rather than a longer version of the same strip: a grid
   * that wraps scrolls vertically, which is what a mouse wheel and a
   * trackpad already do for free, so the custom drag-to-scroll this file
   * used to carry is gone with it - there is nothing left for it to do.
   */
  const [iconFilter, setIconFilter] = useState('')
  const filteredIcons = useMemo(() => {
    const q = iconFilter.trim().toLowerCase()
    if (!q) return PIN_ICONS
    return PIN_ICONS.filter((k) => k.includes(q))
  }, [iconFilter])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg border border-border bg-surface p-3 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-ink">
          {existing ? 'Edit pin' : 'Pin this room'}
        </h3>
        <p className="mt-0.5 text-xs text-ink-faint truncate">
          Room {roomId}
          {roomTitle ? ` — ${roomTitle}` : ''}
        </p>

        {/* Only offered for a brand-new pin. Overwriting an already-named,
            already-coloured pin's label with "Home" because someone brushed
            past the chip would be a worse mistake than not offering it. */}
        {!existing && (
          <div className="mt-2 flex flex-wrap gap-1">
            {PIN_PRESETS.map((preset) => {
              const Icon = PIN_ICON_COMPONENT[preset.icon]
              return (
                <button
                  key={preset.label}
                  type="button"
                  title={preset.label}
                  aria-label={preset.label}
                  onClick={() => {
                    setLabel(preset.label)
                    setColor(preset.color)
                    setIcon(preset.icon)
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-ink-muted hover:border-accent/60 hover:text-accent"
                >
                  <Icon className="h-3.5 w-3.5" style={{ color: PIN_COLOR_HEX[preset.color] }} />
                </button>
              )
            })}
          </div>
        )}

        <label className="mt-3 block text-xs text-ink-faint">
          Label
          <input
            type="text"
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
              if (e.key === 'Escape') onClose()
            }}
            className="mt-1 w-full rounded border border-border bg-surface-overlay px-2 py-1 text-sm text-ink"
            placeholder="Home, Bank, Favorite hunting spot…"
          />
        </label>

        <p className="mt-3 text-xs text-ink-faint">Colour</p>
        <div className="mt-1 flex items-center gap-1.5">
          {PIN_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              title={c}
              aria-label={`Colour: ${c}`}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              className={`h-6 w-6 shrink-0 rounded-full border-2 ${
                color === c ? 'border-ink' : 'border-transparent'
              }`}
              style={{ background: PIN_COLOR_HEX[c] }}
            />
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="text-xs text-ink-faint">
            Icon
            <span className="ml-1 text-ink-faint/70">
              ({filteredIcons.length} of {PIN_ICONS.length})
            </span>
          </p>
          <div className="relative">
            <Search className="pointer-events-none absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-faint" />
            <input
              type="text"
              value={iconFilter}
              onChange={(e) => setIconFilter(e.target.value)}
              placeholder="Filter icons…"
              className="w-36 rounded border border-border bg-surface-overlay py-1 pl-6 pr-2 text-xs text-ink placeholder:text-ink-faint"
            />
          </div>
        </div>
        {/* The grid is the part that grows and scrolls - everything else in
          * this dialog (label, colour, story, the buttons) stays put. A
          * bigger dialog was the actual ask ("make the picker bigger so
          * that we have more room to work in there"), so the grid gets
          * most of that new room rather than the whole card just growing
          * around a picker that stayed the same size. */}
        <div className="mt-1 min-h-0 flex-1 overflow-y-auto rounded border border-border bg-surface-overlay/40 p-1.5">
          <div className="flex flex-wrap gap-1.5">
            {/* No icon at all is a real, first-class choice - a plain dot on
                the chart for a place that doesn't fit any of these. Excluded
                from the filter so it's always reachable regardless of what's
                typed. */}
            <button
              type="button"
              title="No icon" aria-label="No icon"
              aria-pressed={icon === undefined}
              onClick={() => setIcon(undefined)}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded border ${
                icon === undefined ? 'border-accent text-accent' : 'border-border text-ink-faint'
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
            </button>
            {filteredIcons.map((key) => {
              const Icon = PIN_ICON_COMPONENT[key]
              return (
                <button
                  key={key}
                  type="button"
                  title={key}
                  aria-label={`Icon: ${key}`}
                  aria-pressed={icon === key}
                  onClick={() => setIcon(key)}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded border ${
                    icon === key ? 'border-accent text-accent' : 'border-border text-ink-faint'
                  }`}
                >
                  <Icon className="h-4.5 w-4.5" />
                </button>
              )
            })}
            {filteredIcons.length === 0 && (
              <p className="p-2 text-xs text-ink-faint">No icon matches “{iconFilter}”.</p>
            )}
          </div>
        </div>

        {/* "Pins tell stories" - a label is a name; this is why the name was
            worth giving. Free text, optional, shown in the room's tooltip
            under the label - never as chrome on the chart itself. */}
        <label className="mt-3 block text-xs text-ink-faint">
          Story (optional)
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="mt-1 w-full resize-none rounded border border-border bg-surface-overlay px-2 py-1 text-sm text-ink placeholder:text-ink-faint"
            placeholder="What happened here? Why does this place matter?"
          />
        </label>

        {existing && onCreateTask && (
          <button
            type="button"
            onClick={() => onCreateTask(existing)}
            className="mt-3 flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-ink-muted hover:border-accent/60 hover:text-accent"
          >
            Create a Python task for this pin
          </button>
        )}

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
              onClick={save}
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
