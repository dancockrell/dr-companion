/**
 * The Quick Queue: cue a command or a script, in order, run them one at a
 * time — Dan's ask, close to verbatim: "build new simple flows on the fly,
 * cue actions to send to the browser, cue scripts and manage them one at a
 * time, quick use what we can."
 *
 * Distinct from Task Flows on purpose. A Task Flow is named, saved, and
 * reused; this is thrown together for the situation in front of you right
 * now and thrown away once it runs — no name, no save step, no settle
 * timing to configure, just "these things, in this order, go."
 */
import { useEffect, useRef, useState } from 'react'
import { ListOrdered, Play, Square, Trash2, ArrowUp, ArrowDown, X } from 'lucide-react'
import { QueueDriver, type QueueItem, type QueueState } from '../../lib/queueDriver'
import { sendGame } from '../../lib/gameLink'
import { useAppStore } from '../../store/useAppStore'
import { cn } from '../../lib/cn'

let nextId = 0
const freshId = () => `q${Date.now().toString(36)}-${nextId++}`

export function QuickQueuePanel({ dense = false }: { dense?: boolean }) {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [state, setState] = useState<QueueState>({ status: 'idle', index: -1, total: 0 })
  const [commandText, setCommandText] = useState('')
  const [scriptText, setScriptText] = useState('')

  const addLog = useAppStore((s) => s.addLog)
  const startScript = useAppStore((s) => s.startScript)
  const scriptCatalog = useAppStore((s) => s.scriptCatalog)

  const driver = useRef<QueueDriver | null>(null)
  if (!driver.current) {
    driver.current = new QueueDriver({
      // The same path the command line uses, per Dan's own wording — "cue
      // actions to send to the browser" — not the bridge's run_macro, which
      // is what Task Flows use. Different queue, different path on purpose.
      sendCommand: (c) => void sendGame(c),
      startScript,
      onChange: setState,
      log: addLog,
    })
  }

  // The timer outlives the component otherwise, same reasoning as
  // TaskFlowPanel and every other driver in this app.
  useEffect(() => () => driver.current?.dispose(), [])

  const running = state.status === 'running'

  function addCommand() {
    const value = commandText.trim()
    if (!value) return
    setQueue((q) => [...q, { id: freshId(), kind: 'command', label: value, value }])
    setCommandText('')
  }

  function addScript() {
    const value = scriptText.trim()
    if (!value) return
    setQueue((q) => [...q, { id: freshId(), kind: 'script', label: value, value }])
    setScriptText('')
  }

  function remove(id: string) {
    setQueue((q) => q.filter((item) => item.id !== id))
  }

  function move(id: string, delta: number) {
    setQueue((q) => {
      const i = q.findIndex((item) => item.id === id)
      const j = i + delta
      if (i < 0 || j < 0 || j >= q.length) return q
      const next = [...q]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  function run() {
    if (queue.length === 0 || running) return
    driver.current?.start(queue)
  }

  function stop() {
    driver.current?.stop()
  }

  function clear() {
    if (running) driver.current?.stop()
    setQueue([])
  }

  const currentId = running ? queue[state.index]?.id : null

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <h2 className="flex items-center gap-1.5 font-medium text-ink-faint uppercase tracking-wider">
          <ListOrdered className="w-3.5 h-3.5" />
          Quick Queue
        </h2>
        {state.total > 0 && (
          <span className={cn('text-xs', running ? 'text-accent' : 'text-ink-faint')}>
            {running
              ? `${state.index + 1} of ${state.total}`
              : state.status === 'done'
                ? 'done'
                : state.status === 'stopped'
                  ? 'stopped'
                  : ''}
          </span>
        )}
      </div>

      {/* Add a raw command — the same thing you'd type into the command
          line, cued for later instead of sent right now. */}
      <div className="flex gap-1">
        <input
          value={commandText}
          onChange={(e) => setCommandText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addCommand()}
          placeholder="Cue a command…"
          className="min-w-0 flex-1 rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-xs text-ink placeholder:text-ink-faint"
        />
        <button
          type="button"
          onClick={addCommand}
          disabled={!commandText.trim()}
          className="shrink-0 rounded border border-border px-2 text-xs text-ink-muted hover:text-ink disabled:opacity-40"
        >
          + Add
        </button>
      </div>

      {/* Add a script by name — fire-and-forget, per the module comment: the
          queue does not wait for a script to finish before moving on. */}
      <div className="flex gap-1">
        <input
          value={scriptText}
          onChange={(e) => setScriptText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addScript()}
          list="quick-queue-scripts"
          placeholder="Cue a script by name…"
          className="min-w-0 flex-1 rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-xs text-ink placeholder:text-ink-faint"
        />
        <datalist id="quick-queue-scripts">
          {(scriptCatalog ?? []).map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <button
          type="button"
          onClick={addScript}
          disabled={!scriptText.trim()}
          className="shrink-0 rounded border border-border px-2 text-xs text-ink-muted hover:text-ink disabled:opacity-40"
        >
          + Script
        </button>
      </div>

      {queue.length === 0 ? (
        <p className="text-xs text-ink-faint leading-snug">
          Nothing cued. Add a command or a script above, then Run.
        </p>
      ) : (
        <ul className="space-y-0.5">
          {queue.map((item, i) => (
            <li
              key={item.id}
              className={cn(
                'flex items-center gap-1 rounded border px-1.5 text-xs',
                dense ? 'py-0.5' : 'py-1',
                item.id === currentId
                  ? 'border-accent/50 bg-accent/10 text-accent'
                  : 'border-border bg-surface-raised text-ink-muted'
              )}
            >
              <span className="w-4 shrink-0 text-right tabular-nums text-ink-faint">{i + 1}</span>
              <span
                className={cn(
                  'shrink-0 rounded px-1 text-xs font-semibold uppercase',
                  item.kind === 'script' ? 'bg-accent/15 text-accent' : 'bg-ink-faint/15 text-ink-faint'
                )}
              >
                {item.kind === 'script' ? 'script' : 'cmd'}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono">{item.label}</span>
              {!running && (
                <>
                  <button
                    type="button"
                    onClick={() => move(item.id, -1)}
                    disabled={i === 0}
                    className="shrink-0 text-ink-faint hover:text-ink disabled:opacity-30"
                    title="Move earlier"
                  >
                    <ArrowUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(item.id, 1)}
                    disabled={i === queue.length - 1}
                    className="shrink-0 text-ink-faint hover:text-ink disabled:opacity-30"
                    title="Move later"
                  >
                    <ArrowDown className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(item.id)}
                    className="shrink-0 text-ink-faint hover:text-danger"
                    title="Remove"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Always shown, unlike other panels' `dense` gate on secondary text —
          Run/Stop/Clear are the panel's entire purpose, not decoration to
          trim in the tighter mode. Power always mounts this with dense=true
          (see DashboardLayout.tsx), so gating these on `dense` the way a
          summary line is gated elsewhere would have made the panel
          unusable in the one mode it actually ships in. */}
      <div className="flex gap-1">
        {running ? (
            <button
              type="button"
              onClick={stop}
              className="flex-1 flex items-center justify-center gap-1 rounded border border-danger/40 bg-danger/15 px-2 py-1 font-semibold text-danger text-xs"
            >
              <Square className="h-3 w-3" />
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={run}
              disabled={queue.length === 0}
              className="flex-1 flex items-center justify-center gap-1 rounded border border-accent/40 bg-accent/15 px-2 py-1 font-semibold text-accent text-xs disabled:opacity-40"
            >
              <Play className="h-3 w-3" />
              Run queue
            </button>
          )}
        <button
          type="button"
          onClick={clear}
          disabled={queue.length === 0}
          className="shrink-0 rounded border border-border px-2 text-ink-faint hover:text-danger disabled:opacity-40"
          title="Clear the queue"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
