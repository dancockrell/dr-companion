/**
 * One panel, popped out into a window of its own.
 *
 * A separate webview, so it has its own JavaScript context and its own bridge
 * connection. That is fine and slightly useful: the Lich bridge serves multiple
 * clients, the mock runs in-process per window, and neither window can corrupt
 * the other's state.
 *
 * Deliberately no header of its own beyond a title bar. The window *is* the
 * panel — chrome here would be space charged twice.
 */
import { useEffect } from 'react'
import { useAppStore } from '../store/useAppStore.ts'
import { PANEL_CONTENT, panelTitle } from './dashboard/panels.tsx'
import { useLayout } from '../lib/useLayout.ts'
import type { PanelId } from '../lib/layout'

export function PanelWindow({ id }: { id: PanelId }) {
  const connectBridge = useAppStore((s) => s.connectBridge)
  const uiMode = useAppStore((s) => s.uiMode)

  // This window connects for itself. It did not inherit the main window's
  // socket, because it does not share its JavaScript at all.
  useEffect(() => {
    connectBridge()
  }, [connectBridge])

  const { layout, cycleDeck } = useLayout(uiMode)
  /*
   * `Object.hasOwn`, not a plain lookup.
   *
   * `id` comes from the query string, so it is whatever the URL says, and a
   * plain `PANEL_CONTENT[id]` reaches `Object.prototype`. Measured against
   * the dev server, with `?view=panel&id=stats` as the control:
   *
   *   stats        the stats panel
   *   toString     "[object Undefined]" rendered as the window
   *   constructor  "constructor panel window crashed - Objects are not valid as..."
   *   valueOf      "valueOf panel window crashed - Cannot convert undefined or..."
   *   nosuchpanel  "No panel called nosuchpanel."  <- the honest answer
   *
   * Only the last one is what any of the four should have done. The Rust
   * side already refuses these - `valid_panel_id` in `src-tauri/src/lib.rs`
   * gates `open_panel_window` - but the route is reachable by typing a URL
   * into the window, so the check has to be on this side of it too.
   */
  const render = Object.hasOwn(PANEL_CONTENT, id) ? PANEL_CONTENT[id] : undefined

  if (!render) {
    return (
      <div className="h-full w-full bg-surface text-ink p-4 text-sm">
        No panel called {id}.
      </div>
    )
  }

  return (
    <div className="h-full w-full bg-surface text-ink flex flex-col min-h-0">
      <div className="flex-1 min-h-0 overflow-auto p-3">
        {render(uiMode === 'power', true, {
          deckPrefs: layout.decks,
          onCycleDeck: cycleDeck,
        })}
      </div>
    </div>
  )
}

export { panelTitle }
