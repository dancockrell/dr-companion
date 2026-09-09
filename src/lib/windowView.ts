/**
 * Which window this document is.
 *
 * A query parameter rather than a route path, because the bundled app is
 * served from a file, where a path would 404 while working fine under the dev
 * server.
 *
 * # Why this is a module rather than a function inside `App.tsx`
 *
 * It used to be private to `App.tsx`, which was fine while the only question
 * anybody asked of it was "which component do I render". A panel now has a
 * second reason to care: a panel that is popped out has to render *differently
 * in the window it was popped out into* than in the main window, and it can
 * only tell those apart by asking which document it is in.
 *
 * The panel that found it was the map, which is gone (`docs/NO-3D.md`, 9 Sep
 * 2026). The case it found is not: `usePanelWindows()` reports which panels
 * have windows of their own, and it reports that honestly to **every** webview
 * of the process - including the popped-out window itself. A panel asking "am
 * I popped out?" correctly hears "yes" inside its own window, and would render
 * the placeholder that exists to say the panel is somewhere else. Only the
 * document knows which window it is, so `isOwnPanelWindow` below is the
 * question to ask.
 *
 * The fix belongs here rather than in a second copy of the query parsing,
 * which is why `App.tsx` now imports this instead of holding its own.
 */
import type { PanelId } from './layout'

/**
 * There is no map window.
 *
 * `?view=map` used to be its own top-level window; it was flagged off in D3
 * and deleted in D6 (`docs/NO-3D.md`: the map is gone, and the room-graph data
 * is retained so Godot can own world and route presentation). A `?view=map`
 * document is now an ordinary app window, which is what the flag already made
 * it - this removes the branch rather than changing what a player sees.
 */
export type WindowView = { kind: 'panel'; id: PanelId } | { kind: 'app' }

export function windowView(search?: string): WindowView {
  if (search === undefined && typeof window === 'undefined') return { kind: 'app' }
  const q = new URLSearchParams(search ?? window.location.search)
  if (q.get('view') === 'panel') {
    const id = q.get('id')
    if (id) return { kind: 'panel', id: id as PanelId }
  }
  return { kind: 'app' }
}

/**
 * Is *this* document the window that panel `id` was popped out into?
 *
 * The question a panel has to ask before it believes `usePanelWindows()`. That
 * registry answers "does this panel have a window of its own", which is true
 * in the popped-out window as much as in the main one; only the document knows
 * whether it is that window.
 */
export function isOwnPanelWindow(id: PanelId, search?: string): boolean {
  const v = windowView(search)
  return v.kind === 'panel' && v.id === id
}
