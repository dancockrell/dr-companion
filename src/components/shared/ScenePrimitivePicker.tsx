/**
 * What is standing in the cell, and where.
 *
 * Lane K's K6 wanted a picker and could not have one: the asset registry admits
 * no item meshes, so a grid offering a rock in place of a sword is the
 * substitution `admission.forbiddenSubstitutions` forbids. This is that control
 * built for the class of content the registry *can* draw - scenery, two kinds
 * on 6 Sep 2026 - and the list is compiled from
 * `godot/scripts/shared_asset_content.gd` rather than typed, so the day a
 * content pack registers an item mesh it appears here by itself.
 *
 * There are no placeholder rows for kinds that do not exist. A greyed-out
 * "sword (coming soon)" would be the same lie as an undrawable dropdown entry:
 * the player would read the absence as the editor being broken rather than as
 * the content not being there.
 *
 * # Position
 *
 * A top-down square of the cell's own 4.4 m footprint, with the eight compass
 * edges drawn, because "north-west corner" is how a person thinks about where a
 * thing is in a room and `(-1.6, -1.6)` is not. Typing the numbers is offered
 * too, for the placement that has to be exact.
 *
 * Every path through this file clamps with `clampToCell`, the same function
 * `isDrawable` validates against, so a click inside the drawn square can never
 * produce a value the store refuses.
 */
import { useState } from 'react'
import {
  PLACEMENT_HALF_EXTENT,
  clampToCell,
  type PlacedPrimitive,
  type SceneFieldSource,
} from '../../lib/sceneOverrides.ts'

/** The eight compass edges, at their fraction along each side of the square. */
const EDGES: Array<{ dir: string; style: string }> = [
  { dir: 'NW', style: 'left-0 top-0' },
  { dir: 'N', style: 'left-1/2 top-0 -translate-x-1/2' },
  { dir: 'NE', style: 'right-0 top-0' },
  { dir: 'W', style: 'left-0 top-1/2 -translate-y-1/2' },
  { dir: 'E', style: 'right-0 top-1/2 -translate-y-1/2' },
  { dir: 'SW', style: 'bottom-0 left-0' },
  { dir: 'S', style: 'bottom-0 left-1/2 -translate-x-1/2' },
  { dir: 'SE', style: 'bottom-0 right-0' },
]

/** Metres to a percentage across the square. -2.2 is 0%, +2.2 is 100%. */
function percentOf(metres: number): number {
  return ((clampToCell(metres) + PLACEMENT_HALF_EXTENT) / (PLACEMENT_HALF_EXTENT * 2)) * 100
}

export function ScenePrimitivePicker({
  placeable,
  placed,
  source,
  onChange,
  onReset,
}: {
  placeable: string[]
  placed: PlacedPrimitive[]
  source: SceneFieldSource
  onChange: (next: PlacedPrimitive[]) => void
  onReset: () => void
}) {
  const [kind, setKind] = useState<string>(placeable[0] ?? '')
  const [selected, setSelected] = useState<number | null>(null)

  const place = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!kind) return
    const box = event.currentTarget.getBoundingClientRect()
    if (!box.width || !box.height) return
    const x = clampToCell(((event.clientX - box.left) / box.width) * 2 * PLACEMENT_HALF_EXTENT - PLACEMENT_HALF_EXTENT)
    const z = clampToCell(((event.clientY - box.top) / box.height) * 2 * PLACEMENT_HALF_EXTENT - PLACEMENT_HALF_EXTENT)
    // A click moves the selected one rather than adding a second copy of it.
    // Placing then nudging is the commonest thing a person does here, and an
    // editor that answered a correction with a duplicate would make that the
    // one action you cannot take.
    if (selected != null && placed[selected]) {
      const next = placed.slice()
      next[selected] = { ...next[selected], x: round(x), z: round(z) }
      onChange(next)
      return
    }
    onChange([...placed, { kind, x: round(x), z: round(z) }])
    setSelected(placed.length)
  }

  const move = (index: number, axis: 'x' | 'z', raw: string) => {
    const value = Number.parseFloat(raw)
    const next = placed.slice()
    next[index] = { ...next[index], [axis]: round(clampToCell(Number.isFinite(value) ? value : 0)) }
    onChange(next)
  }

  const remove = (index: number) => {
    onChange(placed.filter((_, i) => i !== index))
    setSelected(null)
  }

  if (placeable.length === 0) {
    return (
      <p className="text-xs text-ink-faint" data-testid="scene-primitives-empty">
        No content pack registers anything a person may place. Nothing is offered rather than a row
        that would draw as the placeholder box.
      </p>
    )
  }

  return (
    <div className="text-xs text-ink-faint" data-testid="scene-primitives">
      <span className="flex items-center justify-between gap-2">
        <span>
          Placed in this room ·{' '}
          {source === 'override' ? (
            <span className="text-accent">yours</span>
          ) : (
            <span className="text-ink-faint">nothing placed</span>
          )}
        </span>
        {source === 'override' && (
          <button
            type="button"
            onClick={onReset}
            data-testid="scene-primitives-reset"
            className="text-ink-muted underline hover:text-accent"
          >
            clear all
          </button>
        )}
      </span>

      <div className="mt-1 flex flex-wrap gap-1" data-testid="scene-placeable">
        {placeable.map((option) => (
          <button
            key={option}
            type="button"
            data-scene-placeable={option}
            aria-pressed={option === kind}
            onClick={() => setKind(option)}
            className={`rounded border px-2 py-1 ${
              option === kind ? 'border-accent text-accent' : 'border-border text-ink-muted'
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      <p className="mt-1">
        {selected == null
          ? `Click the square to put a ${kind} there.`
          : `Click to move the selected ${placed[selected]?.kind ?? 'item'}, or pick a kind above and deselect to add another.`}
      </p>

      <div
        role="presentation"
        data-testid="scene-footprint"
        onClick={place}
        className="relative mt-1 aspect-square w-full max-w-[13rem] cursor-crosshair rounded border border-border bg-surface-overlay"
      >
        {EDGES.map((edge) => (
          <span key={edge.dir} className={`pointer-events-none absolute px-1 text-xs leading-none text-ink-faint ${edge.style}`}>
            {edge.dir}
          </span>
        ))}
        {/* The centre, so "no offset" is a place on the square rather than an
            unmarked middle a person has to trust they found. */}
        <span className="pointer-events-none absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border" />
        {placed.map((item, index) => (
          <button
            key={`${item.kind}-${index}`}
            type="button"
            title={`${item.kind} at ${item.x}, ${item.z}`}
            data-scene-placed={item.kind}
            onClick={(event) => {
              event.stopPropagation()
              setSelected(index === selected ? null : index)
            }}
            style={{ left: `${percentOf(item.x)}%`, top: `${percentOf(item.z)}%` }}
            className={`absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border ${
              index === selected ? 'border-accent bg-accent/60' : 'border-ink-muted bg-ink-muted/40'
            }`}
          />
        ))}
      </div>

      <p className="mt-1">
        {(PLACEMENT_HALF_EXTENT * 2).toFixed(1)} m across, north at the top. Anything outside is
        pulled back to the edge.
      </p>

      {placed.length > 0 && (
        <ul className="mt-1 space-y-1" data-testid="scene-placed-list">
          {placed.map((item, index) => (
            <li key={`${item.kind}-row-${index}`} className="flex items-center gap-1">
              <span className="flex-1 truncate text-ink">{item.kind}</span>
              <label className="flex items-center gap-1">
                x
                <input
                  type="number"
                  step="0.1"
                  value={item.x}
                  data-scene-placed-x={index}
                  onChange={(e) => move(index, 'x', e.target.value)}
                  className="w-14 rounded border border-border bg-surface-overlay px-1 py-0.5 text-ink"
                />
              </label>
              <label className="flex items-center gap-1">
                z
                <input
                  type="number"
                  step="0.1"
                  value={item.z}
                  data-scene-placed-z={index}
                  onChange={(e) => move(index, 'z', e.target.value)}
                  className="w-14 rounded border border-border bg-surface-overlay px-1 py-0.5 text-ink"
                />
              </label>
              <button
                type="button"
                onClick={() => remove(index)}
                data-scene-remove={index}
                className="text-ink-muted underline hover:text-danger"
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** One decimal place, which is a centimetre at this scale. Kept off the stored
 * value's tail so an export is a file a person can read and diff, rather than
 * one carrying `-1.5999999999999999` from a click. */
function round(value: number): number {
  return Math.round(value * 10) / 10
}
