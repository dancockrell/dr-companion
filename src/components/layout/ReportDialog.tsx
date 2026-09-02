/**
 * Report a problem, in two clicks.
 *
 * The whole point is that the preview is the product. A tester who can see
 * exactly what is about to be posted publicly will send reports; one who has
 * to trust an opaque uploader will not, and should not.
 *
 * Nothing is transmitted from here. The GitHub button opens a prefilled issue
 * form in their browser, on their account, which they submit or abandon.
 */
import { useMemo, useState } from 'react'
import { X, Copy, Check, ExternalLink, Save, ShieldCheck } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { Button } from '../shared/Button'
import { buildReport, issueUrl } from '../../lib/bugReport'
import { APP_VERSION } from '../../lib/versions'
import { useModalDialog } from '../../lib/useModalDialog'


export function ReportDialog({ onClose }: { onClose: () => void }) {
  const character = useAppStore((s) => s.character)
  const trace = useAppStore((s) => s.trace)
  const logLines = useAppStore((s) => s.logLines)
  const bridgeMode = useAppStore((s) => s.bridgeMode)
  const versions = useAppStore((s) => s.versions)
  const addLog = useAppStore((s) => s.addLog)

  const [description, setDescription] = useState('')
  const [windowMinutes, setWindowMinutes] = useState(5)
  const [redactNames, setRedactNames] = useState(true)
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  const report = useMemo(
    () =>
      buildReport({
        description,
        character,
        trace,
        logLines,
        bridgeMode,
        appVersion: APP_VERSION,
        versions,
        windowMinutes,
        redactNames,
      }),
    [description, character, trace, logLines, bridgeMode, versions, windowMinutes, redactNames]
  )

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(report.full)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      addLog('Could not reach the clipboard.')
    }
  }

  function saveReport() {
    // A local file is the fallback for anyone without a GitHub account, and
    // the home for the untrimmed version when the issue body had to be cut.
    const blob = new Blob([report.full], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    a.href = url
    a.download = `dr-companion-report-${stamp}.md`
    a.click()
    URL.revokeObjectURL(url)
    setSaved(a.download)
    addLog(`Saved ${a.download}`)
  }

  const trimmed = report.body.length < report.full.length
  const dialogRef = useModalDialog(onClose)

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-scrim p-3"
      data-gameplay-shortcuts="suspend"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        tabIndex={-1}
        className="w-full max-w-md rounded-2xl border border-border bg-surface shadow-2xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <h2 id="report-title" className="text-sm font-semibold text-ink">Report a problem</h2>
          <button
            type="button"
            className="p-1 rounded-md text-ink-faint hover:text-ink"
            onClick={onClose}
            title="Close" aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          <div className="space-y-1.5">
            <label className="text-xs text-ink-muted" htmlFor="report-desc">
              What happened? One line is plenty.
            </label>
            <textarea
              id="report-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Pressed Stop while stunned and nothing happened"
              className="w-full text-xs bg-surface-overlay border border-border rounded-lg px-2 py-1.5 text-ink resize-none"
            />
          </div>

          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5 text-ink-muted">
              Last
              <select
                className="bg-surface-overlay border border-border rounded px-1.5 py-0.5 text-ink"
                value={windowMinutes}
                onChange={(e) => setWindowMinutes(Number(e.target.value))}
              >
                <option value={2}>2 min</option>
                <option value={5}>5 min</option>
                <option value={15}>15 min</option>
                <option value={999}>everything</option>
              </select>
            </label>

            <label className="flex items-center gap-1.5 text-ink-muted">
              <input
                type="checkbox"
                checked={redactNames}
                onChange={(e) => setRedactNames(e.target.checked)}
              />
              Hide other players
            </label>
          </div>

          <div className="rounded-lg border border-good/30 bg-good/5 px-2.5 py-2 space-y-1">
            <p className="text-xs text-good flex items-start gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                Nothing is sent from here. This opens a GitHub issue with the
                text below already filled in, on your account, for you to submit
                or abandon.
              </span>
            </p>
            {report.removed.length > 0 && (
              <p className="text-xs text-ink-muted pl-5">
                Redacted automatically: {report.removed.join(', ')}. Tells, ESP
                thoughts and channel chatter never go in.
              </p>
            )}
          </div>

          {/*
            A GitHub issue is public and stays public. Community spaces around
            this game are read by more people than post in them, and a trace
            is a timestamped record of what your character was doing. That is
            worth one sentence before someone posts one, not a footnote after.
          */}
          <p className="text-xs text-warn leading-snug rounded-lg border border-warn/30 bg-warn/10 px-2.5 py-2">
            A GitHub issue is public and permanent. Read the preview and cut
            anything you would rather not have on the internet under your name.
            Save the file instead if you would rather send it privately.
          </p>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-ink-muted">
                Exactly what will be posted
              </span>
              <span className="text-xs text-ink-faint">
                {report.problems.length} failure
                {report.problems.length === 1 ? '' : 's'} ·{' '}
                {Math.round(report.full.length / 1024)} KB
              </span>
            </div>
            <pre className="max-h-48 overflow-auto rounded-lg border border-border bg-surface-raised p-2 text-xs font-mono text-ink-muted whitespace-pre-wrap break-words">
              {report.body}
            </pre>
            {trimmed && (
              <p className="text-xs text-warn leading-snug">
                Too long for a prefilled issue, so the middle was trimmed. Save
                the file as well and attach it: it has everything.
              </p>
            )}
            {saved && (
              <p className="text-xs text-good">Saved {saved}</p>
            )}
          </div>
        </div>

        <div className="p-4 pt-0 space-y-2 shrink-0">
          <a
            href={issueUrl(report)}
            target="_blank"
            rel="noreferrer"
            onClick={() => addLog('Opened a prefilled GitHub issue.')}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-accent text-surface font-semibold px-4 py-3 hover:bg-accent-soft"
          >
            <ExternalLink className="w-4 h-4" />
            Open a GitHub issue
          </a>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              className="flex-1 justify-center"
              icon={copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              onClick={() => void copyReport()}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="flex-1 justify-center"
              icon={<Save className="w-3.5 h-3.5" />}
              onClick={saveReport}
            >
              Save file
            </Button>
          </div>
          <p className="text-xs text-ink-faint text-center leading-snug">
            No GitHub account? Save the file and post it wherever suits.
          </p>
        </div>
      </div>
    </div>
  )
}
