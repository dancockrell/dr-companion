import { NoobChecklist } from './NoobChecklist'
import { useCallback, useEffect, useState } from 'react'
import {
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
  RefreshCw,
  Copy,
  ExternalLink,
} from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { Button } from '../shared/Button'
import { isTauri, detectComponents, rubyInstallCommand } from '../../lib/tauri'
import type { SetupComponent, SetupComponentId } from '../../types'

function StatusIcon({ status }: { status: SetupComponent['status'] }) {
  if (status === 'ready') return <CheckCircle2 className="w-5 h-5 text-good" />
  if (status === 'installing' || status === 'checking')
    return <Loader2 className="w-5 h-5 text-info animate-spin" />
  if (status === 'error') return <AlertCircle className="w-5 h-5 text-danger" />
  return <Circle className="w-5 h-5 text-ink-faint" />
}

/**
 * What to do about each missing piece.
 *
 * Ruby and Lich are handed over as a command or a link, not installed
 * silently. The user sees exactly what would run before it runs, which is the
 * difference between a setup tool and something that just downloads things.
 */
const REMEDY: Record<
  SetupComponentId,
  { how: string; command?: string; link?: string; linkLabel?: string }
> = {
  genie: {
    how: 'Any Simutronics frontend works. Genie is the common one for DragonRealms.',
    link: 'https://genie.gs4dragon.com/',
    linkLabel: 'Genie downloads',
  },
  ruby: {
    how: 'Lich runs on Ruby. Install it with winget, then reopen this app so the new PATH is picked up.',
    command:
      'winget install --id RubyInstallerTeam.RubyWithDevKit.3.3 --source winget',
  },
  lich: {
    how: 'Lich 5 is the automation engine. Download it from the elanthia-online project and unzip it somewhere stable.',
    link: 'https://github.com/elanthia-online/lich-5',
    linkLabel: 'elanthia-online/lich-5',
  },
  bridge: {
    how: 'Copy lich-scripts/companion_bridge.lic into Lich’s scripts folder, then run ;companion_bridge in game.',
  },
  maps: {
    how: 'Lich downloads its map database on first run. Optional, but travel needs it.',
    link: 'https://github.com/elanthia-online/mapdb-backup-dr',
    linkLabel: 'DR map database',
  },
}

export function SetupWizard() {
  const setupComponents = useAppStore((s) => s.setupComponents)
  const updateSetupComponent = useAppStore((s) => s.updateSetupComponent)
  const setSetupComplete = useAppStore((s) => s.setSetupComplete)
  const simulateConnect = useAppStore((s) => s.simulateConnect)
  const addLog = useAppStore((s) => s.addLog)

  const [scanning, setScanning] = useState(false)
  const [canDetect] = useState(() => isTauri())
  const [copied, setCopied] = useState<string | null>(null)

  const scan = useCallback(async () => {
    const ids = useAppStore.getState().setupComponents.map((c) => c.id)

    if (!canDetect) {
      // In the browser we genuinely cannot look at the filesystem. Say that,
      // rather than reporting a state we did not check.
      ids.forEach((id) =>
        updateSetupComponent(id, {
          status: 'missing',
          detail: 'Cannot check from the browser. Run the desktop app to detect.',
        })
      )
      return
    }

    setScanning(true)
    ids.forEach((id) => updateSetupComponent(id, { status: 'checking' }))
    try {
      const found = await detectComponents()
      if (!found) {
        ids.forEach((id) =>
          updateSetupComponent(id, {
            status: 'error',
            detail: 'Detection failed',
          })
        )
        return
      }
      found.forEach((f) => {
        updateSetupComponent(f.id as SetupComponentId, {
          status: f.status,
          detail: f.path ? `${f.detail} — ${f.path}` : f.detail,
        })
      })
      const ready = found.filter((f) => f.status === 'ready').length
      addLog(`Detected ${ready} of ${found.length} components.`)
    } catch (e) {
      addLog(`Detection error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setScanning(false)
    }
  }, [canDetect, updateSetupComponent, addLog])

  useEffect(() => {
    void scan()
  }, [scan])

  async function copyCommand(id: SetupComponentId) {
    const cmd =
      id === 'ruby' ? await rubyInstallCommand() : (REMEDY[id].command ?? '')
    if (!cmd) return
    try {
      await navigator.clipboard.writeText(cmd)
      setCopied(id)
      window.setTimeout(() => setCopied(null), 1800)
    } catch {
      addLog(`Copy failed. Command: ${cmd}`)
    }
  }

  function handleFinish() {
    setSetupComplete(true)
    simulateConnect()
    addLog('Entering dashboard.')
  }

  const missing = setupComponents.filter((c) => c.status !== 'ready')
  const allReady = missing.length === 0

  return (
    <div className="min-h-full flex flex-col p-5 gap-5 max-w-lg mx-auto">
      <header className="space-y-2 pt-2">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Welcome to DR Companion
        </h1>
        <p className="text-ink-muted text-sm leading-relaxed">
          This checks what you already have. It does not install Ruby or Lich
          for you: it shows you the command and you run it. You can also skip
          all of this and try the demo.
        </p>
      </header>

      <NoobChecklist />

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-ink-faint">
          {canDetect
            ? scanning
              ? 'Looking…'
              : `${setupComponents.length - missing.length} of ${setupComponents.length} found`
            : 'Browser mode — cannot check your filesystem'}
        </span>
        <Button
          size="sm"
          variant="secondary"
          icon={
            <RefreshCw
              className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`}
            />
          }
          onClick={() => void scan()}
          disabled={scanning || !canDetect}
        >
          Check again
        </Button>
      </div>

      <section className="space-y-3">
        {setupComponents.map((c) => {
          const remedy = REMEDY[c.id]
          return (
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
                    <span className="text-xs text-good font-medium">Found</span>
                  )}
                </div>
                <p className="text-xs text-ink-muted leading-snug">
                  {c.description}
                </p>
                {c.detail && (
                  <p className="text-xs text-ink-faint break-all">{c.detail}</p>
                )}

                {c.status !== 'ready' && (
                  <div className="pt-2 space-y-2">
                    <p className="text-[11px] text-ink-muted leading-snug">
                      {remedy.how}
                    </p>
                    {remedy.command && (
                      <div className="flex items-center gap-1.5">
                        <code className="flex-1 text-[10px] font-mono bg-surface border border-border rounded-md px-2 py-1.5 text-ink-muted overflow-x-auto whitespace-nowrap">
                          {remedy.command}
                        </code>
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<Copy className="w-3 h-3" />}
                          onClick={() => void copyCommand(c.id)}
                        >
                          {copied === c.id ? 'Copied' : 'Copy'}
                        </Button>
                      </div>
                    )}
                    {remedy.link && (
                      <a
                        href={remedy.link}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-info hover:underline"
                      >
                        <ExternalLink className="w-3 h-3" />
                        {remedy.linkLabel ?? remedy.link}
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </section>

      <div className="mt-auto pt-2 space-y-3">
        <Button
          size="xl"
          variant={allReady ? 'good' : 'primary'}
          onClick={handleFinish}
        >
          {allReady ? 'Everything is ready — Continue' : 'Open the demo dashboard'}
        </Button>
        {!allReady && (
          <p className="text-[11px] text-ink-faint text-center leading-relaxed">
            The demo runs a simulated character. Nothing connects to the game
            until Lich and the bridge are in place.
          </p>
        )}
      </div>
    </div>
  )
}
