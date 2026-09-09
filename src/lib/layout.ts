/**
 * Where the panels are and how big, remembered per mode.
 *
 * Everyone plays differently. A crafter wants inventory open and their
 * training visible; someone hunting wants the battle picture big. Rather than
 * guess an order and defend it, the panels move and resize, and the
 * arrangement is theirs — in freeform, via `FreeCanvas`, which is the only
 * thing that reads `order`/`rects` today.
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
import { DECKS, type Deck, type Tier } from './cards.ts'
import type { Rect } from './freeLayout'
import { dockOf, without, type Dock } from './dock.ts'
import { readJSON, writeJSON } from './storage.ts'

export type PanelId =
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
  // The scene editor: what the room the character is in looks like, and how to
  // disagree with the batch that decided it.
  | 'scene'
  // The player's own rules: highlights, aliases, macros, substitutes, gags,
  // presets and variables. Reachable as `?view=panel&id=config`; deliberately
  // not in any mode's default order, like `scene` - it is a thing you open,
  // not a thing you watch.
  | 'config'
  // The room, the game text and the command line, as one panel.
  // Rendered as a fixed column in the normal layout; it becomes a panel in
  // freeform, where there are no columns to put it in.
  | 'game'
  // The visual pane - the room picture, who is in it, the description and
  // what is on the floor. It is what sits in the top right corner in
  // `minimap`, and it is what `popped` opens in a window of its own, which is
  // why it needs an id at all: the pop-out uses the panel-window machinery
  // rather than a second implementation of the same thing. Deliberately not
  // in any mode's default order, like `scene` and `config` - `scenePane.ts`
  // decides where it is, not the dock.
  | 'board'
  // Tasks and scripts: the icon grid that used to occupy the console row's
  // left cell. It had no id while it had a fixed home; the bottom bar opens
  // it, and the bar opens panels.
  | 'tasks'

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
 * `vitals`, Power puts `room` second — but see the header comment above: the
 * default dashboard doesn't read `order` for arrangement, so this difference
 * is currently only visible in freeform (`FreeCanvas`) and in which panels
 * `Dashboard.tsx` treats as docked. `panels.height` and each panel's own
 * `dense` behavior are what a player actually sees differ between modes
 * today.
 *
 * `map` used to lead the Basic order and sit fifth in Power. It is gone
 * (`docs/NO-3D.md`, 9 Sep 2026); `RETIRED_PANEL_IDS` below is what a layout
 * saved before that is measured against.
 */
const DEFAULTS: Record<UiMode, Layout> = {
  basic: {
    order: ['vitals', 'room', 'mindstate', 'actions', 'training', 'inventory', 'launcher', 'risk', 'stats', 'scripts', 'game'],
    panels: {},
    decks: autoDecks(),
    rects: {},
    freeform: false,
  },
  power: {
    order: ['vitals', 'room', 'mindstate', 'actions', 'risk', 'stats', 'training', 'inventory', 'launcher', 'scripts', 'game'],
    panels: {},
    decks: autoDecks(),
    rects: {},
    freeform: false,
  },
}

const KEY = 'drc.layout.v1'

/**
 * Panel ids that existed once and do not now.
 *
 * A list rather than a version bump, because a bump throws away the player's
 * whole arrangement to remove one entry from it — every column width, every
 * pop-out, every deck they pinned — and that is a much larger change than the
 * one being made. This removes exactly what is gone and leaves the rest as
 * they left it.
 *
 * It is also a *manifest*: `loadLayout` already dropped unknown ids from
 * `order` by filtering against the defaults, so nothing about `order` needed
 * this. What that filter cannot do is tell "an id that is gone" from "an id
 * this build does not have yet", and it never reached `panels`, `rects` or
 * the persisted `dock` at all — so a saved layout kept rendering a `map` tab
 * in its dock with no panel behind it. Naming the retired ids is what lets
 * those three be cleaned instead of merged forward.
 */
export const RETIRED_PANEL_IDS = ['map'] as const

/**
 * Storage keys that were read by something now deleted.
 *
 * `drc.map.v1` was the map's dock/zoom (`mapDock.ts`); the two map-height keys
 * were how the board slot divided between the map and the battle picture
 * (`App.tsx`). Nothing reads any of them. They are deleted rather than left in
 * place because a stored number whose meaning has gone is the "old data under
 * a new meaning" trap waiting for whoever reuses the key next.
 */
const RETIRED_STORAGE_KEYS = ['drc.map.v1', 'drc.map-height.v4', 'drc.map-height.v1']

/** Deletes {@link RETIRED_STORAGE_KEYS}. Returns how many it removed. */
export function stripRetiredKeys(): number {
  let removed = 0
  for (const key of RETIRED_STORAGE_KEYS) {
    try {
      if (localStorage.getItem(key) === null) continue
      localStorage.removeItem(key)
      removed++
    } catch {
      // Storage can throw outright (private mode, blocked site data). A
      // preference we could not delete is not worth failing a load over.
    }
  }
  return removed
}

export function defaultLayout(mode: UiMode): Layout {
  const d = DEFAULTS[mode] ?? DEFAULTS.basic
  return {
    order: [...d.order],
    panels: { ...d.panels },
    decks: { ...d.decks },
    rects: { ...d.rects },
    freeform: d.freeform,
    dock: dockOf([...d.order]),
  }
}

/** Drop the retired ids from a `Record<PanelId, …>` read back out of storage. */
function withoutRetired<T>(
  stored: Partial<Record<PanelId, T>> | undefined
): Partial<Record<PanelId, T>> {
  const out: Partial<Record<PanelId, T>> = {}
  for (const [id, value] of Object.entries(stored ?? {})) {
    if ((RETIRED_PANEL_IDS as readonly string[]).includes(id)) continue
    out[id as PanelId] = value as T
  }
  return out
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
    panels: { ...d.panels, ...withoutRetired(parsed.panels) },
    // Merged rather than trusted, same as the panels: a deck added later
    // must not be missing for anyone who already saved a layout.
    decks: { ...d.decks, ...(parsed.decks ?? {}) },
    rects: withoutRetired<Rect>(parsed.rects),
    freeform: parsed.freeform ?? false,
    // Rebuilt from the panel order when absent, so an old saved layout picks
    // up docking without the player losing their arrangement. When it *is*
    // present it still has to be cleaned: `dock.ts`'s `without` exists for
    // exactly this ("the map moved out of the stack ... a stored one has to be
    // cleaned") and until now had no caller, so a stored dock kept listing a
    // panel that no longer renders.
    dock: parsed.dock
      ? without(parsed.dock, RETIRED_PANEL_IDS)
      : dockOf([...kept, ...missing]),
  }
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
