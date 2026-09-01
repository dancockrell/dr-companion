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
import type { IntentName } from '../../bridge/types'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, CornerDownLeft } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { getScriptCatalogEntry } from '../../data/scriptCatalog'
import { pythonStatus, type TaskInfo } from '../../lib/pythonTasks'
import { nodeStatus } from '../../lib/nodeTasks'
import {
  requestStopAll,
  requestPauseAll,
  requestResumeAll,
  requestStartFlow,
} from '../../lib/flowStop'
import { KEYBINDING_HELP } from '../../lib/keybindings'
import { useModalDialog } from '../../lib/useModalDialog'
import {
  musicVolume,
  pauseMusic,
  resumeMusic,
  skipTrack,
  setRadioStation,
  RADIO_STATIONS,
} from '../../lib/ambientSound'
import { requestOpenSoundPanel } from '../../lib/soundPanelOpen'

interface Command {
  id: string
  label: string
  hint?: string
  group: 'Safety' | 'Tasks' | 'Scripts' | 'Sound' | 'App'
  run: () => void
  /**
   * Already started, so offering to start it is a lie.
   *
   * The Script Library has always known this and disabled the button; the
   * palette did not, so the same script was un-startable in one surface and
   * freely startable in the faster one. Lich refuses a duplicate
   * (`script.rb:138`, "already running ... use ;force") and so does the
   * bridge (`companion_bridge.lic:1589`), so the cost was an error line
   * rather than two hunting scripts fighting each other - but a control that
   * offers what the system will refuse is the defect this app keeps finding.
   */
  alreadyRunning?: boolean
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

/**
 * Running and paused both count as started.
 *
 * Paused is the one that gets missed: a paused script is still loaded and
 * still refuses a second start, so offering it is the same lie as offering a
 * running one. The Script Library draws the line here and this matches it
 * rather than inventing a second answer to the same question.
 */
function isStarted(runningByName: Map<string, string>, name: string): boolean {
  const status = runningByName.get(name.toLowerCase())
  return status === 'running' || status === 'paused'
}

/**
 * A task tagged with which backend it runs on. Needed here for the same
 * reason `TaskFlowPanel.tsx` tags its own merged list: Python and TypeScript
 * each have their own `user.<filename>` id scheme, so the same id
 * (`task.watch` ships in both catalogs) can name two different processes,
 * and both the palette's React key and `requestStartFlow` need to know
 * which one a given entry actually means.
 */
type TaskLang = 'python' | 'typescript'
type MergedTask = TaskInfo & { lang: TaskLang }

function buildCommands(deps: {
  scriptCatalog: string[] | null
  /** Python and TypeScript tasks, read from the same catalogs the Tasks panel shows. */
  tasks: MergedTask[]
  // Not `string`. A palette entry naming an intent that does not exist
  // used to compile and fail against a live bridge; the union makes the
  // typo a build error at the entry itself.
  requestIntent: (
    intent: IntentName | `travel:${string}`,
    args?: Record<string, unknown>
  ) => void
  startScript: (name: string) => void
  /** Lich's own view: lowercased script name -> status. */
  runningByName: Map<string, string>
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

  for (const task of deps.tasks) {
    commands.push({
      id: `task:${task.lang}:${task.id}`,
      label: task.title,
      // The kind rides along, because "watches" and "drives your character"
      // are the difference worth seeing before pressing Enter on a fuzzy match.
      // The language only when it's the less usual one — every task used to
      // be Python, and marking every entry "python" would be noise where
      // marking the occasional "typescript" one is signal.
      hint:
        task.lang === 'typescript'
          ? `${task.summary} (${task.kind}, TypeScript)`
          : `${task.summary} (${task.kind})`,
      group: 'Tasks',
      run: () => requestStartFlow(task.id, task.lang),
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
      alreadyRunning: isStarted(deps.runningByName, name),
    })
  }

  // The same three transport actions and the station list SafetyFooter's own
  // MusicTransport already exposes - findable here too, because "what does
  // this command palette not reach" was the whole point of Ctrl+K existing,
  // and a player mid-search for a script shouldn't have to remember sound
  // lives in a different corner of the app entirely.
  commands.push(
    {
      id: 'sound:play-pause',
      label: 'Play/pause music',
      hint: 'Fades in or out, same as the footer button',
      group: 'Sound',
      run: () => (musicVolume() > 0 ? pauseMusic() : resumeMusic()),
    },
    {
      id: 'sound:next',
      label: 'Next track',
      group: 'Sound',
      run: () => skipTrack(1),
    },
    {
      id: 'sound:prev',
      label: 'Previous track',
      group: 'Sound',
      run: () => skipTrack(-1),
    },
    {
      id: 'sound:open-panel',
      label: 'Open Sound panel',
      hint: 'Mixer, search, favorites, custom streams',
      group: 'Sound',
      run: () => requestOpenSoundPanel(),
    }
  )
  for (const station of RADIO_STATIONS) {
    commands.push({
      id: `sound:station:${station.id}`,
      label: `Play station: ${station.name}`,
      hint: station.description,
      group: 'Sound',
      run: () => setRadioStation(station.id),
    })
  }

  commands.push(
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

const GROUP_ORDER: Command['group'][] = ['Safety', 'Tasks', 'Scripts', 'Sound', 'App']

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const dialogRef = useModalDialog(() => setOpen(false), open)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const [tasks, setTasks] = useState<MergedTask[]>([])

  // Re-read every time the palette opens rather than once at mount. A task
  // saved in the editor a minute ago must be findable now, and a list
  // captured at startup would never contain it.
  useEffect(() => {
    if (!open) return
    void Promise.all([pythonStatus(), nodeStatus()]).then(([py, node]) =>
      setTasks([
        ...py.tasks.map((t) => ({ ...t, lang: 'python' as const })),
        // Node/TypeScript tasks carry no `category` of their own - see
        // TaskFlowPanel.tsx's TS_CATEGORY for the same gap and the same
        // fixed-bucket fix. Unused by this palette's own rendering (the
        // Tasks loop below never reads `task.category`), but `MergedTask`
        // requires the field since it's `TaskInfo & { lang }`.
        ...node.tasks.map((t) => ({ ...t, lang: 'typescript' as const, category: 'TypeScript tasks' })),
      ])
    )
  }, [open])

  const scriptCatalog = useAppStore((s) => s.scriptCatalog)
  const scriptStates = useAppStore((s) => s.scriptStates)
  const requestIntent = useAppStore((s) => s.requestIntent)
  const startScript = useAppStore((s) => s.startScript)
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

  // The same map the Script Library builds, from the same source, so the two
  // surfaces cannot disagree about what is running.
  const runningByName = useMemo(() => {
    const m = new Map<string, string>()
    scriptStates.forEach((sc) => m.set(sc.name.toLowerCase(), sc.status))
    return m
  }, [scriptStates])

  const commands = useMemo(
    () =>
      buildCommands({
        scriptCatalog,
        tasks,
        requestIntent,
        startScript,
        openSetup,
        addLog,
        runningByName,
      }),
    [scriptCatalog, requestIntent, startScript, openSetup, addLog, runningByName]
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
    // A disabled entry still closes the palette rather than doing nothing at
    // all: silently ignoring Enter reads as the app being stuck.
    if (!c.alreadyRunning) c.run()
    setOpen(false)
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]"
      data-gameplay-shortcuts="suspend"
      onClick={() => setOpen(false)}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        tabIndex={-1}
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
          <kbd className="shrink-0 rounded border border-border px-1.5 py-0.5 text-xs text-ink-faint">
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
                <div className="px-2 py-1 text-xs font-medium uppercase tracking-wider text-ink-faint">
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
                        <span
                          className={`block truncate text-sm ${
                            c.alreadyRunning ? 'text-ink-faint' : ''
                          }`}
                        >
                          {c.label}
                          {/* Said on the row, not only by dimming it. Greyed
                              text alone reads as "not available" without
                              saying why, and the reason here is the useful
                              part: it is already doing the thing. */}
                          {c.alreadyRunning && (
                            <span className="ml-2 text-xs text-good">running</span>
                          )}
                        </span>
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
