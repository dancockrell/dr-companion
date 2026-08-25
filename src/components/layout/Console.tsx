/**
 * The console, docked at the bottom.
 *
 * This exists because the next phase of this project is people breaking it.
 * The patterns the bridge matches against the game stream were read out of
 * community scripts, not confirmed against a live account, so some of them are
 * wrong. What separates that being an afternoon from being a month is whether
 * a tester can see what the game actually said when a match failed.
 *
 * So: every command sent, every reply, every failed match, in one place, with
 * a Copy button because the next thing a tester does is paste it somewhere.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Terminal,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Trash2,
  Radio,
  Bug,
} from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { ReportDialog } from './ReportDialog'

type Filter = 'all' | 'problems' | 'game'

/** Trace kinds that mean something went wrong. */
const PROBLEM_KINDS = new Set(['no_match', 'refused', 'gave_up', 'error'])

const KIND_STYLE: Record<string, string> = {
  send: 'text-info',
  reply: 'text-ink-muted',
  refused: 'text-warn',
  no_match: 'text-danger',
  gave_up: 'text-danger',
  error: 'text-danger',
}

export function Console() {
  const logLines = useAppStore((s) => s.logLines)
  const trace = useAppStore((s) => s.trace)
  const clearLog = useAppStore((s) => s.clearLog)
  const traceEnabled = useAppStore((s) => s.traceEnabled)
  const setTraceEnabled = useAppStore((s) => s.setTraceEnabled)
  const consoleOpen = useAppStore((s) => s.consoleOpen)
  const runningScripts = useAppStore((s) => s.runningScripts)
  const setConsoleOpen = useAppStore((s) => s.setConsoleOpen)

  const [filter, setFilter] = useState<Filter>('all')
  const [copied, setCopied] = useState(false)
  const [reporting, setReporting] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  // Merge the human log and the machine trace into one view, ordered by the
  // sequence they arrived in rather than by timestamp. Timestamps here are
  // second-resolution and a command and its reply routinely land in the same
  // second, so sorting by time would show them in an arbitrary order. Getting
  // that backwards is exactly what misleads someone reading a trace to work
  // out what broke.
  //
  // One pane, not two: correlating them by eye is the job the console is
  // supposed to be doing for the tester.
  const rows = useMemo(() => {
    const logRows = logLines.map((l) => ({
      key: `log-${l.seq}`,
      kind: 'log',
      text: `${l.at}  ${l.text}`,
      seq: l.seq,
    }))
    const traceRows = trace.map((t, i) => ({
      key: `tr-${t.seq ?? i}`,
      kind: t.kind,
      text: `${t.at}  ${t.kind.padEnd(8)} ${t.detail}`,
      seq: t.seq ?? 0,
    }))
    const all = [...logRows, ...traceRows].sort((a, b) => a.seq - b.seq)
    if (filter === 'problems') {
      return all.filter((r) => PROBLEM_KINDS.has(r.kind))
    }
    if (filter === 'game') {
      return all.filter((r) => r.kind !== 'log')
    }
    return all
  }, [logLines, trace, filter])

  // Oldest first and pinned to the bottom, the way a console reads. A trace is
  // a sequence, and you follow a sequence forwards.
  const ordered = rows

  useEffect(() => {
    if (!consoleOpen) return
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [ordered.length, consoleOpen])

  const problemCount = useMemo(
    () => trace.filter((t) => PROBLEM_KINDS.has(t.kind)).length,
    [trace]
  )

  async function copyAll() {
    // Already oldest-first, which is the order a bug report should read in.
    const text = ordered.map((r) => r.text).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard can be refused. Not worth an error state in a debug view.
    }
  }

  return (
    <>
    <div className="shrink-0 border-t border-border bg-surface-raised/95">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink"
          onClick={() => setConsoleOpen(!consoleOpen)}
        >
          <Terminal className="w-3.5 h-3.5" />
          Console
          {consoleOpen ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronUp className="w-3 h-3" />
          )}
        </button>

        {runningScripts.length > 0 && (
          <span className="text-xs text-accent truncate max-w-[40%]">
            running: {runningScripts.join(', ')}
          </span>
        )}

        {problemCount > 0 && (
          // The nudge. Something failed, and turning that into a report should
          // be the nearest thing to hand rather than a menu away.
          <button
            type="button"
            className="text-xs text-danger hover:underline flex items-center gap-1"
            onClick={() => setReporting(true)}
            title="Report this"
          >
            <Bug className="w-3 h-3" />
            {problemCount} problem{problemCount > 1 ? 's' : ''} — report?
          </button>
        )}

        <div className="flex-1" />

        {consoleOpen && (
          <>
            <div className="flex gap-0.5">
              {(['all', 'problems', 'game'] as Filter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`text-xs rounded px-1.5 py-0.5 ${
                    filter === f
                      ? 'bg-accent/15 text-accent'
                      : 'text-ink-faint hover:text-ink-muted'
                  }`}
                  onClick={() => setFilter(f)}
                >
                  {f}
                </button>
              ))}
            </div>

            <button
              type="button"
              className={`text-xs flex items-center gap-1 rounded px-1.5 py-0.5 ${
                traceEnabled
                  ? 'bg-good/15 text-good'
                  : 'text-ink-faint hover:text-ink-muted'
              }`}
              onClick={() => setTraceEnabled(!traceEnabled)}
              title="Record every command, reply and failed match from the bridge"
            >
              <Radio className="w-3 h-3" />
              trace
            </button>

            <button
              type="button"
              className="text-xs flex items-center gap-1 text-ink-faint hover:text-ink"
              onClick={() => void copyAll()}
              title="Copy everything here, for pasting into a bug report"
            >
              {copied ? (
                <Check className="w-3 h-3 text-good" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
              {copied ? 'copied' : 'copy'}
            </button>

            <button
              type="button"
              className="text-xs flex items-center gap-1 text-ink-faint hover:text-ink"
              onClick={() => setReporting(true)}
              title="Turn the last few minutes into a bug report"
            >
              <Bug className="w-3 h-3" />
              report
            </button>

            <button
              type="button"
              className="text-xs text-ink-faint hover:text-danger"
              onClick={clearLog}
              title="Clear"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </>
        )}
      </div>

      {consoleOpen && (
        <div
          ref={bodyRef}
          className="h-44 overflow-y-auto px-3 pb-2 space-y-0.5 text-xs font-mono border-t border-border/50"
        >
          {ordered.length === 0 && (
            <div className="text-ink-faint pt-2">
              Nothing yet.{' '}
              {!traceEnabled &&
                'Turn on trace to record what the bridge sends and what the game says back.'}
            </div>
          )}
          {ordered.map((r) => (
            <div
              key={r.key}
              className={`leading-snug whitespace-pre-wrap break-words ${
                KIND_STYLE[r.kind] ?? 'text-ink-muted'
              }`}
            >
              {r.text}
            </div>
          ))}
        </div>
      )}
    </div>
    {reporting && <ReportDialog onClose={() => setReporting(false)} />}
    </>
  )
}
