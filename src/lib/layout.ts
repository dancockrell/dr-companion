/**
 * Where the panels are and how big, remembered per mode.
 *
 * Everyone plays differently. A crafter wants inventory open and the map
 * small; someone hunting wants the map big and watched, because they know
 * which rooms break a script. Rather than guess an order and defend it, the
 * panels move and resize, and the arrangement is theirs.
 *
 * Stored per UI mode, because Basic and Power are different arrangements of
 * the same panels, not the same arrangement at two sizes.
 */
import type { UiMode } from '../types'

export type PanelId =
  | 'map'
  | 'vitals'
  | 'actions'
  | 'training'
  | 'inventory'
  | 'risk'
  | 'launcher'

export interface PanelState {
  /** Collapsed to its title bar. */
  closed?: boolean
  /** Body height in pixels. Undefined means the panel sizes to its content. */
  height?: number
}

export interface Layout {
  order: PanelId[]
  panels: Partial<Record<PanelId, PanelState>>
  /**
   * The map gets its own plane rather than a slot in the panel stack.
   *
   * It is not a widget you consult, it is a surface you watch — players know
   * which rooms break scripts and keep it in view while doing something else.
   * A panel in a scrolling column cannot do that: it is always competing for
   * vertical space with whatever is above it, and it loses.
   *
   * So above `MAP_PLANE_AT` the map takes a column of its own and the panels
   * stack beside it. Below that width there is not room for two planes and it
   * falls back to being a panel, which is why it stays in `order`.
   */
  mapPlane: boolean
  /** Fraction of the width the map plane takes, 0.25 to 0.75. */
  mapSplit: number
}

/**
 * Defaults per mode.
 *
 * Both lead with the map, because orientation is the thing you look at first
 * and keep looking at. They differ in what comes next: Basic puts the thing you
 * came to press second, Power puts the numbers there.
 */
const DEFAULTS: Record<UiMode, Layout> = {
  basic: {
    order: ['vitals', 'map', 'actions', 'training', 'inventory', 'launcher', 'risk'],
    panels: { map: { height: 200 } },
    mapPlane: true,
    mapSplit: 0.5,
  },
  power: {
    order: ['vitals', 'actions', 'map', 'risk', 'training', 'inventory', 'launcher'],
    panels: { map: { height: 260 } },
    mapPlane: true,
    mapSplit: 0.55,
  },
}

/** Below this there is not room for two planes side by side. */
export const MAP_PLANE_AT = 680

const KEY = 'drc.layout.v1'

export function defaultLayout(mode: UiMode): Layout {
  const d = DEFAULTS[mode] ?? DEFAULTS.basic
  return {
    order: [...d.order],
    panels: { ...d.panels },
    mapPlane: d.mapPlane,
    mapSplit: d.mapSplit,
  }
}

/** Keeps either plane from being dragged down to nothing. */
export function clampSplit(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0.5
  return Math.min(0.75, Math.max(0.25, n))
}

export function loadLayout(mode: UiMode): Layout {
  try {
    const raw = localStorage.getItem(`${KEY}.${mode}`)
    if (!raw) return defaultLayout(mode)
    const parsed = JSON.parse(raw) as Layout

    // Merge against the defaults rather than trusting what was stored. A panel
    // added in a later version would otherwise never appear for anyone who had
    // already saved a layout, and a panel we removed would linger as a gap.
    const known = new Set(defaultLayout(mode).order)
    const kept = (parsed.order ?? []).filter((id) => known.has(id))
    const missing = defaultLayout(mode).order.filter((id) => !kept.includes(id))

    const d = defaultLayout(mode)
    return {
      order: [...kept, ...missing],
      panels: { ...d.panels, ...(parsed.panels ?? {}) },
      mapPlane: parsed.mapPlane ?? d.mapPlane,
      mapSplit: clampSplit(parsed.mapSplit ?? d.mapSplit),
    }
  } catch {
    return defaultLayout(mode)
  }
}

export function setMapPlane(layout: Layout, on: boolean): Layout {
  return { ...layout, mapPlane: on }
}

export function setMapSplit(layout: Layout, split: number): Layout {
  return { ...layout, mapSplit: clampSplit(split) }
}

export function saveLayout(mode: UiMode, layout: Layout): void {
  try {
    localStorage.setItem(`${KEY}.${mode}`, JSON.stringify(layout))
  } catch {
    // Private mode or a full quota. Losing the arrangement is not worth an
    // error in front of someone who is trying to play.
  }
}

/**
 * Move `id` so it lands at `index` in the current order.
 *
 * Drag and drop rather than step buttons, because dragging a panel where you
 * want it is the obvious gesture and pressing an arrow four times is a
 * workaround for not having built it.
 */
export function reorderPanel(layout: Layout, id: PanelId, index: number): Layout {
  const order = [...layout.order]
  const from = order.indexOf(id)
  if (from < 0) return layout

  order.splice(from, 1)
  // Clamped after the removal, so dropping past the end lands at the end
  // rather than silently doing nothing.
  const to = Math.min(order.length, Math.max(0, index))
  order.splice(to, 0, id)
  return { ...layout, order }
}

export function movePanel(layout: Layout, id: PanelId, delta: number): Layout {
  const order = [...layout.order]
  const from = order.indexOf(id)
  if (from < 0) return layout
  const to = Math.min(order.length - 1, Math.max(0, from + delta))
  if (to === from) return layout
  order.splice(to, 0, ...order.splice(from, 1))
  return { ...layout, order }
}

export function setPanel(
  layout: Layout,
  id: PanelId,
  patch: PanelState
): Layout {
  return {
    ...layout,
    panels: { ...layout.panels, [id]: { ...layout.panels[id], ...patch } },
  }
}
