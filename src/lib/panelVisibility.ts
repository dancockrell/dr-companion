/**
 * Which boxes in the dashboard's middle column are shown.
 *
 * `DashboardLayout.tsx` renders a fixed grid — map on the left (its own
 * plane), the room/game/chat column on the right (`RoomColumn`), and
 * everything else stacked in the middle: Experience, You, Risk, Tasks, Quick
 * Queue, Training, Objects, Inventory, Script Library. Until now that
 * middle stack had exactly one on/off lever, Basic vs Power, which is a
 * curated *pair* of fixed sets, not a per-window choice — a player in Power
 * who wants Training but not Inventory had no way to say so. This is that
 * lever, one box at a time, on top of whichever set the mode already picked
 * (a box gated to Power stays gated to Power; this only ever removes further,
 * never adds a box the mode wouldn't otherwise show).
 *
 * Not in `layout.ts`'s `Layout`/`PanelId`. That type already carries the
 * dock, freeform placement and pop-out membership for a *different* panel
 * set (documented in `layout.ts`'s own header as a second source of truth
 * `DashboardLayout` doesn't consult), and several of these boxes — Objects,
 * Quick Queue, the "You" cluster — have no `PanelId` at all because they
 * never participated in freeform or pop-out. Bolting visibility for a
 * different id space onto that type would be the third source of truth, not
 * a fix for the other two. This is deliberately its own small, storage-backed
 * module, the same shape `mapDock.ts` already uses for exactly this reason
 * (a setting two components need to agree on, that isn't game state).
 *
 * localStorage with a subscription, read through `useSyncExternalStore` —
 * same reasoning as `mapDock.ts`: not component state, because nothing here
 * needs two copies to ever disagree, and not the Zustand store, because this
 * is a property of this window on this screen, not a fact about the
 * character.
 */
import { useSyncExternalStore } from 'react'
import { readJSON, writeJSON } from './storage'

export type MiddlePanelId =
  | 'experience'
  | 'you'
  | 'risk'
  | 'tasks'
  | 'quickqueue'
  | 'training'
  | 'inventory'
  | 'scripts'

/** Order they're offered in Settings — the same order they stack on screen. */
export const MIDDLE_PANEL_IDS: MiddlePanelId[] = [
  'experience',
  'you',
  'risk',
  'tasks',
  'quickqueue',
  'training',
  'inventory',
  'scripts',
]

export const MIDDLE_PANEL_LABELS: Record<MiddlePanelId, string> = {
  experience: 'Experience',
  you: 'You (portrait, vitals, status)',
  risk: 'Risk',
  tasks: 'Tasks and scripts',
  quickqueue: 'Quick Queue',
  training: 'Training',
  inventory: 'Inventory',
  scripts: 'Script Library',
}

const KEY = 'drc.middle-panels-hidden.v1'

function read(): Set<MiddlePanelId> {
  const raw = readJSON<unknown>(KEY, [])
  if (!Array.isArray(raw)) return new Set()
  // Filtered against the real id list rather than trusted, the same reason
  // `loadLayout` filters `order` against known ids: a build that renamed or
  // removed a panel must not leave a stored id that hides nothing, or worse,
  // silently matches a different panel that reused the name later.
  return new Set(raw.filter((id): id is MiddlePanelId => MIDDLE_PANEL_IDS.includes(id)))
}

let current = read()
const listeners = new Set<() => void>()

function subscribe(fn: () => void) {
  listeners.add(fn)
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return
    current = read()
    fn()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(fn)
    window.removeEventListener('storage', onStorage)
  }
}

function commit(next: Set<MiddlePanelId>) {
  current = next
  writeJSON(KEY, [...next])
  for (const fn of listeners) fn()
}

export function setPanelHidden(id: MiddlePanelId, hidden: boolean): void {
  if (hidden === current.has(id)) return
  const next = new Set(current)
  if (hidden) next.add(id)
  else next.delete(id)
  commit(next)
}

export function toggleMiddlePanel(id: MiddlePanelId): void {
  setPanelHidden(id, !current.has(id))
}

/** Every box starts visible; nothing here changes what a fresh install shows. */
const EMPTY: Set<MiddlePanelId> = new Set()

export function useHiddenMiddlePanels(): Set<MiddlePanelId> {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => EMPTY
  )
}
