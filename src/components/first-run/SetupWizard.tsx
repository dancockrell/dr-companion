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
 * - Install current versions, into the folders that software normally lives
 *   in, and leave unrelated things alone.
 * - Never run anything without a separate, explicit yes.
 * - Always leave the demo open, so nobody is stuck behind a download.
 * - Never report a state we did not actually observe. A check that failed and
 *   a machine that needs nothing must not render the same.
 *
 * Reachable again from Settings once set up, because "it skipped past, what
 * did it find?" is a fair question and there was no way to ask it.
 */
// Counted from the data rather than typed into a label. The hardcoded figure
// was wrong within a day of being written.
import MAP_INDEX from '../../data/map/index.json'
import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, FolderOpen } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { Button } from '../shared/Button'
import { Preflight } from './Preflight'
import { ComponentCard, type CardState } from './ComponentCard'
import { NoobChecklist } from './NoobChecklist'
import { ConnectGuide } from './ConnectGuide'
import { DependencyStrip, type Dep } from './DependencyStrip'
import { isTauri } from '../../lib/tauri'
import {
  planSetup,
  downloadComponent,
  installBundledRuby4Lich5,
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

/**
 * What a browser can say about a machine, which is nothing.
 *
 * Listed anyway, because the point of this screen is the check and an empty
 * page communicates less than an honest row of dashes.
 */
function mapSummary(): string {
  const zones = MAP_INDEX.length
  const rooms = MAP_INDEX.reduce((n, z) => n + z.rooms, 0)
  return `${zones} zones, ${rooms.toLocaleString()} rooms, built in`
}

const BROWSER_DEPS: Dep[] = [
  { id: 'ruby', label: 'Ruby', state: 'unknown', detail: 'cannot check from a browser' },
  { id: 'lich', label: 'Lich 5', state: 'unknown', detail: 'cannot check from a browser' },
  { id: 'bridge', label: 'Companion bridge', state: 'unknown', detail: 'cannot check from a browser' },
  { id: 'maps', label: 'Map data', state: 'present', detail: mapSummary() },
]

export function SetupWizard() {
  const setSetupComplete = useAppStore((s) => s.setSetupComplete)
  const simulateConnect = useAppStore((s) => s.simulateConnect)
  const addLog = useAppStore((s) => s.addLog)
  // Opened from Settings rather than because something is missing. Changes one
  // thing: it does not skip itself when everything is present.
  const reopened = useAppStore((s) => s.setupReopened)

  const [phase, setPhase] = useState<Phase>(isTauri() ? 'checking' : 'browser')
  const [plan, setPlan] = useState<SetupPlan | null>(null)
  const [cards, setCards] = useState<Record<string, CardState>>({})
  const [dataDir, setDataDir] = useState('')
  // Why the check failed, when it did. An empty plan and a clean bill of
  // health are not the same thing and must never render the same.
  const [checkError, setCheckError] = useState<string | null>(null)
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
    setCheckError(null)
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
        if (p?.ready && !reopened) {
          addLog('All dependencies found. Connecting.')
          enter()
        } else {
          setPhase('plan')
        }
      }, wait)
    } catch (e) {
      // Keep the reason. Without it this screen has nothing to say beyond a
      // count of zero, which is what it used to show.
      const msg = e instanceof Error ? e.message : String(e)
      addLog(`Setup check failed: ${msg}`)
      setPlan(null)
      setCheckError(msg)
      setPhase('plan')
    }
  }, [addLog, enter, reopened])

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
    if (o.bundled) {
      addLog(`Installing ${o.label} ${o.version} - included with this app, no download needed`)
    } else {
      addLog(`Downloading ${o.label} ${o.version} from ${o.url}`)
      if (!o.sha256) {
        addLog(`Note: ${o.label} publishes no checksum. Verifying source only.`)
      }
    }

    try {
      // Bundled copies never touch the network path: a different command
      // resolves the file's location itself rather than trusting whatever
      // url/dest this option carries - see installBundledRuby4Lich5's doc
      // comment for why that boundary matters.
      const res = o.bundled
        ? await installBundledRuby4Lich5()
        : await downloadComponent(key, o.url, o.sha256, o.dest)
      addLog(
        o.bundled
          ? `Verified the bundled copy: sha256 ${res.sha256.slice(0, 16)}…`
          : o.sha256
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

  // Three different states, and they used to collapse into two.
  //
  // A check that failed produces no components, so `missing.length === 0` was
  // true and the screen said "Ready" over a machine it had never managed to
  // look at. "I found nothing" and "you need nothing" are opposite answers.
  const checked = plan !== null && required.length > 0
  const ready = checked && missing.length === 0

  return (
    <div className="flex flex-col p-4 gap-3">
      <header className="space-y-2 pt-1">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {phase === 'browser'
            ? 'DR Companion'
            : !checked
              ? 'Check failed'
              : ready
                ? 'Ready'
                : 'Missing pieces'}
        </h1>
        {phase !== 'browser' && !checked && (
          <p className="text-sm text-ink-muted">The check did not finish.</p>
        )}
      </header>

      {checkError && (
        <p className="text-xs text-danger leading-snug rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 font-mono">
          {checkError}
        </p>
      )}

      {plan?.dataWarning && (
        <p className="text-xs text-danger leading-snug rounded-lg border border-danger/40 bg-danger/10 px-3 py-2">
          {plan.dataWarning}
        </p>
      )}

      {plan?.offlineNote && (
        <p className="text-xs text-warn leading-snug rounded-lg border border-warn/30 bg-warn/10 px-3 py-2">
          {plan.offlineNote}
        </p>
      )}

      {phase !== 'browser' && (
        <div className="flex items-center justify-between gap-2">
          {/* "0 of 0 ready" was the old output of a failed check: technically
              true, informative to nobody, and sitting under the word Ready. */}
          <span className="text-xs text-ink-faint">
            {checked
              ? `${required.length - missing.length} of ${required.length} ready`
              : 'Nothing checked'}
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
      )}      {phase === 'browser' ? (
        <DependencyStrip deps={BROWSER_DEPS} />
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

      {/* What to sort out in the game itself, as opposed to on this machine.
        *
        * Thirteen items of new-player guidance that have been sitting in
        * data/noobChecklist.ts since it was written, rendered by a component
        * nothing mounted. Its own header said "Companion SetupWizard /
        * Standard mode can surface these", so the intent was written down and
        * simply never happened - which is the same failure as the hands
        * display, and the reason tools/mounted-test.mjs now exists.
        *
        * Here rather than on the dashboard because this is the one screen
        * somebody reads before they start, and every item is a thing you do
        * once. On the dashboard it would be permanent furniture for a player
        * who sorted all of it out months ago. */}
      <NoobChecklist />

      <div className="pt-2 space-y-2">
        <Button
          size="xl"
          variant={ready && phase !== 'browser' ? 'good' : 'primary'}
          onClick={enter}
        >
          {reopened
            ? 'Back to the dashboard'
            : ready && phase !== 'browser'
              ? 'Continue'
              : 'Open the demo dashboard'}
        </Button>
      </div>
    </div>
  )
}
