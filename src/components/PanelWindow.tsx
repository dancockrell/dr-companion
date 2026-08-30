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
 *
 * Used to dispatch through a registry (`panels.tsx`'s `PANEL_CONTENT`) shared
 * with the middle dashboard column, keyed by a `PanelId` that covered nine
 * different panels and a Basic/Power density flag each of them read. The
 * dashboard column is gone (see App.tsx's "kill the middle" comment) and
 * Basic/Power went with it, and this was the pop-out map's only remaining
 * live path through that registry — every other entry had no caller left.
 * Hardcoded to the one panel this window is ever actually opened for.
 */
import { useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'
import { MapPanel } from './shared/MapPanel'

export function PanelWindow({ id }: { id: string }) {
  const connectBridge = useAppStore((s) => s.connectBridge)

  // This window connects for itself. It did not inherit the main window's
  // socket, because it does not share its JavaScript at all.
  useEffect(() => {
    connectBridge()
  }, [connectBridge])

  if (id !== 'map') {
    return (
      <div className="h-full w-full bg-surface text-ink p-4 text-sm">
        No panel called {id}.
      </div>
    )
  }

  return (
    <div className="h-full w-full bg-surface text-ink flex flex-col min-h-0">
      <div className="flex-1 min-h-0 overflow-auto p-3">
        <MapPanel plane />
      </div>
    </div>
  )
}
