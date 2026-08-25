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
}

/**
 * Defaults per mode.
 *
 * Basic leads with the map because orientation is what a returning player
 * needs first, then the thing they came to press. Power puts vitals and
 * actions up top and leaves the map open underneath to watch.
 */
const DEFAULTS: Record<UiMode, Layout> = {
  basic: {
    order: ['vitals', 'map', 'actions', 'training', 'inventory', 'launcher', 'risk'],
    panels: { map: { height: 200 } },
  },
  power: {
    order: ['vitals', 'actions', 'map', 'risk', 'training', 'inventory', 'launcher'],
    panels: { map: { height: 260 } },
  },
}

const KEY = 'drc.layout.v1'

export function defaultLayout(mode: UiMode): Layout {
  const d = DEFAULTS[mode] ?? DEFAULTS.basic
  return { order: [...d.order], panels: { ...d.panels } }
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

    return {
      order: [...kept, ...missing],
      panels: { ...defaultLayout(mode).panels, ...(parsed.panels ?? {}) },
    }
  } catch {
    return defaultLayout(mode)
  }
}

export function saveLayout(mode: UiMode, layout: Layout): void {
  try {
    localStorage.setItem(`${KEY}.${mode}`, JSON.stringify(layout))
  } catch {
    // Private mode or a full quota. Losing the arrangement is not worth an
    // error in front of someone who is trying to play.
  }
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
