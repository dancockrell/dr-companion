import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, ExternalLink, RefreshCw } from 'lucide-react'
import { isTauri } from '../../lib/tauri.ts'
import { launchViewer, viewerExitNote, viewerStatus, type ViewerStatus } from '../../lib/viewerClient.ts'
import { useAppStore } from '../../store/useAppStore.ts'

/** The play surface owns the launch control; setup diagnostics stay in Settings. */
export function WorldViewerControl() {
  const native = isTauri()
  const demo = useAppStore((s) => s.bridgeMode === 'mock')
  const connected = useAppStore((s) => s.bridgeConnected)
  const [viewer, setViewer] = useState<ViewerStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)
  const mounted = useRef(false)
  const opening = useRef(false)
  const generation = useRef(0)

  const check = useCallback(async () => {
    if (!native) return
    const request = ++generation.current
    try {
      const status = await viewerStatus()
      if (mounted.current && request === generation.current) { setViewer(status); setCheckError(null) }
    } catch (error) {
      if (mounted.current && request === generation.current) {
        setCheckError(`Could not check the 3D view: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }, [native])

  const invalidateRequests = useCallback(() => {
    mounted.current = false
    generation.current++
  }, [])

  useEffect(() => {
    mounted.current = true
    void Promise.resolve().then(check)
    // Closing the separate viewer must make Relaunch available without a reload.
    const timer = native ? window.setInterval(() => { if (!opening.current) void check() }, 3000) : undefined
    window.addEventListener('focus', check)
    return () => {
      invalidateRequests()
      window.clearInterval(timer)
      window.removeEventListener('focus', check)
    }
  }, [check, native, invalidateRequests])

  async function open() {
    // A synchronous guard covers repeated activation before React paints disabled.
    if (opening.current || !viewer?.installed || !viewer.runningKnown || viewer.running) return
    opening.current = true
    setBusy(true)
    setNote(null)
    try {
      await launchViewer()
    } catch (error) {
      if (mounted.current) setNote(`Could not open the 3D view: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      opening.current = false
      if (mounted.current) {
        setBusy(false)
        void check()
      }
    }
  }

  const exit = viewerExitNote(viewer)
  const state = !native ? 'Desktop app required' : !viewer ? 'Checking availability…'
    : !viewer.installed ? 'Not included in this build' : viewer.running ? 'Open in a separate window'
    : !viewer.runningKnown ? 'Installed · could not check whether open' : exit ? 'Ready to reopen' : 'Ready to explore'
  const source = demo ? 'Demo world' : connected ? 'Live world' : 'Waiting for your game'

  return (
    <section aria-label="3D world viewer" className="rounded border border-accent/30 bg-surface-raised px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Box className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-ink">3D tabletop <span className="font-normal text-ink-faint">· {source}</span></p>
          <p className="text-xs text-ink-muted" role="status">{state}</p>
        </div>
        <button type="button" onClick={() => void open()}
          disabled={!native || !viewer?.installed || !viewer.runningKnown || viewer.running || busy}
          className="flex shrink-0 items-center gap-1.5 rounded border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-accent/20 disabled:opacity-50">
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          {busy ? 'Opening…' : viewer?.running ? '3D view open' : exit ? 'Reopen 3D view' : 'Open 3D view'}
        </button>
        {native && <button type="button" onClick={() => { setNote(null); void check() }} disabled={busy}
          aria-label="Refresh 3D viewer status" title="Refresh 3D viewer status"
          className="rounded p-1.5 text-ink-muted hover:text-ink disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" /></button>}
      </div>
      {exit && <p className="mt-1.5 text-xs text-ink-muted" role="status">{exit}</p>}
      {checkError && <p className="mt-1.5 text-xs text-danger" role="alert">{checkError}</p>}
      {note && <p className="mt-1.5 text-xs text-ink-muted" role="status">{note}</p>}
      {viewer && !viewer.installed && <p className="mt-1.5 text-xs text-ink-muted">This app can still play the game. Install a build that includes the 3D viewer to explore the tabletop.</p>}
    </section>
  )
}
