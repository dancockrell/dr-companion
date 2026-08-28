/**
 * One box, every reachable action: any script Lich can run, any Task Flow,
 * the safety controls, a few app-level toggles. Ctrl+K / Cmd+K, the shortcut
 * every command palette in daily use (VS Code, Linear, Slack, GitHub, Raycast)
 * already trained a player to reach for — the point is not to teach a new
 * habit, it's to answer the one they already have.
 *
 * Deliberately shallow. This does not replace the Script Library's
 * categorised, always-visible grid (that's for browsing what exists) or the
 * Task Flow panel's per-step progress (that's for watching one run) — it's
 * the fast path for someone who already knows what they want and does not
 * want to go find the panel it lives in.
 *
 * Extensible the ordinary way: `buildCommands()` is one function returning
 * one flat list. A new command source is a new `.map()` call added to it,
 * not a new subsystem.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, CornerDownLeft } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { getScriptCatalogEntry } from '../../data/scriptCatalog'
import { allFlows, loadCustomFlows } from '../../data/taskFlows'
import {
  requestStopAll,
  requestPauseAll,
  requestResumeAll,
  requestStartFlow,
} from '../../lib/flowStop'
import { KEYBINDING_HELP } from '../../lib/keybindings'

interface Command {
  id: string
  label: string
  hint?: string
  group: 'Safety' | 'Task Flows' | 'Scripts' | 'App'
  run: () => void
}

/**
 * Cheapest useful ranking: does it match at all, and how early.
 *
 * `-Infinity` for "no match", not `-1` — an earlier version used `-1` as
 * that sentinel, which is indistinguishable from a genuine match at index 1
 * once combined with the hint's -1000 offset below. `Math.max(-1, -1001)`
 * is `-1`, which is a real number greater than the filter's threshold, so
 * every command that matched neither field still passed it. The palette
 * "worked" in the sense that it opened, took input, and rendered a list —
 * it just never actually filtered anything, which is the kind of failure
 * that looks like success until someone types a specific query and reads
 * the result rather than just the fact that a result appeared.
 */
function score(query: string, target: string): number {
  const i = target.toLowerCase().indexOf(query)
  return i < 0 ? -Infinity : -i // earlier match ranks higher; index 0 beats any later one
}

function buildCommands(deps: {
  scriptCatalog: string[] | null
  requestIntent: (intent: string, args?: Record<string, unknown>) => void
  startScript: (name: string) => void
  uiMode: string
  setUiMode: (m: 'basic' | 'power') => void
  openSetup: () => void
  addLog: (line: string) => void
}): Command[] {
  const commands: Command[] = [
    {
      id: 'safety:stop_all',
      label: 'Stop all',
      hint: 'Stop every script the Companion started, including a running Task Flow',
      group: 'Safety',
      run: () => {
        deps.requestIntent('stop_all')
        requestStopAll()
      },
    },
    {
      id: 'safety:pause',
      label: 'Pause',
      hint: 'Hold automation where it is',
      group: 'Safety',
      run: () => {
        deps.requestIntent('pause')
        requestPauseAll()
      },
    },
    {
      id: 'safety:resume',
      label: 'Resume',
      hint: 'Carry on from where it paused',
      group: 'Safety',
      run: () => {
        deps.requestIntent('resume')
        requestResumeAll()
      },
    },
  ]

  for (const flow of allFlows(loadCustomFlows())) {
    commands.push({
      id: `flow:${flow.id}`,
      label: flow.title,
      hint: flow.summary,
      group: 'Task Flows',
      run: () => requestStartFlow(flow.id),
    })
  }

  for (const name of deps.scriptCatalog ?? []) {
    const entry = getScriptCatalogEntry(name)
    if (entry.tier === 'hidden') continue
    commands.push({
      id: `script:${name}`,
      label: entry.label ?? name,
      hint: entry.realControl
        ? `${entry.category} — has its own control: ${entry.realControl}`
        : entry.description
          ? `${entry.category} — ${entry.description}`
          : entry.category,
      group: 'Scripts',
      run: () => deps.startScript(name),
    })
  }

  commands.push(
    {
      id: 'app:toggle-mode',
      label: deps.uiMode === 'power' ? 'Switch to Basic mode' : 'Switch to Power mode',
      hint: 'Explains itself vs. assumes you know it',
      group: 'App',
      run: () => deps.setUiMode(deps.uiMode === 'power' ? 'basic' : 'power'),
    },
    {
      id: 'app:open-setup',
      label: 'Open Setup',
      hint: 'Dependencies, bridge connection, map data',
      group: 'App',
      run: () => deps.openSetup(),
    },
    {
      id: 'app:keyboard-shortcuts',
      label: 'Keyboard shortcuts',
      hint: 'NumPad movement, F-key commands, Escape to stop',
      group: 'App',
      // The console, not a new panel: DESIGN.md is explicit that the console
      // is never demoted, and a key that does something the player cannot
      // discover is worse than no key — this is that discovery, without
      // inventing a surface for something six short lines cover.
      run: () => KEYBINDING_HELP.forEach((line) => deps.addLog(line)),
    }
  )

  return commands
}

const GROUP_ORDER: Command['group'][] = ['Safety', 'Task Flows', 'Scripts', 'App']

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const scriptCatalog = useAppStore((s) => s.scriptCatalog)
  const requestIntent = useAppStore((s) => s.requestIntent)
  const startScript = useAppStore((s) => s.startScript)
  const uiMode = useAppStore((s) => s.uiMode)
  const setUiMode = useAppStore((s) => s.setUiMode)
  const openSetup = useAppStore((s) => s.openSetup)
  const addLog = useAppStore((s) => s.addLog)

  // Global, because the whole point is that it works from wherever you
  // already are. Ctrl on Windows/Linux, Cmd on macOS — Tauri ships on both.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
        return
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
      // Next tick: the input is not yet in the DOM the same frame `open` flips.
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const commands = useMemo(
    () => buildCommands({ scriptCatalog, requestIntent, startScript, uiMode, setUiMode, openSetup, addLog }),
    [scriptCatalog, requestIntent, startScript, uiMode, setUiMode, openSetup, addLog]
  )

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands
      .map((c) => ({ c, s: Math.max(score(q, c.label), score(q, c.hint ?? '') - 1000) }))
      .filter((x) => x.s > -Infinity)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c)
  }, [commands, query])

  // Grouped for display, in a fixed order, but selection moves through the
  // flat `results` list underneath — the grouping is a label, not a maze.
  const grouped = useMemo(() => {
    const byGroup = new Map<Command['group'], Command[]>()
    for (const c of results) {
      const bucket = byGroup.get(c.group) ?? []
      bucket.push(c)
      byGroup.set(c.group, bucket)
    }
    return GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => [g, byGroup.get(g)!] as const)
  }, [results])

  function run(c: Command) {
    c.run()
    setOpen(false)
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-surface-raised shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-ink-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelected(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSelected((i) => Math.min(results.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSelected((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                if (results[selected]) run(results[selected])
              }
            }}
            placeholder="Run a script, a Task Flow, or an app command…"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          />
          <kbd className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-ink-faint">
            esc
          </kbd>
        </div>

        <div className="max-h-96 overflow-y-auto py-1.5">
          {results.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-ink-faint">
              Nothing matches "{query}".
            </p>
          ) : (
            grouped.map(([group, items]) => (
              <div key={group} className="px-1.5 py-1">
                <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-ink-faint">
                  {group}
                </div>
                {items.map((c) => {
                  const idx = results.indexOf(c)
                  const active = idx === selected
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onMouseEnter={() => setSelected(idx)}
                      onClick={() => run(c)}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left ${
                        active ? 'bg-accent/15 text-ink' : 'text-ink-muted hover:bg-surface-overlay'
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{c.label}</span>
                        {c.hint && (
                          <span className="block truncate text-xs text-ink-faint">{c.hint}</span>
                        )}
                      </span>
                      {active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-ink-faint" />}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
