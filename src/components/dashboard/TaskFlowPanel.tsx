/**
 * Tasks and scripts: one grid, one window.
 *
 * This used to be two tabs - "tasks" (Python, run from a catalog) and
 * "scripts" (a text list split into "Yours" and "Lich's folder", edited in a
 * view that replaced the whole panel). Splitting them was never true to what
 * they are: every Python script a player saves *already* appears in the task
 * catalog (`runner.py`'s `user_tasks()` scans `tasks/user/*.py` and merges it
 * into the same list `flow.hunt` and `task.routine` come from), so the old
 * Scripts tab's "Yours" section and the Tasks tab's `user.*` tiles were the
 * same script, shown twice, with two different "run" buttons that did the
 * same thing. Dan's own words on it: "I want to see them and I really do
 * not. Your ways of interacting with them in the GUI suck. One simple
 * window, not many." The only thing Python's catalog can never cover is
 * Ruby - a Lich script, a different engine entirely - so that is the one
 * real addition to the grid below, not a second tab.
 *
 * # Icons, not text, and the text is one hover away
 *
 * Every tile is an icon and nothing else. No name, no summary, no "watches"
 * badge printed on the tile - all of it is in the tooltip, which is where
 * Dan asked for it to live rather than crowding the tile itself. The panel
 * shares a window with a live game; an icon grid puts far more of these in
 * the same height than a two-column text list ever could, and the one thing
 * that still gets a visible signal - whether something is running right now
 * - is a border colour and a small badge, not a sentence.
 *
 * An entry this file has never seen a good icon for still gets a tile
 * (Terminal, as a fallback) rather than being silently dropped - the
 * alternative is a list that omits whatever was added most recently, which
 * is exactly the thing being looked for.
 *
 * # Editing, in place
 *
 * A pencil appears on hover for anything backed by a real file - a Python
 * task saved under `tasks/user/`, or any Ruby script - and opens the same
 * editor as before. Built-in flows and examples get no pencil: they are
 * shipped source, not a player's file, and offering to "edit" one would open
 * onto nothing a save button could write to.
 *
 * # Nothing here schedules anything
 *
 * A task is a separate process; a Ruby script runs inside Lich. This panel
 * starts things and reports on them. The bug class the old driver hit twice —
 * reporting stopped while a timer kept firing underneath — cannot be written
 * here, because there is no timer to get out of step with.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FilePlus2, FolderOpen, Gem, Pencil, Play, RefreshCw, Search, Square } from 'lucide-react'
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
import { groupTasksByCategory } from '../../lib/taskGrouping'
import {
  listScripts,
  scriptDirs,
  type ScriptDirs,
  type ScriptFile,
  type ScriptLang,
} from '../../lib/scriptFiles'
import { inferScriptIcon, type ScriptIconKey } from '../../lib/scriptIcons'
import { SCRIPT_ICON_COMPONENT } from '../../lib/scriptIconComponents'
import { iconOverrideFor, setIconOverride, clearIconOverride } from '../../lib/scriptIconOverrides'
import { useDragScroll } from '../../lib/useDragScroll'
import { ScriptEditor, type EditorTarget } from './ScriptEditor'
import { ScriptIconPicker } from './ScriptIconPicker'
import { onStopAll, onStartFlow } from '../../lib/flowStop'
import { invokeTauri } from '../../lib/tauri'
import { useAppStore } from '../../store/useAppStore'
import { cn } from '../../lib/cn'

/** How many lines of task output the panel keeps. */
const KEEP_LINES = 200

/** Ruby scripts are grouped under this, after every task category - see the
 * module comment: the only thing the Python catalog cannot already cover. */
const RUBY_CATEGORY = 'Lich scripts'

/**
 * The built-in tasks' own curated icon, by id - unrelated to
 * `inferScriptIcon`'s guessing, since these are known exactly rather than
 * pattern-matched from a name. Everything else (a saved Python task, a Lich
 * script, an example) falls through to a guess in `baseIconKeyFor` below.
 */
const BASE_ICON_KEY: Record<string, ScriptIconKey> = {
  'task.routine': 'repeat',
  'flow.hunt': 'swords',
  'flow.ambush': 'eye-off',
  'flow.recover': 'heart-pulse',
  'flow.to_healer': 'stethoscope',
  'flow.town_run': 'coins',
  'flow.prepare': 'shield',
  'flow.disengage': 'log-out',
  'task.watch': 'eye',
}

/**
 * The icon a task or script gets before any player override - a known
 * built-in's own curated choice, or a guess from its own name and summary
 * (`inferScriptIcon`, shared with every Lich script - a saved Python task
 * deserves the same variety a Ruby one gets, not a single generic icon
 * repeated for every file a player has ever written).
 */
function baseIconKeyFor(id: string, name: string, summary: string): ScriptIconKey {
  if (BASE_ICON_KEY[id]) return BASE_ICON_KEY[id]
  if (id.startsWith('example.')) return 'book-open'
  return inferScriptIcon(name, summary)
}

/** One tile: a task from the Python catalog, or a Ruby script - the two
 * things this grid can run, unified so the grid never has to know which. */
type Entry = {
  id: string
  title: string
  /** What scriptIcons.ts (or a built-in's own curated choice) would show
   * without a player's override - carried alongside the resolved icon so
   * the picker's "reset to guess" can compare against it. */
  baseIcon: ScriptIconKey
  tooltip: string
  category: string
  /** Shown as a small badge only while running; never printed on the tile
   * otherwise - see the module comment on why text lives in the tooltip. */
  readOnly: boolean
  run: () => void
  /** Present only for something backed by a real file - see the module
   * comment on why built-ins get no pencil. */
  editTarget?: EditorTarget
}

export function TaskFlowPanel({ dense = false }: { dense?: boolean }) {
  const addLog = useAppStore((s) => s.addLog)
  const setActiveFlow = useAppStore((s) => s.setActiveFlow)
  const startScript = useAppStore((s) => s.startScript)

  const [status, setStatus] = useState<PythonStatus | null>(null)
  const [scripts, setScripts] = useState<ScriptFile[]>([])
  const [dirs, setDirs] = useState<ScriptDirs | null>(null)
  const [editing, setEditing] = useState<EditorTarget | null>(null)
  const [running, setRunning] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<string[]>([])
  const [filter, setFilter] = useState('')
  // Read straight from storage during render, the same pattern MapPanel's
  // pins use - this exists only to force a re-render after a write this
  // component made itself, since picking an icon doesn't otherwise touch
  // anything React tracks as having changed. The value itself is never
  // read; only the setter matters.
  const [, bumpIconOverrides] = useState(0)
  const [pickingIcon, setPickingIcon] = useState<{ id: string; title: string; base: ScriptIconKey } | null>(
    null
  )
  const { containerRef: gridRef, dragging: gridDragging, handlers: gridHandlers } = useDragScroll<HTMLDivElement>()

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
  const rubyScripts = useMemo(() => scripts.filter((s) => s.lang === 'ruby'), [scripts])

  /**
   * One combined list: every Python task, then every Ruby script, filtered
   * by name/summary. Tasks come first and already arrive sorted by
   * `runner.py`'s `CATEGORY_ORDER`; appending Ruby after them - rather than
   * interleaving - is what puts "Lich scripts" last once grouped, which is
   * the right place for "the whole dr-scripts suite plus whatever else is
   * installed," not only what a player wrote here.
   */
  const entries: Entry[] = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const matches = (title: string, summary: string) =>
      !q || title.toLowerCase().includes(q) || summary.toLowerCase().includes(q)

    const fromTasks: Entry[] = tasks
      .filter((t) => matches(t.title, t.summary))
      .map((t) => ({
        id: t.id,
        title: t.title,
        baseIcon: baseIconKeyFor(
          t.id,
          t.id.startsWith('user.') ? t.id.slice('user.'.length) : t.title,
          t.summary
        ),
        tooltip:
          `${t.title}\n${t.summary}\n\n${t.id} — ${t.category}, ${t.kind}\n\n` +
          `Runs the same outside the app:\npython python/runner.py run ${t.id}`,
        category: t.category,
        readOnly: t.kind === 'read-only',
        run: () => void start(t.id),
        editTarget: t.id.startsWith('user.')
          ? { name: t.id.slice('user.'.length), lang: 'python' as ScriptLang }
          : undefined,
      }))

    const fromRuby: Entry[] = rubyScripts
      .filter((s) => matches(s.name, s.summary))
      .map((s) => ({
        id: `ruby.${s.name}`,
        title: s.name,
        baseIcon: inferScriptIcon(s.name, s.summary),
        tooltip:
          `${s.name}\n${s.summary || 'No description in the file.'}\n\n` +
          `${s.path} — ${s.bytes} bytes\n\nA Lich script - runs inside Lich, not as an app task.`,
        category: RUBY_CATEGORY,
        readOnly: false,
        run: () => {
          startScript(s.name)
          addLog(`Asked Lich to start ${s.name}`, 'info')
        },
        editTarget: { name: s.name, lang: 'ruby' as ScriptLang },
      }))

    return [...fromTasks, ...fromRuby]
  }, [tasks, rubyScripts, filter, start, startScript, addLog])

  const groups = useMemo(() => groupTasksByCategory(entries), [entries])
  const totalCount = tasks.length + rubyScripts.length

  const openNew = useCallback((lang: ScriptLang) => {
    setEditing({ name: '', lang })
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
          void start(id)
        }}
      />
    )
  }

  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      {/* One row: what is running and the control for it, plus the two
       * folders a player might want to reveal - icons, tooltip-labelled,
       * same as every tile below rather than a second row of text buttons.
       * No heading here - the surrounding panel box already says "Tasks &
       * scripts"; repeating it inline was the exact kind of redundancy this
       * rewrite exists to remove. */}
      <div className="flex items-center gap-1">
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-xs',
            running ? 'text-accent' : 'text-ink-faint'
          )}
          title={note || undefined}
        >
          {running ? `Running ${running}` : note || ''}
        </span>

        {dirs?.pythonDir && (
          <button
            type="button"
            onClick={() => void invokeTauri('reveal_file', { path: dirs.pythonDir })}
            title={`Open your Python folder\n${dirs.pythonDir}`}
            className="shrink-0 rounded border border-border px-1.5 py-0.5 text-ink-faint hover:text-ink"
          >
            <FolderOpen className="h-3 w-3" />
          </button>
        )}

        {running ? (
          <button
            type="button"
            onClick={() => void stop()}
            title="Stop"
            className="shrink-0 rounded border border-danger/40 bg-danger/15 px-2 py-0.5 text-xs font-semibold text-danger hover:bg-danger/25"
          >
            <Square className="h-3 w-3" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void refresh()}
            title="Re-read the task catalog and the scripts folders"
            aria-label="Re-read the task catalog and the scripts folders"
            className="shrink-0 rounded border border-border px-1.5 py-0.5 text-ink-faint hover:text-ink"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* A filter across everything - tasks and Ruby scripts alike - because
       * Lich's folder alone can hold the whole dr-scripts suite. The count
       * says how many of how many, so a filter that matches nothing reads as
       * "0 of 40" rather than as an empty folder - those are different
       * problems and look identical without the denominator. */}
      <div className="flex items-center gap-1">
        <Search className="h-3 w-3 shrink-0 text-ink-faint" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter tasks and scripts"
          spellCheck={false}
          className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-0.5 text-xs text-ink placeholder:text-ink-faint"
        />
        <span className="shrink-0 text-xs text-ink-faint">
          {filter ? `${entries.length} of ${totalCount}` : totalCount}
        </span>
      </div>

      {/* Why the grid is empty, when it is. Never a bare "nothing here": the
       * causes need different fixes and the note carries Python's own words
       * when a task failed to import, or Lich's when its folder is missing. */}
      {status && tasks.length === 0 && (
        <p className="whitespace-pre-wrap rounded border border-warn/40 bg-warn/10 px-2 py-1 text-xs text-warn">
          {status.note || 'No tasks were listed.'}
        </p>
      )}
      {dirs?.note && (
        <p className="rounded border border-warn/40 bg-warn/10 px-2 py-1 text-xs text-warn">
          {dirs.note}
        </p>
      )}
      {filter && entries.length === 0 && (
        <p className="px-1 text-xs text-ink-faint">
          Nothing matches "{filter}" in {totalCount} tasks and scripts.
        </p>
      )}

      <div
        ref={gridRef}
        className={cn(
          'min-h-0 flex-1 overflow-auto',
          gridDragging ? 'cursor-grabbing select-none' : 'cursor-grab'
        )}
        style={{ touchAction: 'none' }}
        onPointerDown={gridHandlers.onPointerDown}
        onPointerMove={gridHandlers.onPointerMove}
        onPointerUp={gridHandlers.onPointerUp}
        onClickCapture={gridHandlers.onClickCapture}
      >
        <div className="flex flex-col gap-1.5">
          {groups.map((group) => (
            <div key={group.category} className="flex flex-col gap-1">
              <p className="px-1 text-xs font-medium text-ink-faint">
                {group.category}
                <span className="ml-1 opacity-60">{group.items.length}</span>
              </p>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-1">
                {group.items.map((entry) => {
                  const overrideKey = iconOverrideFor(entry.id)
                  const iconKey = overrideKey ?? entry.baseIcon
                  const Icon = SCRIPT_ICON_COMPONENT[iconKey]
                  const active = running === entry.id
                  return (
                    <div key={entry.id} className="group relative">
                      <button
                        type="button"
                        onClick={entry.run}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          setPickingIcon({ id: entry.id, title: entry.title, base: entry.baseIcon })
                        }}
                        title={`${entry.tooltip}\n\n(right-click to choose an icon)`}
                        className={cn(
                          'flex w-full items-center justify-center rounded border py-2 transition-colors',
                          active
                            ? 'border-accent bg-accent/15'
                            : entry.readOnly
                              ? 'border-border bg-surface-raised hover:border-ink-faint'
                              : 'border-border bg-surface-raised hover:border-accent/60'
                        )}
                      >
                        <Icon
                          className={cn(
                            'h-4 w-4',
                            active ? 'text-accent' : entry.readOnly ? 'text-ink-faint' : 'text-ink'
                          )}
                        />
                      </button>
                      {active && (
                        <Play className="pointer-events-none absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-surface text-accent" />
                      )}
                      {entry.editTarget && !dense && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditing(entry.editTarget!)
                          }}
                          title={`Edit ${entry.editTarget.name}`}
                          className="absolute -right-1 -top-1 rounded border border-border bg-surface p-0.5 text-ink-faint opacity-0 transition-opacity hover:text-accent group-hover:opacity-100"
                        >
                          <Pencil className="h-2.5 w-2.5" />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => openNew('python')}
              title="Write a new Python task. Saved into python/tasks/user/, where it is picked up automatically."
              className="flex flex-1 items-center justify-center rounded border border-dashed border-border py-2 text-ink-faint hover:border-ink-faint hover:text-ink"
            >
              <FilePlus2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => openNew('ruby')}
              title={
                dirs?.rubyDir
                  ? 'Write a new Lich script, in Ruby, saved into Lich’s scripts folder.'
                  : 'New Ruby script - needs Lich. Finish Lich setup first.'
              }
              className="flex flex-1 items-center justify-center rounded border border-dashed border-border py-2 text-ink-faint hover:border-ink-faint hover:text-ink"
            >
              <Gem className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {pickingIcon && (
        <ScriptIconPicker
          title={pickingIcon.title}
          current={iconOverrideFor(pickingIcon.id) ?? pickingIcon.base}
          guessed={pickingIcon.base}
          onPick={(icon) => {
            setIconOverride(pickingIcon.id, icon)
            bumpIconOverrides((v) => v + 1)
          }}
          onReset={() => {
            clearIconOverride(pickingIcon.id)
            bumpIconOverrides((v) => v + 1)
          }}
          onClose={() => setPickingIcon(null)}
        />
      )}

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
