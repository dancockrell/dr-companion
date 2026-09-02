/**
 * Where the panels are and how big, remembered per mode.
 *
 * Everyone plays differently. A crafter wants inventory open and the map
 * small; someone hunting wants the map big and watched, because they know
 * which rooms break a script. Rather than guess an order and defend it, the
 * panels move and resize, and the arrangement is theirs — in freeform, via
 * `FreeCanvas`, which is the only thing that reads `order`/`rects` today.
 *
 * **Not true of the default dashboard.** This used to say Basic and Power
 * are "different arrangements of the same panels, not the same arrangement
 * at two sizes" — that describes what this file builds, not what a player
 * sees. `DashboardLayout.tsx` renders a fixed grid that never reads `order`
 * for arrangement (see its own doc comment); the only place `order` reaches
 * the default view is `Dashboard.tsx` filtering it for **dock membership**
 * (which panels are docked vs popped out), not sequence. So today, Basic and
 * Power differ in size defaults and each panel's own `dense` rendering, not
 * in where panels sit. See issue #33 before assuming this comment is current
 * again — it was already wrong once.
 */
import type { UiMode } from '../types'
import { DECKS, type Deck, type Tier } from './cards'
import type { Rect } from './freeLayout'
import { dockOf, type Dock } from './dock'
import { readJSON, writeJSON } from './storage'

export type PanelId =
  | 'map'
  | 'vitals'
  | 'actions'
  | 'training'
  | 'inventory'
  | 'risk'
  | 'stats'
  | 'launcher'
  | 'room'
  | 'mindstate'
  | 'scripts'
  // The room, the game text and the command line, as one panel.
  // Rendered as a fixed column in the normal layout; it becomes a panel in
  // freeform, where there are no columns to put it in.
  | 'game'

export interface PanelState {
  /** Collapsed to its title bar. */
  closed?: boolean
  /** Body height in pixels. Undefined means the panel sizes to its content. */
  height?: number
}

/**
 * A deck density the player pinned, or auto.
 *
 * Auto is right almost always, and the reason to allow pinning anyway is that
 * expertise is the point: someone three hundred hours in knows they always
 * want the hostile deck fanned, whatever the width says, and a tool that
 * overrules them every resize is a tool they stop trusting.
 */
export type DeckPref = 'auto' | Tier

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
  /** Per-deck density, pinned by the player. Auto unless they said otherwise. */
  decks: Record<Deck, DeckPref>
  /**
   * Where each panel sits, once it has been dragged.
   *
   * Empty until someone moves something. Before that the panels flow, which is
   * a sensible arrangement nobody had to build; after it they stay exactly
   * where they were put, which is the point.
   */
  rects: Partial<Record<PanelId, Rect>>
  /** True once anything has been placed by hand. */
  freeform: boolean
  /**
   * Regions and their decks.
   *
   * Stored as the player arranged it, not as it currently looks: folding is
   * derived from the width every render, so a window made narrow and then wide
   * again returns the arrangement rather than whatever the narrow state
   * collapsed to.
   */
  dock?: Dock
}

/** Every deck starts on auto. */
function autoDecks(): Record<Deck, DeckPref> {
  return Object.fromEntries(DECKS.map((d) => [d, 'auto'])) as Record<Deck, DeckPref>
}

/**
 * Defaults per mode.
 *
 * The `order` arrays below are real and genuinely differ — Basic leads with
 * `map`, Power with `room` — but see the header comment above: the default
 * dashboard doesn't read `order` for arrangement, so this difference is
 * currently only visible in freeform (`FreeCanvas`) and in which panels
 * `Dashboard.tsx` treats as docked. `panels.height` and each panel's own
 * `dense` behavior are what a player actually sees differ between modes
 * today.
 */
const DEFAULTS: Record<UiMode, Layout> = {
  basic: {
    order: ['vitals', 'map', 'room', 'mindstate', 'actions', 'training', 'inventory', 'launcher', 'risk', 'stats', 'scripts', 'game'],
    panels: { map: { height: 200 } },
    mapPlane: true,
    mapSplit: 0.38,
    decks: autoDecks(),
    rects: {},
    freeform: false,
  },
  power: {
    order: ['vitals', 'room', 'mindstate', 'actions', 'map', 'risk', 'stats', 'training', 'inventory', 'launcher', 'scripts', 'game'],
    panels: { map: { height: 260 } },
    mapPlane: true,
    mapSplit: 0.38,
    decks: autoDecks(),
    rects: {},
    freeform: false,
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
    decks: { ...d.decks },
    rects: { ...d.rects },
    freeform: d.freeform,
    dock: dockOf([...d.order]),
  }
}

/** Keeps either plane from being dragged down to nothing. */
export function clampSplit(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0.5
  return Math.min(0.75, Math.max(0.25, n))
}

export function loadLayout(mode: UiMode): Layout {
  const parsed = readJSON<Partial<Layout> | null>(`${KEY}.${mode}`, null)
  if (!parsed) return defaultLayout(mode)

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
    // Merged rather than trusted, same as the panels: a deck added later
    // must not be missing for anyone who already saved a layout.
    decks: { ...d.decks, ...(parsed.decks ?? {}) },
    rects: parsed.rects ?? {},
    freeform: parsed.freeform ?? false,
    // Rebuilt from the panel order when absent, so an old saved layout picks
    // up docking without the player losing their arrangement.
    dock: parsed.dock ?? dockOf([...kept, ...missing]),
  }
}

export function setMapPlane(layout: Layout, on: boolean): Layout {
  return { ...layout, mapPlane: on }
}

export function setMapSplit(layout: Layout, split: number): Layout {
  return { ...layout, mapSplit: clampSplit(split) }
}

/**
 * Anyone who needs to know the arrangement changed.
 *
 * `useLayout` keeps its state per component on purpose - the comment at the
 * top of that file explains why this is not in the global store, and it is
 * right: it changes on every drag and re-rendering the whole app for that
 * would be awful.
 *
 * The cost is that two callers of `useLayout` each hold their own copy and
 * never learn about each other's edits. That is fine while the dashboard is
 * the only caller, and it stops being fine the moment App needs to know
 * whether freeform is on - App's copy would keep saying `false` after the
 * dashboard turned it on, and the columns would never go away.
 *
 * So: one notification, no second copy of the state. Subscribers re-read from
 * here, which stays the single source of truth.
 */
const listeners = new Set<() => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key?.startsWith(`${KEY}.`)) {
      for (const fn of listeners) fn()
    }
  })
}

export function onLayoutChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function saveLayout(mode: UiMode, layout: Layout): void {
  writeJSON(`${KEY}.${mode}`, layout)
  for (const fn of listeners) fn()
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

/**
 * The order the header cycles through.
 *
 * Auto first so a single click from any pinned state is never more than a few
 * presses from handing control back.
 */
export const DECK_PREFS: DeckPref[] = [
  'auto', 'full', 'compact', 'row', 'fan', 'count',
]

export function setDeckPref(layout: Layout, deck: Deck, pref: DeckPref): Layout {
  return { ...layout, decks: { ...layout.decks, [deck]: pref } }
}

/**
 * Advance a deck to the next density.
 *
 * A cycling control rather than a menu: it is one target, it shows its own
 * state, and it costs no space when not in use. A dropdown here would be a
 * menu opened over the thing it is describing, during a fight.
 */
export function cycleDeckPref(layout: Layout, deck: Deck): Layout {
  const now = layout.decks[deck] ?? 'auto'
  const next = DECK_PREFS[(DECK_PREFS.indexOf(now) + 1) % DECK_PREFS.length]
  return setDeckPref(layout, deck, next)
}

/**
 * Enter freeform with nothing placed yet.
 *
 * Safe to leave `rects` empty: FreeCanvas already falls back to
 * `firstFreeSlot` for any panel with no rect, which is how a panel dragged
 * for the first time gets a starting position at all. Without this, the only
 * way `freeform` ever became true was `setPanelRect` — called from inside
 * FreeCanvas's own drag handler, which only renders once freeform is already
 * true. A locked door with no handle on either side (issue #32).
 */
export function enterFreeform(layout: Layout): Layout {
  return { ...layout, freeform: true }
}

/** Place one panel, and record that the layout is now hand-arranged. */
export function setPanelRect(layout: Layout, id: PanelId, rect: Rect): Layout {
  return {
    ...layout,
    freeform: true,
    rects: { ...layout.rects, [id]: rect },
  }
}

/** Back to the flow, discarding every placement. */
export function clearPanelRects(layout: Layout): Layout {
  return { ...layout, freeform: false, rects: {} }
}

/** Replace the dock wholesale, which is how the view reports every change. */
export function setDock(layout: Layout, dock: Dock): Layout {
  return { ...layout, dock }
}
