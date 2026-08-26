import { SetupWizard } from './components/first-run/SetupWizard'
import { Dashboard } from './components/dashboard/Dashboard'
import { RoomColumn } from './components/room/RoomColumn'
import { AppControls } from './components/layout/AppControls'
import { SafetyFooter } from './components/layout/SafetyFooter'
import { SituationBanner } from './components/layout/SituationBanner'
import { Console } from './components/layout/Console'
import { MapWindow } from './components/MapWindow'
import { PanelWindow } from './components/PanelWindow'
import type { PanelId } from './lib/layout'
import { useAppStore } from './store/useAppStore'

/**
 * Which window this is.
 *
 * The map pops out into a window of its own, which Tauri opens on
 * `index.html?view=map`. A query parameter rather than a route path, because
 * the bundled app is served from a file, where a path would 404 while working
 * fine under the dev server.
 */
function view(): { kind: 'map' } | { kind: 'panel'; id: PanelId } | { kind: 'app' } {
  if (typeof window === 'undefined') return { kind: 'app' }
  const q = new URLSearchParams(window.location.search)
  if (q.get('view') === 'map') return { kind: 'map' }
  if (q.get('view') === 'panel') {
    const id = q.get('id')
    if (id) return { kind: 'panel', id: id as PanelId }
  }
  return { kind: 'app' }
}

export default function App() {
  const setupComplete = useAppStore((s) => s.setupComplete)

  // A popped-out panel is the whole window: no header, no console, no setup
  // wizard. The window *is* the panel, and chrome here would be space charged
  // twice.
  const v = view()
  if (v.kind === 'map') return <MapWindow />
  if (v.kind === 'panel') return <PanelWindow id={v.id} />

  // No max-width. The window is only as wide as the player has decided we are
  // worth against the game window next to it, and capping it at 560px would
  // throw away space they deliberately gave us. See docs/DESIGN.md §2.115.
  return (
    <div className="h-full w-full bg-surface flex flex-col">
      {/* No title bar. The window has one, the character box carries the
          name, and the map says where you are. What is left is three
          controls, which do not need a band of their own. */}
      <AppControls />
      {setupComplete && <SituationBanner />}
      {/* Two columns of equal width: the companion, and the room.
       *
       * The split lives here rather than inside Dashboard because Dashboard
       * measures its own width to decide whether to render dense. Splitting
       * below that point would have it laying out for the full window while
       * occupying half of one.
       *
       * Equal at default scale, and the room column is allowed to give ground
       * first on a narrow window: the companion is the instrument, and a
       * cramped map is a worse loss than a cramped description. */}
      <main className="flex min-h-0 flex-1 overflow-hidden">
        {setupComplete ? (
          <>
            <div className="min-w-0 flex-1 overflow-y-auto">
              <Dashboard />
            </div>
            <div className="min-w-0 flex-1 overflow-hidden border-l border-border">
              <RoomColumn />
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <SetupWizard />
          </div>
        )}
      </main>
      {setupComplete && <Console />}
      {setupComplete && <SafetyFooter />}
    </div>
  )
}
