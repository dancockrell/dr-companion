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
    /*
     * Named, and not a dead end (#518).
     *
     * The sentence on its own was honest and useless: one line on an empty
     * surface, no control, no way back, and no way to tell a typo from a
     * panel that has since been removed. `map` made that a route a real
     * player takes rather than a hypothetical one - it led every saved
     * layout and every pop-out of it points here now.
     *
     * So: say which ids exist, and offer the app. The list is read from
     * `PANEL_CONTENT`, the same object the lookup above failed against, so it
     * cannot name a panel this window could not render or omit one it could.
     */
    const ids = Object.keys(PANEL_CONTENT).sort()
    return (
      <div className="flex h-full w-full flex-col gap-3 bg-surface p-4 text-sm text-ink">
        <p>
          No panel called <span className="font-medium">{id}</span>.
        </p>
        <p className="text-ink-muted">
          {ids.length} panels can be opened in a window of their own:{' '}
          {ids.join(', ')}.
        </p>
        <p className="text-ink-faint text-xs">
          The map used to be one of them. It is gone, and Godot will own world
          and route presentation instead — see docs/NO-3D.md. A window or saved
          layout still pointing at it lands here.
        </p>
        <div>
          <button
            type="button"
            onClick={() => {
              window.location.search = ''
            }}
            className="rounded border border-border px-2 py-1 text-ink-muted hover:bg-surface-overlay hover:text-ink"
          >
            Open the app in this window
          </button>
        </div>
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
