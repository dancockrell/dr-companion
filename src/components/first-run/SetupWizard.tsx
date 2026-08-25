/**
 * First run.
 *
 * Lich has a reputation for being hard to get started with, and the reason is
 * usually that a new player is handed a dependency problem before they have
 * seen anything working. This screen tries to take that on:
 *
 * - Check first, silently, behind a title screen.
 * - If everything is there, do not make them read anything. Go.
 * - If something is missing, say exactly what, offer to fetch it, and show
 *   where it comes from and what will happen to it.
 * - Never touch a Ruby they already have.
 * - Never run anything without a separate, explicit yes.
 * - Always leave the demo open, so nobody is stuck behind a download.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, FolderOpen } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { Button } from '../shared/Button'
import { NoobChecklist } from './NoobChecklist'
import { Preflight } from './Preflight'
import { ComponentCard, type CardState } from './ComponentCard'
import { ConnectGuide } from './ConnectGuide'
import { bridgeCommand } from '../../lib/frontends'
import { isTauri } from '../../lib/tauri'
import {
  planSetup,
  downloadComponent,
  extractArchive,
  installBridgeScript,
  installBundle,
  runInstaller,
  revealFile,
  onSetupProgress,
  appDataPath,
  type SetupPlan,
  type DownloadOption,
} from '../../lib/setup'

type Phase = 'checking' | 'plan' | 'browser'

export function SetupWizard() {
  const setSetupComplete = useAppStore((s) => s.setSetupComplete)
  const simulateConnect = useAppStore((s) => s.simulateConnect)
  const addLog = useAppStore((s) => s.addLog)
  const frontend = useAppStore((s) => s.frontend)

  const [phase, setPhase] = useState<Phase>(isTauri() ? 'checking' : 'browser')
  const [plan, setPlan] = useState<SetupPlan | null>(null)
  const [cards, setCards] = useState<Record<string, CardState>>({})
  const [dataDir, setDataDir] = useState('')
  // Stamped when the check starts, not during render.
  const startedAt = useRef(0)

  const enter = useCallback(() => {
    setSetupComplete(true)
    simulateConnect()
  }, [setSetupComplete, simulateConnect])

  const check = useCallback(async () => {
    if (!isTauri()) {
      setPhase('browser')
      return
    }
    setPhase('checking')
    startedAt.current = Date.now()
    try {
      const p = await planSetup()
      setPlan(p)
      setDataDir(await appDataPath())

      // Do not flash the title screen. If the check was instant, let it be
      // seen for a beat rather than blinking past.
      const elapsed = Date.now() - startedAt.current
      const wait = Math.max(0, 900 - elapsed)
      window.setTimeout(() => {
        if (p?.ready) {
          addLog('All dependencies found. Connecting.')
          enter()
        } else {
          setPhase('plan')
        }
      }, wait)
    } catch (e) {
      addLog(`Setup check failed: ${e instanceof Error ? e.message : String(e)}`)
      setPhase('plan')
    }
  }, [addLog, enter])

  useEffect(() => {
    void check()
  }, [check])

  // Progress events from the native downloader.
  useEffect(() => {
    return onSetupProgress((p) => {
      setCards((c) => ({ ...c, [p.id]: { ...c[p.id], progress: p } }))
    })
  }, [])

  function handleChoose(componentId: string, optionId: string) {
    setCards((c) => ({
      ...c,
      [componentId]: { ...c[componentId], chosen: optionId },
    }))
  }

  async function handleDownload(componentId: string, o: DownloadOption) {
    // Progress events are keyed per option so two cards cannot cross wires.
    const key = `${componentId}:${o.id}`
    setCards((c) => ({
      ...c,
      [componentId]: { ...c[componentId], busy: true, error: undefined },
    }))
    addLog(`Downloading ${o.label} ${o.version} from ${o.url}`)
    if (!o.sha256) {
      addLog(`Note: ${o.label} publishes no checksum. Verifying source only.`)
    }

    try {
      const res = await downloadComponent(key, o.url, o.sha256, o.dest)
      addLog(
        o.sha256
          ? `Verified ${o.label}: sha256 ${res.sha256.slice(0, 16)}…`
          : `Downloaded ${o.label}: sha256 ${res.sha256.slice(0, 16)}… (ours, not upstream's)`
      )

      if (o.after === 'extract') {
        const target = componentId === 'lich' ? 'lich' : componentId
        const expect = componentId === 'lich' ? 'lich.rbw' : undefined
        const dir = await extractArchive(res.path, target, expect)
        setCards((c) => ({
          ...c,
          [componentId]: {
            ...c[componentId],
            busy: false,
            downloadedFor: o.id,
            done: `Installed to ${dir}`,
          },
        }))
        addLog(`Installed ${o.label} to ${dir}`)
        await check()
      } else {
        setCards((c) => ({
          ...c,
          [componentId]: {
            ...c[componentId],
            busy: false,
            downloadedFor: o.id,
            downloadedPath: res.path,
            done: `Verified and saved to ${res.path}`,
          },
        }))
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setCards((c) => ({
        ...c,
        [componentId]: { ...c[componentId], busy: false, error: msg },
      }))
      addLog(`Download failed: ${msg}`)
    }
  }


  async function handleInstallBundle(componentId: string) {
    const comp = plan?.components.find((c) => c.id === componentId)
    if (!comp || comp.remedy.kind !== 'bundle') return
    const r = comp.remedy

    setCards((c) => ({
      ...c,
      [componentId]: { ...c[componentId], busy: true, error: undefined },
    }))
    addLog(`Installing ${r.label} to ${r.target}, verifying each file`)

    try {
      const msg = await installBundle(componentId, r.files, r.target)
      setCards((c) => ({
        ...c,
        [componentId]: { ...c[componentId], busy: false, done: msg },
      }))
      addLog(msg)
      await check()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setCards((c) => ({
        ...c,
        [componentId]: { ...c[componentId], busy: false, error: msg },
      }))
      addLog(`Install failed: ${msg}`)
    }
  }

  async function handleInstallBridge() {
    setCards((c) => ({
      ...c,
      bridge: { ...c.bridge, busy: true, error: undefined },
    }))
    try {
      const dest = await installBridgeScript()
      setCards((c) => ({
        ...c,
        bridge: { ...c.bridge, busy: false, done: `Installed to ${dest}` },
      }))
      addLog(`Bridge script installed to ${dest}`)
      await check()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setCards((c) => ({ ...c, bridge: { ...c.bridge, busy: false, error: msg } }))
      addLog(`Bridge install failed: ${msg}`)
    }
  }

  async function handleRunInstaller(path: string) {
    try {
      await runInstaller(path)
      addLog(`Started ${path}. Press Check again when it finishes.`)
    } catch (e) {
      addLog(`Could not start installer: ${e instanceof Error ? e.message : e}`)
    }
  }

  if (phase === 'checking') {
    return <Preflight onSkip={enter} />
  }

  const required = plan?.components.filter((c) => c.required) ?? []
  const lichPresent =
    plan?.components.find((c) => c.id === 'lich')?.presence === 'present'
  // Detection reports the folder containing lich.rbw, and #config lichpath
  // wants the file. Getting this wrong is one of the causes of the
  // connect-retry loop, so hand them the exact string.
  const lichDir = plan?.components.find((c) => c.id === 'lich')?.path ?? null
  const lichRbwPath = lichDir ? `${lichDir}\lich.rbw` : null

  const missing = required.filter((c) => c.presence !== 'present')

  return (
    <div className="min-h-full flex flex-col p-5 gap-4 max-w-lg mx-auto">
      <header className="space-y-2 pt-1">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {phase === 'browser'
            ? 'Welcome to DR Companion'
            : missing.length === 0
              ? 'Ready'
              : 'A couple of things are missing'}
        </h1>
        <p className="text-ink-muted text-sm leading-relaxed">
          {phase === 'browser'
            ? 'Running in a browser, so there is no way to check your machine or install anything. The demo works fully here. For live play, use the desktop app.'
            : 'Nothing is downloaded until you ask. Anything we do fetch is checked against the checksum GitHub publishes, and goes in this app’s own folder, not over anything you already have.'}
        </p>
      </header>

      {plan?.offlineNote && (
        <p className="text-[11px] text-warn leading-snug rounded-lg border border-warn/30 bg-warn/10 px-3 py-2">
          {plan.offlineNote}
        </p>
      )}

      {phase !== 'browser' && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-ink-faint">
            {required.length - missing.length} of {required.length} ready
          </span>
          <div className="flex gap-1.5">
            {dataDir && (
              <Button
                size="sm"
                variant="ghost"
                icon={<FolderOpen className="w-3.5 h-3.5" />}
                onClick={() => void revealFile(dataDir)}
                title={dataDir}
              >
                App folder
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              icon={<RefreshCw className="w-3.5 h-3.5" />}
              onClick={() => void check()}
            >
              Check again
            </Button>
          </div>
        </div>
      )}

      {phase === 'browser' ? (
        <NoobChecklist />
      ) : (
        <section className="space-y-3">
          {plan?.components.map((c) => (
            <ComponentCard
              key={c.id}
              plan={c}
              state={cards[c.id] ?? {}}
              onChoose={(oid) => handleChoose(c.id, oid)}
              onDownload={(o) => void handleDownload(c.id, o)}
              onRunInstaller={(p) => void handleRunInstaller(p)}
              onReveal={(p) => void revealFile(p)}
              onInstallBridge={() => void handleInstallBridge()}
              onInstallBundle={() => void handleInstallBundle(c.id)}
              canInstallBridge={lichPresent}
            />
          ))}
        </section>
      )}

      {/* Both installed is not the same as both talking to each other. */}
      {/* Shown once Lich exists. The frontend does not have to be Genie: this
          app is a panel for Lich, and Lich works with whatever you use. */}
      {phase !== 'browser' && lichPresent && (
        <ConnectGuide lichPath={lichRbwPath} />
      )}

      <div className="mt-auto pt-2 space-y-2">
        <Button
          size="xl"
          variant={missing.length === 0 && phase !== 'browser' ? 'good' : 'primary'}
          onClick={enter}
        >
          {missing.length === 0 && phase !== 'browser'
            ? 'Continue'
            : 'Open the demo dashboard'}
        </Button>
        <p className="text-[11px] text-ink-faint text-center leading-relaxed">
          {missing.length === 0 && phase !== 'browser'
            ? `Start the bridge in game with ${bridgeCommand(frontend)}, then switch to Live Lich in Settings.`
            : 'The demo runs a simulated character and needs none of the above. You can set the rest up whenever.'}
        </p>
      </div>
    </div>
  )
}
