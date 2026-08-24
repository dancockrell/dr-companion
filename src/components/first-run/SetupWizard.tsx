import { NoobChecklist } from './NoobChecklist'
import { useEffect } from 'react'
import { CheckCircle2, Circle, Download, Loader2, AlertCircle } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { Button } from '../shared/Button'
import type { SetupComponent, SetupComponentId } from '../../types'

function StatusIcon({ status }: { status: SetupComponent['status'] }) {
  if (status === 'ready') return <CheckCircle2 className="w-5 h-5 text-good" />
  if (status === 'installing' || status === 'checking')
    return <Loader2 className="w-5 h-5 text-info animate-spin" />
  if (status === 'error') return <AlertCircle className="w-5 h-5 text-danger" />
  return <Circle className="w-5 h-5 text-ink-faint" />
}

export function SetupWizard() {
  const {
    setupComponents,
    updateSetupComponent,
    setSetupComplete,
    simulateConnect,
    addLog,
  } = useAppStore()

  // Simulate initial detection
  useEffect(() => {
    const timers: number[] = []
    const sequence: { id: SetupComponentId; status: SetupComponent['status']; detail?: string; delay: number }[] = [
      { id: 'genie', status: 'ready', detail: 'Detected (mock)', delay: 400 },
      { id: 'ruby', status: 'missing', detail: 'Not found on PATH', delay: 800 },
      { id: 'lich', status: 'missing', detail: 'Not installed', delay: 1100 },
      { id: 'bridge', status: 'missing', detail: 'Will configure after Lich', delay: 1300 },
      { id: 'maps', status: 'missing', detail: 'Optional but recommended', delay: 1500 },
    ]
    sequence.forEach(({ id, status, detail, delay }) => {
      timers.push(
        window.setTimeout(() => {
          updateSetupComponent(id, { status, detail })
        }, delay)
      )
    })
    return () => timers.forEach(clearTimeout)
  }, [updateSetupComponent])

  const allReady = setupComponents.every((c) => c.status === 'ready')
  const anyInstalling = setupComponents.some((c) => c.status === 'installing')

  function handleConfirmInstall(id: SetupComponentId) {
    updateSetupComponent(id, { status: 'installing', detail: 'Downloading…' })
    addLog(`User confirmed install: ${id}`)
    // Mock install progress — real implementation will call Tauri commands
    window.setTimeout(() => {
      updateSetupComponent(id, { status: 'installing', detail: 'Configuring…' })
    }, 900)
    window.setTimeout(() => {
      updateSetupComponent(id, { status: 'ready', detail: 'Installed successfully' })
      addLog(`${id} ready.`)
    }, 2200)
  }

  function handleFinish() {
    setSetupComplete(true)
    simulateConnect()
    addLog('Setup complete. Entering dashboard.')
  }

  function handleInstallAllMissing() {
    const missing = setupComponents.filter((c) => c.status === 'missing')
    if (missing.length === 0 || anyInstalling) return
    let i = 0
    const runNext = () => {
      if (i >= missing.length) return
      const id = missing[i].id
      i += 1
      handleConfirmInstall(id)
      if (i < missing.length) {
        window.setTimeout(runNext, 2400)
      }
    }
    runNext()
  }

  function handleSkipToDemo() {
    setupComponents.forEach((c) => {
      if (c.status !== 'ready') {
        updateSetupComponent(c.id, {
          status: 'ready',
          detail: 'Demo mode (skipped real install)',
        })
      }
    })
    window.setTimeout(() => handleFinish(), 150)
  }

  const missingCount = setupComponents.filter((c) => c.status === 'missing').length

  return (
    <div className="min-h-full flex flex-col p-5 gap-5 max-w-lg mx-auto">
      <header className="space-y-2 pt-2">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Welcome to DR Companion
        </h1>
        <p className="text-ink-muted text-sm leading-relaxed">
          We need a few pieces so this panel can control the game safely. Nothing
          is downloaded until you click <strong className="text-ink">Confirm</strong>.
        </p>
      </header>

      <NoobChecklist />

      <section className="space-y-3">
        {setupComponents.map((c) => (
          <div
            key={c.id}
            className="rounded-2xl border border-border bg-surface-raised p-4 flex gap-3 items-start"
          >
            <div className="pt-0.5">
              <StatusIcon status={c.status} />
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-medium text-ink">{c.label}</h2>
                {c.status === 'ready' && (
                  <span className="text-xs text-good font-medium">Ready</span>
                )}
              </div>
              <p className="text-xs text-ink-muted leading-snug">{c.description}</p>
              {c.detail && (
                <p className="text-xs text-ink-faint">{c.detail}</p>
              )}
              {c.status === 'missing' && (
                <div className="pt-2">
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Download className="w-3.5 h-3.5" />}
                    onClick={() => handleConfirmInstall(c.id)}
                    disabled={anyInstalling}
                  >
                    Confirm & Install
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}
      </section>

      <div className="mt-auto pt-2 space-y-3">
        {missingCount > 0 && (
          <Button
            size="lg"
            variant="primary"
            disabled={anyInstalling}
            icon={<Download className="w-4 h-4" />}
            onClick={handleInstallAllMissing}
          >
            Confirm & Install all missing ({missingCount})
          </Button>
        )}
        <Button
          size="xl"
          variant="good"
          disabled={!allReady}
          onClick={handleFinish}
        >
          {allReady ? 'Everything is ready — Continue' : 'Install missing pieces to continue'}
        </Button>
        <button
          type="button"
          onClick={handleSkipToDemo}
          className="w-full text-center text-xs text-ink-faint hover:text-ink-muted underline-offset-2 hover:underline py-1"
        >
          Skip installs — open demo dashboard
        </button>
        <p className="text-[11px] text-ink-faint text-center leading-relaxed">
          Real installs will use official Lich / Ruby sources. This preview uses
          simulated detection so you can explore the interface.
        </p>
      </div>
    </div>
  )
}
