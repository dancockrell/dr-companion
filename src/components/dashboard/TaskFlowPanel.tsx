/**
 * Tasks and scripts: what can be run, and where you write more.
 *
 * This used to be a flow engine. `FlowDriver` with a timer, a `FlowState`, a
 * condition grammar, and a step-list form writing custom flows to
 * localStorage — about 1,200 lines of TypeScript implementing a scripting
 * language inside a project whose scripting language is Python. All of it is
 * replaced: flows are Python tasks (`lib/pythonTasks.ts`), custom scripts are
 * real files in either language (`lib/scriptFiles.ts`, `ScriptEditor`).
 *
 * # Why the list is icons
 *
 * Because the panel shares a window with a live game, and every row of chrome
 * is a row of game text nobody can see. An icon grid puts roughly three times
 * as many tasks in the same height as the old two-column text list, and the
 * name is one hover away rather than gone — every tile carries its title, its
 * summary, its id, and the command line that runs the same thing outside the
 * app.
 *
 * The one thing that is never reduced to an icon is whether a task *sends
 * commands*. A task that watches and a task that drives a live character are
 * different in the way that matters most, so that difference is a visible
 * badge and a border colour, not a detail in a tooltip.
 *
 * # Nothing here schedules anything
 *
 * A task is a separate process; a Ruby script runs inside Lich. This panel
 * starts things and reports on them. The bug class the old driver hit twice —
 * reporting stopped while a timer kept firing underneath — cannot be written
 * here, because there is no timer to get out of step with.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BookOpen,
  Coins,
  Eye,
  EyeOff,
  FileCode2,
  FilePlus2,
  FolderOpen,
  HeartPulse,
  LogOut,
  type LucideIcon,
  Play,
  RefreshCw,
  Search,
  Shield,
  Square,
  Star,
  Stethoscope,
  Swords,
  Terminal,
} from 'lucide-react'
import {
  onTaskLine,
  onTaskState,
  pythonStatus,
  startTask,
  stopTask,
  taskState,
  type PythonStatus,
  type TaskInfo,
} from '../../lib/pythonTasks'
import {
  listScripts,
  scriptDirs,
  type ScriptDirs,
  type ScriptFile,
  type ScriptLang,
} from '../../lib/scriptFiles'
import { ScriptEditor, type EditorTarget } from './ScriptEditor'
import { onStopAll, onStartFlow } from '../../lib/flowStop'
import { invokeTauri } from '../../lib/tauri'
import { useAppStore } from '../../store/useAppStore'
import { cn } from '../../lib/cn'

/** How many lines of task output the panel keeps. */
const KEEP_LINES = 200

/**
 * An icon per task, so a tile is recognisable before it is read.
 *
 * Matched by id, with a prefix fallback, and a generic icon when neither hits.
 * A task this map has never heard of still gets a tile — the alternative is a
 * list that silently omits whatever somebody added most recently, which is
 * exactly the task they are looking for.
 */
const ICONS: Record<string, LucideIcon> = {
  'flow.hunt': Swords,
  'flow.ambush': EyeOff,
  'flow.recover': HeartPulse,
  'flow.to_healer': Stethoscope,
  'flow.town_run': Coins,
  'flow.prepare': Shield,
  'flow.disengage': LogOut,
  'task.watch': Eye,
}

function iconFor(id: string): LucideIcon {
  if (ICONS[id]) return ICONS[id]
  if (id.startsWith('example.')) return BookOpen
  if (id.startsWith('user.')) return FileCode2
  return Terminal
}

type Tab = 'tasks' | 'scripts'

export function TaskFlowPanel({ dense = false }: { dense?: boolean }) {
  const addLog = useAppStore((s) => s.addLog)
  const setActiveFlow = useAppStore((s) => s.setActiveFlow)
  const startScript = useAppStore((s) => s.startScript)
  const quickSwitchPins = useAppStore((s) => s.quickSwitchPins)
  const toggleQuickSwitchPin = useAppStore((s) => s.toggleQuickSwitchPin)

  const [tab, setTab] = useState<Tab>('tasks')
  const [status, setStatus] = useState<PythonStatus | null>(null)
  const [scripts, setScripts] = useState<ScriptFile[]>([])
  const [dirs, setDirs] = useState<ScriptDirs | null>(null)
  const [editing, setEditing] = useState<EditorTarget | null>(null)
  const [running, setRunning] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<string[]>([])
  const [filter, setFilter] = useState('')

  const refresh = useCallback(async () => {
    const [st, files, where] = await Promise.all([pythonStatus(), listScripts(), scriptDirs()])
    setStatus(st)
    setScripts(files)
    setDirs(where)
    // Asked, never assumed. A task that exited on its own leaves no event for
    // a panel that mounted afterwards, and a remembered "running" that has
    // gone stale is indistinguishable from a live one.
    const state = await taskState()
    setRunning(state.running ? state.task : '')
    setActiveFlow(state.running ? state.task : null)
  }, [setActiveFlow])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(
    () =>
      onTaskState((st) => {
        setRunning(st.running ? st.task : '')
        setNote(st.note)
        // Published to the store as well as held here: the safety bar reports
        // what the app is doing, and with this state living only in this
        // component the bar read Idle through an hour-long hunting loop.
        setActiveFlow(st.running ? st.task : null)
        if (st.note) addLog(st.note, 'info')
      }),
    [addLog, setActiveFlow]
  )

  useEffect(
    () =>
      onTaskLine((line) => {
        setLines((prev) => [...prev, line.text].slice(-KEEP_LINES))
        if (line.error) addLog(`${line.task}: ${line.text}`, 'warn')
      }),
    [addLog]
  )

  const start = useCallback(
    async (id: string) => {
      setLines([])
      setNote('')
      try {
        const st = await startTask(id)
        setRunning(st.running ? st.task : '')
        setActiveFlow(st.running ? st.task : null)
      } catch (e) {
        // Named, never swallowed. No interpreter, a task that will not import,
        // a missing folder — each says something specific and actionable, and
        // a button that quietly does nothing says none of it.
        const message = e instanceof Error ? e.message : String(e)
        setNote(message)
        addLog(`Could not start ${id}: ${message}`, 'error')
      }
    },
    [addLog, setActiveFlow]
  )

  const stop = useCallback(async () => {
    const st = await stopTask()
    setRunning('')
    setNote(st.note || 'Stopped.')
    setActiveFlow(null)
  }, [setActiveFlow])

  // SafetyFooter's Stop holds no reference to this panel. Pause and Resume are
  // deliberately not wired here any more: they are enforced in Rust at the
  // script-API dispatch point, so they hold every automated command including
  // scripts this app did not start. That is a widening, not an omission — the
  // old Pause only ever paused the seven flows this app shipped.
  useEffect(() => onStopAll(() => void stopTask()), [])

  // The Command Palette starts a task by id with no reference to this panel.
  useEffect(() => onStartFlow((id) => void start(id)), [start])

  // A task outlives this component — it is a separate process. Unmounting
  // clears only what this component published and deliberately does not stop
  // it: popping the panel out unmounts it, and that must not kill a hunt.
  useEffect(() => () => setActiveFlow(null), [setActiveFlow])

  const tasks: TaskInfo[] = useMemo(() => status?.tasks ?? [], [status])

  // Filtered and grouped, with the denominator kept: Lich's folder holds the
  // whole dr-scripts suite, so a player's own two files would otherwise be lost
  // among two hundred installed ones. "Yours" is the app's Python folder, which
  // only ever contains what the player wrote here; "Lich's folder" is mixed and
  // is labelled as mixed rather than implied to be theirs.
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const match = (s: ScriptFile) =>
      !q || s.name.toLowerCase().includes(q) || s.summary.toLowerCase().includes(q)
    const hit = scripts.filter(match)
    return {
      yours: hit.filter((s) => s.lang === 'python'),
      lich: hit.filter((s) => s.lang === 'ruby'),
      shownCount: hit.length,
      total: scripts.length,
    }
  }, [scripts, filter])

  const openNew = useCallback((lang: ScriptLang) => {
    setEditing({ name: '', lang })
    setTab('scripts')
  }, [])

  if (editing) {
    return (
      <ScriptEditor
        target={editing}
        dirs={dirs}
        onClose={() => setEditing(null)}
        onSaved={() => void refresh()}
        onRun={(id) => {
          setEditing(null)
          setTab('tasks')
          void start(id)
        }}
      />
    )
  }

  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      {/* One row carrying three things: which browser, what is running, and
       * the control for it. Reserved whether or not something runs, so
       * starting a task does not push every tile down by a line. */}
      <div className="flex items-center gap-1">
        {(['tasks', 'scripts'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'rounded border px-2 py-0.5 text-xs capitalize',
              tab === t
                ? 'border-accent bg-accent/15 text-accent'
                : 'border-transparent text-ink-faint hover:text-ink'
            )}
          >
            {t}
            <span className="ml-1 opacity-60">
              {t === 'tasks' ? tasks.length : scripts.length}
            </span>
          </button>
        ))}

        <span
          className={cn(
            'ml-1 min-w-0 flex-1 truncate text-xs',
            running ? 'text-accent' : 'text-ink-faint'
          )}
          title={note || undefined}
        >
          {running ? `Running ${running}` : note || ''}
        </span>

        {running ? (
          <button
            type="button"
            onClick={() => void stop()}
            className="shrink-0 rounded border border-danger/40 bg-danger/15 px-2 py-0.5 text-xs font-semibold text-danger hover:bg-danger/25"
          >
            <Square className="mr-1 inline h-3 w-3" />
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void refresh()}
            title="Re-read the task catalog and the scripts folders"
            className="shrink-0 rounded border border-border px-1.5 py-0.5 text-ink-faint hover:text-ink"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Why a list is empty, when it is. Never a bare "nothing here": the
       * causes need different fixes and the note carries Python's own words
       * when a task failed to import. */}
      {tab === 'tasks' && status && tasks.length === 0 && (
        <p className="whitespace-pre-wrap rounded border border-warn/40 bg-warn/10 px-2 py-1 text-xs text-warn">
          {status.note || 'No tasks were listed.'}
        </p>
      )}
      {tab === 'scripts' && dirs?.note && (
        <p className="rounded border border-warn/40 bg-warn/10 px-2 py-1 text-xs text-warn">
          {dirs.note}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'tasks' ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-1">
            {tasks.map((t) => {
              const Icon = iconFor(t.id)
              const active = running === t.id
              const readOnly = t.kind === 'read-only'
              const pinned = quickSwitchPins.some((p) => p.kind === 'task' && p.id === t.id)
              return (
                // `relative` on the wrapper, not the tile button itself: the
                // pin star is a sibling button, not a nested one — a button
                // inside a button is invalid HTML and would give the star no
                // click of its own to stop from bubbling into Start.
                <div key={t.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => void start(t.id)}
                    title={
                      `${t.title}\n${t.summary}\n\n${t.id} — ${t.kind}\n\n` +
                      `Runs the same outside the app:\npython python/runner.py run ${t.id}`
                    }
                    className={cn(
                      'flex w-full flex-col items-center gap-0.5 rounded border px-1 py-1.5 transition-colors',
                      active
                        ? 'border-accent bg-accent/15'
                        : readOnly
                          ? 'border-border bg-surface-raised hover:border-ink-faint'
                          : 'border-border bg-surface-raised hover:border-accent/60'
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-4 w-4',
                        active ? 'text-accent' : readOnly ? 'text-ink-faint' : 'text-ink'
                      )}
                    />
                    <span className="w-full truncate text-center text-xs leading-tight text-ink">
                      {t.title}
                    </span>
                    {/* The one distinction never left to a tooltip. */}
                    {readOnly && !dense && (
                      <span className="text-xs leading-none text-ink-faint">watches</span>
                    )}
                    {active && <Play className="h-3 w-3 text-accent" />}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleQuickSwitchPin({ kind: 'task', id: t.id })
                    }}
                    title={
                      pinned
                        ? 'Unpin from the Quick Switch bar'
                        : 'Pin to the Quick Switch bar — one click or a number key from anywhere in the app'
                    }
                    className={cn(
                      'absolute -right-1 -top-1 rounded-full bg-surface p-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100',
                      pinned && 'opacity-100',
                      pinned ? 'text-accent' : 'text-ink-faint/70 hover:text-ink-faint'
                    )}
                  >
                    <Star className="h-3 w-3" fill={pinned ? 'currentColor' : 'none'} />
                  </button>
                </div>
              )
            })}

            <button
              type="button"
              onClick={() => openNew('python')}
              title="Write a new Python task. Saved into python/tasks/user/, where it is picked up automatically."
              className="flex flex-col items-center gap-0.5 rounded border border-dashed border-border px-1 py-1.5 text-ink-faint hover:border-ink-faint hover:text-ink"
            >
              <FilePlus2 className="h-4 w-4" />
              <span className="w-full truncate text-center text-xs leading-tight">New</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => openNew('python')}
                className="flex items-center gap-1 rounded border border-dashed border-border px-2 py-0.5 text-xs text-ink-faint hover:border-ink-faint hover:text-ink"
              >
                <FilePlus2 className="h-3 w-3" />
                New Python
              </button>
              <button
                type="button"
                onClick={() => openNew('ruby')}
                title={
                  dirs?.rubyDir
                    ? 'A Lich script, in Ruby, saved into Lich’s scripts folder.'
                    : 'Needs Lich. Finish Lich setup first.'
                }
                className="flex items-center gap-1 rounded border border-dashed border-border px-2 py-0.5 text-xs text-ink-faint hover:border-ink-faint hover:text-ink"
              >
                <FilePlus2 className="h-3 w-3" />
                New Ruby
              </button>
              {dirs?.pythonDir && (
                <button
                  type="button"
                  onClick={() => void invokeTauri('reveal_file', { path: dirs.pythonDir })}
                  title={dirs.pythonDir}
                  className="ml-auto rounded border border-border px-1.5 py-0.5 text-ink-faint hover:text-ink"
                >
                  <FolderOpen className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* A filter, because Lich's folder alone holds the whole dr-scripts
              * suite. The count says how many of how many, so a filter that
              * matches nothing reads as "0 of 234" rather than as an empty
              * folder - those are different problems and they look identical
              * without the denominator. */}
            <div className="flex items-center gap-1">
              <Search className="h-3 w-3 shrink-0 text-ink-faint" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter scripts"
                spellCheck={false}
                className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-0.5 text-xs text-ink placeholder:text-ink-faint"
              />
              <span className="shrink-0 text-xs text-ink-faint">
                {filter ? `${shown.shownCount} of ${shown.total}` : shown.total}
              </span>
            </div>

            {scripts.length === 0 && !dirs?.note && (
              <p className="px-1 text-xs text-ink-faint">
                No scripts yet. Python becomes a task in this app; Ruby is a Lich script.
              </p>
            )}

            {filter && shown.shownCount === 0 && (
              <p className="px-1 text-xs text-ink-faint">
                Nothing matches "{filter}" in {shown.total} scripts.
              </p>
            )}

            {[
              { label: 'Yours', hint: 'Python, in this app. Each becomes a task.', items: shown.yours },
              {
                label: "Lich's folder",
                hint: 'Ruby. Includes dr-scripts and anything else installed, not only what you wrote.',
                items: shown.lich,
              },
            ].map((group) =>
              group.items.length === 0 ? null : (
                <div key={group.label} className="flex flex-col gap-1">
                  <p
                    className="px-1 text-xs font-medium text-ink-faint"
                    title={group.hint}
                  >
                    {group.label}
                    <span className="ml-1 opacity-60">{group.items.length}</span>
                  </p>
                  {group.items.map((s) => (
              <div
                key={`${s.lang}:${s.name}`}
                className="flex items-center gap-1 rounded border border-border bg-surface-raised px-1.5 py-1"
              >
                <button
                  type="button"
                  onClick={() => setEditing({ name: s.name, lang: s.lang })}
                  title={`${s.path}\n${s.bytes} bytes\n\n${s.summary || 'No description in the file.'}\n\nClick to edit.`}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                >
                  <FileCode2
                    className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      s.lang === 'python' ? 'text-accent' : 'text-ink-faint'
                    )}
                  />
                  <span className="truncate text-xs text-ink">{s.name}</span>
                  {!dense && s.summary && (
                    <span className="truncate text-xs text-ink-faint">{s.summary}</span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (s.lang === 'python') {
                      void start(`user.${s.name}`)
                    } else {
                      startScript(s.name)
                      addLog(`Asked Lich to start ${s.name}`, 'info')
                    }
                  }}
                  title={
                    s.lang === 'python'
                      ? `Run as user.${s.name}`
                      : `Ask Lich to run ${s.name}`
                  }
                  className="shrink-0 rounded border border-border px-1.5 py-0.5 text-ink-faint hover:border-accent/60 hover:text-accent"
                >
                  <Play className="h-3 w-3" />
                </button>
              </div>
                  ))}
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* What the task itself said. The old panel could only report which step
       * it was on, because it was the thing running the steps; a task can say
       * what it observed and why it branched. */}
      {lines.length > 0 && (
        <div className="max-h-28 shrink-0 overflow-auto rounded border border-border bg-surface px-2 py-1 font-mono text-xs leading-tight text-ink-faint">
          {lines.map((l, i) => (
            <div key={i} className="whitespace-pre-wrap">
              {l}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
