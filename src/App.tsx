import { SetupWizard } from './components/first-run/SetupWizard'
import { Dashboard } from './components/dashboard/Dashboard'
import { AppHeader } from './components/layout/AppHeader'
import { SafetyFooter } from './components/layout/SafetyFooter'
import { SituationBanner } from './components/layout/SituationBanner'
import { Console } from './components/layout/Console'
import { MapWindow } from './components/MapWindow'
import { useAppStore } from './store/useAppStore'

/**
 * Which window this is.
 *
 * The map pops out into a window of its own, which Tauri opens on
 * `index.html?view=map`. A query parameter rather than a route path, because
 * the bundled app is served from a file, where a path would 404 while working
 * fine under the dev server.
 */
function view(): 'map' | 'app' {
  if (typeof window === 'undefined') return 'app'
  return new URLSearchParams(window.location.search).get('view') === 'map'
    ? 'map'
    : 'app'
}

export default function App() {
  const setupComplete = useAppStore((s) => s.setupComplete)

  // The popped-out map is the whole window: no header, no console, no setup
  // wizard. It is one thing, sized to be watched.
  if (view() === 'map') return <MapWindow />

  // No max-width. The window is only as wide as the player has decided we are
  // worth against the game window next to it, and capping it at 560px would
  // throw away space they deliberately gave us. See docs/DESIGN.md §2.115.
  return (
    <div className="h-full w-full bg-surface flex flex-col">
      <AppHeader />
      {setupComplete && <SituationBanner />}
      <main className="flex-1 min-h-0 overflow-y-auto">
        {setupComplete ? <Dashboard /> : <SetupWizard />}
      </main>
      {setupComplete && <Console />}
      {setupComplete && <SafetyFooter />}
    </div>
  )
}
