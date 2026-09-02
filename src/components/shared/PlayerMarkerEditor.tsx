/**
 * Choosing the character's own mark on the map - a symbol from the same
 * fifty PIN_ICONS pins already use, and any colour at all rather than a
 * fixed palette. See playerMarker.ts's header for why this isn't just
 * another pin colour.
 *
 * Same scrollable, drag-to-scroll icon row as PinEditor's own picker - see
 * that file's header for why a single row beats wrapping fifty icons into
 * a grid, and why real pointer drag-to-scroll rather than relying on
 * native wheel/trackpad overflow.
 */
import { useRef, useState } from 'react'
import { PIN_ICONS } from '../../lib/mapPins'
import { PinIconGlyph } from './PinIconGlyph'
import type { PlayerMarker } from '../../lib/playerMarker'
import { useModalDialog } from '../../lib/useModalDialog'

export function PlayerMarkerEditor({
  marker,
  onSave,
  onClose,
}: {
  marker: PlayerMarker
  onSave: (marker: PlayerMarker) => void
  onClose: () => void
}) {
  const dialogRef = useModalDialog(onClose)
  const [icon, setIcon] = useState(marker.icon)
  const [color, setColor] = useState(marker.color)

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
  const onIconClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (iconDragRef.current?.moved) {
      e.preventDefault()
      e.stopPropagation()
    }
    iconDragRef.current = null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" data-gameplay-shortcuts="suspend" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-marker-title"
        tabIndex={-1}
        className="w-full max-w-xs rounded-lg border border-border bg-surface p-3 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="player-marker-title" className="text-sm font-semibold text-ink">Your mark on the map</h3>
        <p className="mt-0.5 text-xs text-ink-faint">
          Shown wherever you are standing, larger than any pin.
        </p>

        <div className="mt-3 flex items-center justify-center">
          <span
            className="flex h-14 w-14 items-center justify-center rounded-full border-2"
            style={{ background: color, borderColor: 'var(--map-ground)' }}
          >
            <PinIconGlyph icon={icon} className="h-7 w-7 object-contain" />
          </span>
        </div>

        <p className="mt-3 text-xs text-ink-faint">Symbol</p>
        <div
          ref={iconRowRef}
          onPointerDown={onIconPointerDown}
          onPointerMove={onIconPointerMove}
          onPointerUp={onIconPointerUp}
          onPointerLeave={onIconPointerUp}
          onClickCapture={onIconClickCapture}
          className="mt-1 flex cursor-grab gap-1.5 overflow-x-auto active:cursor-grabbing [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {PIN_ICONS.map((key) => {
            return (
              <button
                key={key}
                type="button"
                title={key}
                aria-label={`Symbol: ${key}`}
                aria-pressed={icon === key}
                onClick={() => setIcon(key)}
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded border ${
                  icon === key ? 'border-accent text-accent' : 'border-border text-ink-faint'
                }`}
              >
                <PinIconGlyph icon={key} className="h-4 w-4 object-contain" />
              </button>
            )
          })}
        </div>

        <label className="mt-3 block text-xs text-ink-faint">
          Colour
          <div className="mt-1 flex items-center gap-1.5">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-7 w-9 shrink-0 rounded border border-border bg-surface"
            />
            <input
              type="text"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-full rounded border border-border bg-surface-overlay px-2 py-1 font-mono text-sm text-ink"
            />
          </div>
        </label>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-2 py-1 text-xs text-ink-muted hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave({ icon, color })}
            disabled={!/^#[0-9A-Fa-f]{6}$/.test(color)}
            className="rounded bg-accent px-2 py-1 text-xs font-semibold text-surface disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
