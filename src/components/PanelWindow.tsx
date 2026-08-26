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
import { useAppStore } from '../store/useAppStore'
import { PANEL_CONTENT, panelTitle } from './dashboard/panels'
import { useLayout } from '../lib/useLayout'
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
  const render = PANEL_CONTENT[id]

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
