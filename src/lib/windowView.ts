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
 * `MapPanel` is the case that found it. `usePanelWindows()` reports which
 * panels have windows of their own, and it reports that honestly to **every**
 * webview of the process - including the popped-out window itself. So the map
 * window asked "is the map popped out?", correctly heard "yes", and rendered
 * the placeholder that exists to tell you the map is somewhere else. Measured
 * on the packaged app: `?view=panel&id=map` showed `MAP · Dan the Bold /
 * Bring it back / Open in its own window, where it is big enough to watch` -
 * the note about the window, inside that very window, with no map in it.
 *
 * The fix belongs here rather than in a second copy of the query parsing,
 * which is why `App.tsx` now imports this instead of holding its own.
 */
import type { PanelId } from './layout'

/**
 * The map window (`?view=map`) is behind a flag - see `MAP_WINDOW_ENABLED` in
 * `App.tsx` for the whole story. Nothing in `src/` opens that route, so the
 * flag lives with the branch it gates and this parser does not know about it;
 * a `?view=map` document is reported as such and `App.tsx` decides.
 */
export type WindowView = { kind: 'map' } | { kind: 'panel'; id: PanelId } | { kind: 'app' }

export function windowView(search?: string): WindowView {
  if (search === undefined && typeof window === 'undefined') return { kind: 'app' }
  const q = new URLSearchParams(search ?? window.location.search)
  if (q.get('view') === 'map') return { kind: 'map' }
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
