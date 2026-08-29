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
import { useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
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
  onSave: (label: string, color: PinColor, icon: PinIcon | undefined) => void
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

  const save = () => {
    if (!label.trim()) return
    onSave(label.trim(), color, icon)
  }

  /**
   * Drag-to-scroll for the icon row - see the row's own comment for why this
   * exists instead of relying on overflow-x-auto's native wheel scrolling.
   * `moved` is the only thing that decides drag-vs-click: a real click never
   * moves the pointer more than a pixel or two, so 4px is a click, not a
   * threshold that needs tuning per input device.
   */
  const iconRowRef = useRef<HTMLDivElement | null>(null)
  const iconDragRef = useRef<{ startX: number; startScroll: number; moved: boolean } | null>(null)

  const onIconPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = iconRowRef.current
    if (!el) return
    iconDragRef.current = { startX: e.clientX, startScroll: el.scrollLeft, moved: false }
    el.setPointerCapture(e.pointerId)
  }
  const onIconPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = iconRowRef.current
    const drag = iconDragRef.current
    if (!el || !drag) return
    const dx = e.clientX - drag.startX
    if (Math.abs(dx) > 4) drag.moved = true
    el.scrollLeft = drag.startScroll - dx
  }
  const onIconPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    iconRowRef.current?.releasePointerCapture(e.pointerId)
  }
  // Capture phase, so this runs before the icon button's own onClick - a
  // drag that ended on top of a button must not also select that icon.
  const onIconClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (iconDragRef.current?.moved) {
      e.preventDefault()
      e.stopPropagation()
    }
    iconDragRef.current = null
  }

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

        <p className="mt-3 text-xs text-ink-faint">Icon</p>
        <div className="mt-1 flex items-center gap-1.5">
          {/* No icon at all is a real, first-class choice - a plain dot on
              the chart for a place that doesn't fit any of these. Kept
              outside the scrolling row so it is never the thing a drag
              scrolls past. */}
          <button
            type="button"
            title="No icon" aria-label="No icon"
            aria-pressed={icon === undefined}
            onClick={() => setIcon(undefined)}
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded border ${
              icon === undefined ? 'border-accent text-accent' : 'border-border text-ink-faint'
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
          </button>

          {/* Fifty icons do not fit in a row at any reasonable width, and
            * wrapping them into a grid was the alternative - rejected because
            * a grid this tall would push the colour swatches and the label
            * field below the fold of a centered modal. A single scrolling
            * row keeps the dialog's height fixed regardless of how many
            * icons this list ever grows to.
            *
            * Real pointer-driven drag-to-scroll, not just the native
            * wheel/trackpad scroll overflow-x-auto gives for free - Dan's
            * ask was specifically "scrollable by grab and drag with mouse."
            * A click and a drag start identically (pointerdown on a button),
            * so onClickCapture below swallows the click that would otherwise
            * fire at the end of a drag - a `moved` flag, not a time or
            * distance guess, decides which one happened. */}
          <div
            ref={iconRowRef}
            onPointerDown={onIconPointerDown}
            onPointerMove={onIconPointerMove}
            onPointerUp={onIconPointerUp}
            onPointerLeave={onIconPointerUp}
            onClickCapture={onIconClickCapture}
            className="flex min-w-0 flex-1 cursor-grab gap-1.5 overflow-x-auto active:cursor-grabbing [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {PIN_ICONS.map((key) => {
              const Icon = PIN_ICON_COMPONENT[key]
              return (
                <button
                  key={key}
                  type="button"
                  title={key}
                  aria-label={`Icon: ${key}`}
                  aria-pressed={icon === key}
                  onClick={() => setIcon(key)}
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded border ${
                    icon === key ? 'border-accent text-accent' : 'border-border text-ink-faint'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </button>
              )
            })}
          </div>
        </div>

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
