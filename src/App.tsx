import { SetupWizard } from './components/first-run/SetupWizard'
import { StandardDashboard } from './components/dashboard/StandardDashboard'
import { PowerDashboard } from './components/dashboard/PowerDashboard'
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
  const uiMode = useAppStore((s) => s.uiMode)

  // The popped-out map is the whole window: no header, no console, no setup
  // wizard. It is one thing, sized to be watched.
  if (view() === 'map') return <MapWindow />

  // Basic is the old Standard, which is what everyone would have picked.
  let dashboard = <StandardDashboard />
  if (uiMode === 'power') dashboard = <PowerDashboard />

  return (
    <div className="h-full w-full max-w-[560px] mx-auto bg-surface flex flex-col border-x border-border/50 shadow-2xl shadow-black/40">
      <AppHeader />
      {setupComplete && <SituationBanner />}
      <main className="flex-1 min-h-0 overflow-y-auto">
        {setupComplete ? dashboard : <SetupWizard />}
      </main>
      {setupComplete && <Console />}
      {setupComplete && <SafetyFooter />}
    </div>
  )
}
