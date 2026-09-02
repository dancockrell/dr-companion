/**
 * Tasks and scripts: one grid, one window.
 *
 * This used to be two tabs - "tasks" (Python, run from a catalog) and
 * "scripts" (a text list split into "Yours" and "Lich's folder", edited in a
 * view that replaced the whole panel). Splitting them was never true to what
 * they are: every Python (or TypeScript) script a player saves *already*
 * appears in its own task catalog (`runner.py`'s `user_tasks()` scans
 * `tasks/user/*.py`, `runner.ts`'s scans `tasks/user/*.ts`, and both merge
 * into the same list `flow.hunt` and `task.routine` come from), so the old
 * Scripts tab's "Yours" section and the Tasks tab's `user.*` tiles were the
 * same script, shown twice, with two different "run" buttons that did the
 * same thing. Dan's own words on it: "I want to see them and I really do
 * not. Your ways of interacting with them in the GUI suck. One simple
 * window, not many." The only thing neither catalog can ever cover is
 * Ruby - a Lich script, a different engine entirely - so that is the one
 * real addition to the grid below, not a second tab.
 *
 * # Two catalogs, one grid
 *
 * Python and TypeScript are two separate backends (`pythonTasks.ts`/
 * `python.rs`, `nodeTasks.ts`/`node.rs` - see that file's own header for why
 * they are not one parameterised module) but the same *kind* of thing to a
 * player: a task, picked from a catalog, run as a background process. They
 * are merged into one `tasks` list and rendered as one set of tiles rather
 * than kept apart, the same way this file already refuses to give Ruby its
 * own tab. Starting either stops whatever the *other* backend has running -
 * enforced here, in `start()`, because "one task at a time" is a rule about
 * this character, not about a single language's process table.
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
 * A pencil appears on hover for anything backed by a real file - a Python or
 * TypeScript task saved under `tasks/user/`, or any Ruby script - and opens
 * the same editor as before. Built-in flows and examples get no pencil: they
 * are shipped source, not a player's file, and offering to "edit" one would
 * open onto nothing a save button could write to.
 *
 * # Nothing here schedules anything
 *
 * A task is a separate process; a Ruby script runs inside Lich. This panel
 * starts things and reports on them. The bug class the old driver hit twice —
 * reporting stopped while a timer kept firing underneath — cannot be written
 * here, because there is no timer to get out of step with.
 */
import { lazy, useCallback, useEffect, useMemo, useState } from 'react'
import {
  FilePlus2,
  FolderOpen,
  Gem,
  Pencil,
  Play,
  RefreshCw,
  Search,
  Square,
  Star,
  Workflow,
} from 'lucide-react'
import {
  onTaskLine,
  onTaskState,
  startTask,
  stopTask,
  taskState,
  type TaskInfo,
} from '../../lib/pythonTasks'
import {
  onNodeTaskLine,
  onNodeTaskState,
  startNodeTask,
  stopNodeTask,
  nodeTaskState,
} from '../../lib/nodeTasks'
import { groupTasksByCategory, moveTaskWithinCategory } from '../../lib/taskGrouping'
import {
  type ScriptLang,
} from '../../lib/scriptFiles'
import { refreshTaskCatalogs, useTaskCatalogs } from '../../lib/taskCatalogStatus'
import { inferScriptIcon, type ScriptIconKey } from '../../lib/scriptIcons'
import { SCRIPT_ICON_COMPONENT } from '../../lib/scriptIconComponents'
import { iconOverrideFor, setIconOverride, clearIconOverride } from '../../lib/scriptIconOverrides'
import { useDragScroll } from '../../lib/useDragScroll'
import type { EditorTarget } from './ScriptEditor'
import { scrollableRegionProps } from '../../lib/scrollableRegion'
import { ScriptIconPicker } from './ScriptIconPicker'
import { onStopAll, onStartFlow } from '../../lib/flowStop'
import { invokeTauri } from '../../lib/tauri'
import { useAppStore } from '../../store/useAppStore'
import { cn } from '../../lib/cn'
import { readJSON, writeJSON } from '../../lib/storage'
import { isPinned, type QuickSwitchPin } from '../../lib/quickSwitch'
import { MACROS, type Macro } from '../../data/macros'
import { useMacroRunner } from '../../lib/useMacroRunner'
import { accentForIndex, actionAccent, actionIcon } from '../../lib/battleActionVisuals'
import { LazySurface } from '../shared/LazySurface'

const ScriptEditor = lazy(() => import('./ScriptEditor').then((module) => ({ default: module.ScriptEditor })))

/** How many lines of task output the panel keeps. */
const KEEP_LINES = 200
const EMPTY_SCRIPTS: import('../../lib/scriptFiles').ScriptFile[] = []

/** Ruby scripts are grouped under this, after every task category - see the
 * module comment: the only thing neither catalog can already cover. */
const RUBY_CATEGORY = 'Lich scripts'

/**
 * TypeScript tasks have no `category` of their own - `runner.ts` does not
 * sort into "Combat"/"Recovery"/etc the way `runner.py`'s `CATEGORY_ORDER`
 * does, since the built-in flows are Python-only and a player's own `.ts`
 * tasks have no house convention to categorise by yet. One bucket, named for
 * what it is, rather than guessing a category that would just be wrong.
 */
const TS_CATEGORY = 'TypeScript tasks'

/** Basic game functions live in the same launcher as scripts. The battle rail
 * is the fast subset; this is the complete, searchable catalog generated from
 * the single macro source of truth rather than a second hand-maintained list. */
const COMMAND_CATEGORY: Record<Macro['group'], string> = {
  combat: 'Combat commands',
  health: 'Health commands',
  hunt: 'Hunt commands',
  goods: 'Goods commands',
  magic: 'Magic commands',
  travel: 'Travel commands',
  info: 'Information commands',
}

const COMMAND_ICON: Record<Macro['group'], ScriptIconKey> = {
  combat: 'swords',
  health: 'heart-pulse',
  hunt: 'eye-off',
  goods: 'shopping-bag',
  magic: 'wand',
  travel: 'compass',
  info: 'eye',
}

/**
 * Where a player's own tile arrangement lives.
 *
 * A plain array of task ids, not a map or anything keyed - the catalog is
 * re-read on every `refresh()` (a task can appear or disappear between
 * sessions, same as the panel already handles), so the only thing worth
 * remembering is *where* an id goes when it's present, not any data about
 * the task itself. Unknown ids in a stored order (a task that got renamed or
 * removed) are silently dropped by `orderTasks` below rather than left as
 * dead weight or an error - a stale entry here costs nothing to lose.
 */
const TILE_ORDER_KEY = 'dr-companion:task-tile-order'

/**
 * The catalog's own order, with a player's saved arrangement applied on top.
 *
 * Ids from `order` come first, in that sequence, filtered to only the ones
 * `tasks` actually has right now; anything `order` doesn't mention - new
 * since it was saved, or never moved - keeps the catalog's own relative
 * order and is appended after. So a fresh install (empty order) is
 * indistinguishable from the catalog's natural order, and adding one new
 * task never reshuffles everything the player already arranged.
 */
function orderTasks(tasks: TaskInfo[], order: string[]): TaskInfo[] {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const placed = new Set<string>()
  const ordered: TaskInfo[] = []
  for (const id of order) {
    const t = byId.get(id)
    if (t && !placed.has(id)) {
      ordered.push(t)
      placed.add(id)
    }
  }
  for (const t of tasks) {
    if (!placed.has(t.id)) ordered.push(t)
  }
  return ordered
}

/**
 * The built-in tasks' own curated icon, by id - unrelated to
 * `inferScriptIcon`'s guessing, since these are known exactly rather than
 * pattern-matched from a name. Everything else (a saved Python or TypeScript
 * task, a Lich script, an example) falls through to a guess in
 * `baseIconKeyFor` below.
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
 * (`inferScriptIcon`, shared with every Lich script - a saved task deserves
 * the same variety a Ruby one gets, not a single generic icon repeated for
 * every file a player has ever written).
 */
function baseIconKeyFor(id: string, name: string, summary: string): ScriptIconKey {
  if (BASE_ICON_KEY[id]) return BASE_ICON_KEY[id]
  if (id.startsWith('example.')) return 'book-open'
  return inferScriptIcon(name, summary)
}

/** One tile: a task from the Python or TypeScript catalog, or a Ruby script -
 * the three things this grid can run, unified so the grid never has to know
 * which. */
type Entry = {
  id: string
  title: string
  /** What scriptIcons.ts (or a built-in's own curated choice) would show
   * without a player's override - carried alongside the resolved icon so
   * the picker's "reset to guess" can compare against it. */
  baseIcon: ScriptIconKey
  /** Basic commands share their exact semantic identity with the battle rail. */
  actionKey?: string
  tooltip: string
  category: string
  /** Shown as a small badge only while running; never printed on the tile
   * otherwise - see the module comment on why text lives in the tooltip. */
  readOnly: boolean
  /** An unavailable game connection is a disabled command, not a dead click. */
  disabled?: boolean
  run: () => void
  /** Present only for something backed by a real file - see the module
   * comment on why built-ins get no pencil. */
  editTarget?: EditorTarget
}

export function TaskFlowPanel({ dense = false, title }: { dense?: boolean; title?: string }) {
  const addLog = useAppStore((s) => s.addLog)
  const setActiveFlow = useAppStore((s) => s.setActiveFlow)
  const startScript = useAppStore((s) => s.startScript)
  const quickSwitchPins = useAppStore((s) => s.quickSwitchPins)
  const toggleQuickSwitchPin = useAppStore((s) => s.toggleQuickSwitchPin)
  const { run: runMacro, canSend: canSendMacro, reason: macroReason } = useMacroRunner()

  const catalogs = useTaskCatalogs()
  const status = catalogs.python.value
  const nodeSt = catalogs.node.value
  const scripts = catalogs.scripts.value ?? EMPTY_SCRIPTS
  const dirs = catalogs.dirs.value
  const [editing, setEditing] = useState<EditorTarget | null>(null)
  // A bare entry id is enough here (unlike the two-backend `start`/`stop`
  // logic below) because every Entry already carries a unique one - Python's
  // own ids (`user.foo`, `flow.hunt`), TypeScript's own prefixed `ts.` to
  // keep `user.foo` in one language from reading as active while the other
  // language's `user.foo` runs, and Ruby's `ruby.` - same prefix Ruby always
  // had.
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
  const {
    ref: gridRef,
    dragging: gridDragging,
    onPointerDown: gridOnPointerDown,
    onPointerMove: gridOnPointerMove,
    onPointerUp: gridOnPointerUp,
    onPointerCancel: gridOnPointerCancel,
  } = useDragScroll()

  // A player's own arrangement of the task tiles, remembered per browser -
  // see TILE_ORDER_KEY below for why this is a plain id list rather than
  // anything richer.
  const [tileOrder, setTileOrder] = useState<string[]>(() => readJSON(TILE_ORDER_KEY, []))
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)

  const refreshRunning = useCallback(async () => {
    // Asked, never assumed. A task that exited on its own leaves no event for
    // a panel that mounted afterwards, and a remembered "running" that has
    // gone stale is indistinguishable from a live one. Checked in both
    // backends - the invariant is "at most one task, of either language,"
    // not "at most one per language," so either could be the live one.
    const [pyResult, nodeResult] = await Promise.allSettled([taskState(), nodeTaskState()])
    const pyState = pyResult.status === 'fulfilled' ? pyResult.value : null
    const nodeState = nodeResult.status === 'fulfilled' ? nodeResult.value : null
    if (pyState?.running) {
      setRunning(pyState.task)
      setActiveFlow(pyState.task)
    } else if (nodeState?.running) {
      setRunning(`ts.${nodeState.task}`)
      setActiveFlow(nodeState.task)
    } else {
      setRunning('')
      setActiveFlow(null)
    }
  }, [setActiveFlow])

  const refresh = useCallback(async () => {
    await Promise.all([refreshTaskCatalogs(), refreshRunning()])
  }, [refreshRunning])

  useEffect(() => {
    void refreshRunning()
  }, [refreshRunning])

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
      onNodeTaskState((st) => {
        setRunning(st.running ? `ts.${st.task}` : '')
        setNote(st.note)
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

  useEffect(
    () =>
      onNodeTaskLine((line) => {
        setLines((prev) => [...prev, line.text].slice(-KEEP_LINES))
        if (line.error) addLog(`${line.task}: ${line.text}`, 'warn')
      }),
    [addLog]
  )

  const startPython = useCallback(
    async (id: string) => {
      setLines([])
      setNote('')
      try {
        // At most one task total, not one per backend: starting either kind
        // stops whatever the *other* backend has running. Each backend
        // already stops its own previous task on its own account
        // (python.rs/node.rs), so this only has work to do when the player
        // is switching from a task in one language to one in the other.
        await stopNodeTask()
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

  const startNode = useCallback(
    async (id: string) => {
      setLines([])
      setNote('')
      try {
        await stopTask()
        const st = await startNodeTask(id)
        setRunning(st.running ? `ts.${st.task}` : '')
        setActiveFlow(st.running ? st.task : null)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        setNote(message)
        addLog(`Could not start ${id}: ${message}`, 'error')
      }
    },
    [addLog, setActiveFlow]
  )

  const stop = useCallback(async () => {
    // Stopping both is cheap (each is a no-op when nothing of that language
    // is running) and correct regardless of which one is actually live,
    // without this component having to trust its own `running` string over
    // the OS.
    const [pySt, nodeSt2] = await Promise.all([stopTask(), stopNodeTask()])
    setRunning('')
    setNote(pySt.note || nodeSt2.note || 'Stopped.')
    setActiveFlow(null)
  }, [setActiveFlow])

  // SafetyFooter's Stop holds no reference to this panel. Pause and Resume are
  // deliberately not wired here any more: they are enforced in Rust at the
  // script-API dispatch point, so they hold every automated command including
  // scripts this app did not start. That is a widening, not an omission — the
  // old Pause only ever paused the seven flows this app shipped.
  useEffect(
    () =>
      onStopAll(() => {
        void stopTask()
        void stopNodeTask()
      }),
    []
  )

  // The Command Palette starts a task by id with no reference to this panel.
  // `f.lang` names which catalog it came from - the palette's own list is
  // built from the same merged `tasks` this panel derives below.
  useEffect(
    () => onStartFlow((f) => void (f.lang === 'typescript' ? startNode(f.id) : startPython(f.id))),
    [startNode, startPython]
  )

  // A task outlives this component — it is a separate process. Unmounting
  // clears only what this component published and deliberately does not stop
  // it: popping the panel out unmounts it, and that must not kill a hunt.
  useEffect(() => () => setActiveFlow(null), [setActiveFlow])

  const tasks: TaskInfo[] = useMemo(() => status?.tasks ?? [], [status])
  const nodeTasks = useMemo(() => nodeSt?.tasks ?? [], [nodeSt])
  const rubyScripts = useMemo(() => scripts.filter((s) => s.lang === 'ruby'), [scripts])
  const catalogErrors = [
    catalogs.python.error ? `Python: ${catalogs.python.error}` : null,
    catalogs.node.error ? `TypeScript: ${catalogs.node.error}` : null,
    catalogs.scripts.error ? `Scripts: ${catalogs.scripts.error}` : null,
    catalogs.dirs.error ? `Folders: ${catalogs.dirs.error}` : null,
  ].filter((item): item is string => item !== null)
  const orderedTasks = useMemo(() => orderTasks(tasks, tileOrder), [tasks, tileOrder])
  const reorderableTaskById = useMemo(
    () => new Map(orderedTasks.map((task) => [task.id, task])),
    [orderedTasks]
  )

  // Drop `id` where `overId` currently sits, everything between the two
  // sliding over by one - the ordinary "pick it up, put it down here" a
  // dragged tile is expected to do, rather than swapping the two positions
  // and leaving a hole where the tile you dropped onto used to be.
  //
  // `tileOrder`/`orderTasks` only knows the Python task catalog - TypeScript
  // (`ts.*`) and Ruby (`ruby.*`) entries never appear in `tasks`, so `next`
  // can never contain them. Callers must not offer this for those ids (see
  // `draggable` below); this still guards it explicitly rather than failing
  // silently. Also refuses a move that would land a task in a different
  // category from `overId`'s: `groupTasksByCategory` merges only consecutive
  // same-category items, and `orderTasks` has no category awareness of its
  // own, so a cross-category splice here would fragment that category into
  // two separate group headers the next time it renders.
  const moveTile = useCallback(
    (id: string, overId: string) => {
      const ordered = orderTasks(tasks, tileOrder)
      const next = moveTaskWithinCategory(ordered, id, overId)
      if (!next) return
      setTileOrder(next)
      writeJSON(TILE_ORDER_KEY, next)
    },
    [tasks, tileOrder]
  )

  /**
   * One combined list: every basic game function, every Python task, every
   * TypeScript task, then every Ruby script, filtered by name/summary. Tasks
   * already arrive sorted by `runner.py`'s `CATEGORY_ORDER`; appending
   * TypeScript and then Ruby after them - rather than interleaving - is what
   * keeps "Lich scripts" last once grouped, which is the right place for
   * "the whole dr-scripts suite plus whatever else is installed," not only
   * what a player wrote here.
   */
  const entries: Entry[] = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const matches = (title: string, summary: string) =>
      !q || title.toLowerCase().includes(q) || summary.toLowerCase().includes(q)

    const fromCommands: Entry[] = MACROS.flatMap((macro) =>
      macro.variations
        .filter((variation) => matches(variation.label, `${macro.label} ${variation.note ?? ''} ${variation.commands.join(' ')}`))
        .map((variation) => ({
          id: `command.${macro.id}.${variation.id}`,
          title: variation.label,
          baseIcon: COMMAND_ICON[macro.group],
          actionKey: `${macro.id}:${variation.id}`,
          tooltip:
            `${variation.label}\n${variation.note ?? macro.label}\n\n` +
            `${variation.commands.join(' ; ')}\n\nBasic game function — sends directly through the macro safety gate.` +
            (macroReason ? `\n\n${macroReason}` : ''),
          category: COMMAND_CATEGORY[macro.group],
          readOnly: false,
          disabled: !canSendMacro,
          run: () => runMacro(variation.commands),
        }))
    )

    const fromTasks: Entry[] = orderedTasks
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
        run: () => void startPython(t.id),
        editTarget: t.id.startsWith('user.')
          ? { name: t.id.slice('user.'.length), lang: 'python' as ScriptLang }
          : undefined,
      }))

    const fromNode: Entry[] = nodeTasks
      .filter((t) => matches(t.title, t.summary))
      .map((t) => ({
        id: `ts.${t.id}`,
        title: t.title,
        baseIcon: baseIconKeyFor(
          t.id,
          t.id.startsWith('user.') ? t.id.slice('user.'.length) : t.title,
          t.summary
        ),
        tooltip:
          `${t.title}\n${t.summary}\n\n${t.id} — ${t.kind}\n\n` +
          `Runs the same outside the app:\nnode typescript/runner.ts run ${t.id}`,
        category: TS_CATEGORY,
        readOnly: t.kind === 'read-only',
        run: () => void startNode(t.id),
        editTarget: t.id.startsWith('user.')
          ? { name: t.id.slice('user.'.length), lang: 'typescript' as ScriptLang }
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

    return [...fromCommands, ...fromTasks, ...fromNode, ...fromRuby]
  }, [orderedTasks, nodeTasks, rubyScripts, filter, startPython, startNode, startScript, addLog, runMacro, canSendMacro, macroReason])

  const groups = useMemo(() => groupTasksByCategory(entries), [entries])
  const entryVisualIndex = useMemo(
    () => new Map(entries.map((entry, index) => [entry.id, index])),
    [entries]
  )
  const commandCount = MACROS.reduce((count, macro) => count + macro.variations.length, 0)
  const totalCount = commandCount + tasks.length + nodeTasks.length + rubyScripts.length

  const openNew = useCallback((lang: ScriptLang) => {
    setEditing({ name: '', lang })
  }, [])

  if (editing) {
    return (
      <LazySurface label="Script editor">
        <ScriptEditor
          target={editing}
          dirs={dirs}
          onClose={() => setEditing(null)}
          onSaved={() => void refresh()}
          onRun={(id, lang) => {
            setEditing(null)
            void (lang === 'typescript' ? startNode(id) : startPython(id))
          }}
        />
      </LazySurface>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      {/* One hierarchy, one line: title, live state, global search/count, and
       * catalog controls are peers in the Functions & Scripts toolbar. */}
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border bg-surface px-2">
        {title && (
          <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-ink-muted">
            <Workflow className="h-4 w-4" aria-hidden /> {title}
          </span>
        )}
        <span
          className={cn(
            'min-w-0 max-w-36 truncate text-xs',
            running ? 'text-accent' : 'text-ink-faint'
          )}
          title={note || undefined}
        >
          {running ? `Running ${running.replace(/^ts\.|^ruby\./, '')}` : note || ''}
        </span>

        <Search className="ml-auto h-3 w-3 shrink-0 text-ink-faint" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter tasks and scripts"
          spellCheck={false}
          className="h-7 min-w-0 flex-1 rounded border border-border bg-surface-raised px-2 text-xs text-ink placeholder:text-ink-faint"
        />
        <span className="shrink-0 text-xs tabular-nums text-ink-faint">
          {filter ? `${entries.length}/${totalCount}` : totalCount}
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
            disabled={catalogs.refreshing}
            title="Re-read the task catalogs and the scripts folders"
            aria-label="Re-read the task catalogs and the scripts folders"
            className="shrink-0 rounded border border-border px-1.5 py-0.5 text-ink-faint hover:text-ink"
          >
            <RefreshCw className={cn('h-3 w-3', catalogs.refreshing && 'animate-spin')} />
          </button>
        )}
      </div>

      {catalogs.refreshing && <p role="status" className="px-1 text-xs text-ink-faint">Refreshing task and script catalogs…</p>}
      {catalogErrors.length > 0 && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded border border-warn/40 bg-warn/10 px-2 py-1 text-xs text-warn">
          <span>{catalogErrors.join(' · ')}</span>
          <button type="button" className="underline" onClick={() => void refresh()}>Retry failed sources</button>
        </div>
      )}

      {filter && entries.length === 0 && (
        <p className="px-1 text-xs text-ink-faint">
          Nothing matches "{filter}" in {totalCount} tasks and scripts.
        </p>
      )}

      <div
        {...scrollableRegionProps('Functions and scripts', 'both')}
        ref={gridRef}
        className={cn(
          'min-h-0 flex-1 overflow-auto',
          gridDragging ? 'cursor-grabbing select-none' : 'cursor-grab'
        )}
        onPointerDown={gridOnPointerDown}
        onPointerMove={gridOnPointerMove}
        onPointerUp={gridOnPointerUp}
        onPointerCancel={gridOnPointerCancel}
      >
        <div className="flex flex-col gap-1.5">
          {groups.map((group) => (
            <div key={group.category} className="flex flex-col gap-1">
              <p className="px-1 text-xs font-medium text-ink-faint">
                {group.category}
                <span className="ml-1 opacity-60">{group.items.length}</span>
              </p>
              <div className="grid grid-cols-[repeat(auto-fill,2rem)] gap-1">
                {group.items.map((entry) => {
                  const isCommand = entry.id.startsWith('command.')
                  // Only Python task ids ever appear in `tileOrder` (see
                  // `moveTile`) - TypeScript and Ruby entries can be picked
                  // up but can never actually be dropped anywhere, so don't
                  // offer the gesture for them at all.
                  const isReorderable = reorderableTaskById.has(entry.id)
                  const draggedTask = draggingId ? reorderableTaskById.get(draggingId) : undefined
                  const targetTask = reorderableTaskById.get(entry.id)
                  const acceptsDraggedTile =
                    draggedTask !== undefined &&
                    targetTask !== undefined &&
                    draggedTask.id !== targetTask.id &&
                    draggedTask.category === targetTask.category
                  const overrideKey = isCommand ? null : iconOverrideFor(entry.id)
                  const iconKey = overrideKey ?? entry.baseIcon
                  const Icon = entry.actionKey ? actionIcon(entry.actionKey) : SCRIPT_ICON_COMPONENT[iconKey]
                  const tileStyle = entry.actionKey
                    ? actionAccent(entry.actionKey)
                    : accentForIndex(entryVisualIndex.get(entry.id) ?? 0)
                  const active = running === entry.id
                  const isDragging = draggingId === entry.id
                  const isDropTarget = dropTargetId === entry.id && acceptsDraggedTile
                  // Ruby scripts are identified to the bridge by name, not by
                  // the synthetic `ruby.${name}` id this panel groups them
                  // under - see quickSwitch.ts's own header on why a pin is a
                  // tagged union rather than a bare id.
                  const quickSwitchPin: QuickSwitchPin = isCommand
                    ? { kind: 'command', actionKey: entry.actionKey! }
                    : entry.id.startsWith('ruby.')
                    ? { kind: 'script', name: entry.id.slice('ruby.'.length) }
                    : { kind: 'task', id: entry.id }
                  const pinned = isPinned(quickSwitchPins, quickSwitchPin)
                  return (
                    <div
                      key={entry.id}
                      className={cn(
                        'group relative',
                        isDragging && 'opacity-40',
                        isDropTarget && 'scale-105 rounded ring-2 ring-accent ring-offset-1 ring-offset-surface'
                      )}
                      // Native HTML5 drag and drop, same mechanism Panel.tsx
                      // uses for reordering the dashboard's own panels - one
                      // gesture, pick it up and put it where you want it, no
                      // arrows. The wrapper div is the drag surface (not the
                      // button) so the reorder gesture and the pointer-based
                      // grid-scroll gesture above don't fight over the same
                      // element's events.
                      draggable={isReorderable}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/plain', entry.id)
                        setDraggingId(entry.id)
                      }}
                      onDragEnd={() => {
                        setDraggingId(null)
                        setDropTargetId(null)
                      }}
                      onDragOver={(e) => {
                        if (!acceptsDraggedTile) return
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                        setDropTargetId(entry.id)
                      }}
                      onDrop={(e) => {
                        if (acceptsDraggedTile) {
                          e.preventDefault()
                          if (draggingId) moveTile(draggingId, entry.id)
                        }
                        setDraggingId(null)
                        setDropTargetId(null)
                      }}
                    >
                      <button
                        type="button"
                        disabled={entry.disabled}
                        onClick={entry.run}
                        onContextMenu={isCommand ? undefined : (e) => {
                          e.preventDefault()
                          setPickingIcon({ id: entry.id, title: entry.title, base: entry.baseIcon })
                        }}
                        title={`${entry.tooltip}${isCommand ? '' : `\n\n(right-click to choose an icon${isReorderable ? ', drag to rearrange' : ''})`}`}
                        data-action={entry.actionKey}
                        data-entry-id={entry.id}
                        className={cn(
                          'flex h-8 w-8 items-center justify-center overflow-hidden rounded border transition duration-150 hover:-translate-y-px hover:brightness-125 active:translate-y-0 active:scale-95 disabled:cursor-not-allowed disabled:opacity-35 disabled:saturate-0',
                          active
                            ? 'ring-2 ring-accent ring-offset-1 ring-offset-surface'
                            : entry.readOnly
                              ? 'opacity-70'
                              : ''
                        )}
                        style={tileStyle}
                      >
                        <Icon
                          className={cn(
                            'h-4 w-4 drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]',
                            entry.readOnly && 'opacity-70'
                          )}
                        />
                      </button>
                      {active && (
                        <Play className="pointer-events-none absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-surface text-accent" />
                      )}
                      {(
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleQuickSwitchPin(quickSwitchPin)
                          }}
                          title={
                            pinned
                              ? 'Remove from the hotbar'
                              : 'Add to the hotbar — one click or a number key from anywhere in the app'
                          }
                          aria-label={`${pinned ? 'Remove' : 'Add'} ${entry.title} ${pinned ? 'from' : 'to'} the hotbar`}
                          className={cn(
                            'absolute -left-1 -top-1 rounded-full bg-surface p-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100',
                            pinned && 'opacity-100',
                            pinned ? 'text-accent' : 'text-ink-faint hover:text-ink-muted'
                          )}
                        >
                          <Star className="h-2.5 w-2.5" fill={pinned ? 'currentColor' : 'none'} />
                        </button>
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
              className="grid h-8 w-8 place-items-center rounded border border-dashed border-border text-ink-faint hover:border-ink-faint hover:text-ink"
            >
              <FilePlus2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => openNew('typescript')}
              title="Write a new TypeScript task. Saved into typescript/tasks/user/, where it is picked up automatically. Needs Node.js 22.6+ or 24+."
              className="grid h-8 w-8 place-items-center rounded border border-dashed border-border text-ink-faint hover:border-ink-faint hover:text-ink"
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
              className="grid h-8 w-8 place-items-center rounded border border-dashed border-border text-ink-faint hover:border-ink-faint hover:text-ink"
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
