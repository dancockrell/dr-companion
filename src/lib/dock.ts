/**
 * Regions, boundaries, and folding.
 *
 * The previous model gave every panel its own width and let each one measure
 * itself and re-decide independently. That is what made it feel sticky: six
 * observers all reacting to a resize, each changing a layout the others were
 * measuring, so nothing settled and everything jittered.
 *
 * Here space is divided rather than negotiated. A region owns a rectangle and
 * a deck of panels, boundaries are shared so moving one takes from the
 * neighbour and gives to the other, and a region that can no longer hold its
 * contents **folds**: its panels join a neighbour's deck as tabs rather than
 * being squeezed into unreadability.
 *
 * Folding is the part that matters. Squeezing degrades every panel at once and
 * silently; folding degrades exactly one thing, visibly, and it is reversible
 * the moment the space comes back.
 */
import type { PanelId } from './layout'

export type Axis = 'row' | 'column'

export interface Region {
  id: string
  /** Share of the parent along the axis, 0..1. Boundaries move these. */
  size: number
  /** Panels docked here. More than one means a deck, shown as tabs. */
  panels: PanelId[]
  /** Which tab is on top. */
  active: PanelId
}

export interface Dock {
  axis: Axis
  regions: Region[]
}

/** Below this a region cannot show a panel usefully, so it folds instead. */
export const MIN_REGION = 220

/** Pixel size of each region along the axis, given the space available. */
export function measure(dock: Dock, extent: number): number[] {
  const total = dock.regions.reduce((n, r) => n + r.size, 0) || 1
  return dock.regions.map((r) => (r.size / total) * extent)
}

/**
 * Fold until every region can hold a panel, and no further.
 *
 * How many regions the space can carry is arithmetic, so it is computed rather
 * than discovered by folding one at a time and re-measuring. Greedy folding
 * over-collapses: three panels in 500px would fold once, leave a 333/166
 * split, see the 166 and fold again, ending with one deck where two of 250
 * would both have been fine.
 *
 * Sizes are levelled afterwards. A fold that left the merged region with the
 * sum of two shares would make the deck twice the width of its neighbour for
 * no reason anyone chose.
 */
export function foldCramped(dock: Dock, extent: number): Dock {
  const capacity = Math.max(1, Math.floor(extent / MIN_REGION))
  if (dock.regions.length <= capacity) return dock

  const regions = dock.regions.map((r) => ({ ...r, panels: [...r.panels] }))

  // Fold from the end, so the leftmost region keeps its identity. In a
  // left-to-right layout that is the one the player thinks of as primary.
  while (regions.length > capacity) {
    const last = regions.pop() as Region
    const into = regions[regions.length - 1]
    into.panels.push(...last.panels)
  }

  const even = 1 / regions.length
  return { ...dock, regions: regions.map((r) => ({ ...r, size: even })) }
}

/**
 * Split a deck back out when there is room for it again.
 *
 * The inverse of folding, and deliberately conservative: a region only gives a
 * panel back once both halves would clear the minimum, so widening the window
 * by a pixel does not start a fold-unfold oscillation.
 */
export function unfoldIfRoom(dock: Dock, extent: number): Dock {
  const sizes = measure(dock, extent)
  const i = sizes.findIndex((s, j) => dock.regions[j].panels.length > 1 && s >= MIN_REGION * 2)
  if (i < 0) return dock

  const region = dock.regions[i]
  const [moved, ...rest] = region.panels.slice().reverse()
  const keep = rest.reverse()

  const half = region.size / 2
  const regions = [...dock.regions]
  regions.splice(
    i,
    1,
    { ...region, panels: keep, active: keep.includes(region.active) ? region.active : keep[0], size: half },
    { id: `${region.id}:${moved}`, panels: [moved], active: moved, size: half }
  )

  return { ...dock, regions }
}

/**
 * Move the boundary between region i and i+1.
 *
 * Shared, so one side gains exactly what the other loses and the total is
 * unchanged. Clamped so neither side is dragged below the point where it would
 * fold, because a boundary drag should resize things rather than trigger a
 * collapse the player did not ask for.
 */
export function moveBoundary(
  dock: Dock,
  index: number,
  deltaPx: number,
  extent: number
): Dock {
  if (index < 0 || index >= dock.regions.length - 1) return dock

  const sizes = measure(dock, extent)
  const a = sizes[index]
  const b = sizes[index + 1]

  const floor = MIN_REGION
  const delta = Math.max(floor - a, Math.min(deltaPx, b - floor))
  if (!Number.isFinite(delta) || delta === 0) return dock

  const total = dock.regions.reduce((n, r) => n + r.size, 0) || 1
  const perPx = total / extent

  const regions = dock.regions.map((r, j) =>
    j === index
      ? { ...r, size: r.size + delta * perPx }
      : j === index + 1
        ? { ...r, size: r.size - delta * perPx }
        : r
  )

  return { ...dock, regions }
}

/**
 * One region holding everything, as tabs.
 *
 * Giving every panel its own region was the wrong default: a wide window then
 * split itself into columns nobody asked for, and the panels the player was
 * not looking at took space from the one they were. Columns are a thing you
 * make on purpose by dragging a tab out, not something the app decides
 * because there happened to be room.
 */
export function dockOf(panels: PanelId[], axis: Axis = 'row'): Dock {
  const kept = panels.filter(Boolean)
  return {
    axis,
    regions: kept.length
      ? [{ id: 'main', size: 1, panels: kept, active: kept[0] }]
      : [],
  }
}

/**
 * Drop panels from a dock, dissolving any region that empties.
 *
 * Needed because the dock is persisted. The map moved out of the stack and
 * into its own drawer, but a layout saved before that still lists it, so it
 * rendered in the drawer and as a tab at the same time. Filtering the panel
 * list only fixes a dock being built fresh; a stored one has to be cleaned.
 */
export function without(dock: Dock, drop: PanelId[]): Dock {
  const gone = new Set(drop)
  const regions = dock.regions
    .map((r) => {
      const panels = r.panels.filter((p) => !gone.has(p))
      return { ...r, panels, active: panels.includes(r.active) ? r.active : panels[0] }
    })
    .filter((r) => r.panels.length > 0)

  if (!regions.length) return dock
  const even = 1 / regions.length
  return { ...dock, regions: regions.map((r) => ({ ...r, size: even })) }
}

/**
 * One region per panel.
 *
 * Not the default — that produced columns nobody asked for — but the thing a
 * player gets by pulling tabs apart, and the fixture the folding tests need.
 */
export function splitEach(panels: PanelId[], axis: Axis = 'row'): Dock {
  const even = panels.length ? 1 / panels.length : 1
  return {
    axis,
    regions: panels.map((p) => ({ id: String(p), size: even, panels: [p], active: p })),
  }
}
