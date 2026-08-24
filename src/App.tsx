import { SetupWizard } from './components/first-run/SetupWizard'
import { SimpleDashboard } from './components/dashboard/SimpleDashboard'
import { StandardDashboard } from './components/dashboard/StandardDashboard'
import { PowerDashboard } from './components/dashboard/PowerDashboard'
import { AppHeader } from './components/layout/AppHeader'
import { SafetyFooter } from './components/layout/SafetyFooter'
import { SituationBanner } from './components/layout/SituationBanner'
import { useAppStore } from './store/useAppStore'

export default function App() {
  const setupComplete = useAppStore((s) => s.setupComplete)
  const uiMode = useAppStore((s) => s.uiMode)

  let dashboard = <SimpleDashboard />
  if (uiMode === 'standard') dashboard = <StandardDashboard />
  if (uiMode === 'power') dashboard = <PowerDashboard />

  return (
    <div className="h-full w-full max-w-[560px] mx-auto bg-surface flex flex-col border-x border-border/50 shadow-2xl shadow-black/40">
      <AppHeader />
      {setupComplete && <SituationBanner />}
      <main className="flex-1 min-h-0 overflow-y-auto">
        {setupComplete ? dashboard : <SetupWizard />}
      </main>
      {setupComplete && <SafetyFooter />}
    </div>
  )
}
