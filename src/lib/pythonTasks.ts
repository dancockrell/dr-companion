/**
 * Tasks, which used to be flows, and used to be TypeScript.
 *
 * This replaces `flowDriver.ts`, `flowRunner.ts`, `flowConditions.ts` and
 * `taskFlows.ts`. Those four files were a scripting language — a step format,
 * a driver with a timer, and a hand-written parser for condition strings like
 * `health<50` — implemented in TypeScript inside a project whose scripting
 * language is Python. The flows now live in `python/tasks/` and this file is
 * only the remote control: list, start, stop, and report.
 *
 * # What moved, and what that bought
 *
 * `flowConditions.ts` is gone outright. A condition is now an expression:
 *
 *     was    { commands: ['tend my worst'], condition: 'bleeding' }
 *     is     Step('Tending', ['tend my worst'], when=lambda t: t.bleeding)
 *
 * The parser existed to make the first line mean something. The second needs
 * no parser, and `when=lambda f: f.health.percent < 50 and not f.in_combat`
 * needs no new feature, whereas the grammar needed one per idea.
 *
 * `flowDriver.ts`'s timer is gone too. It stepped on a wall clock because the
 * browser had no way to know when the game was ready; a task waits on what the
 * game actually said (`until=r'Bank|teller'`), with a timeout as the backstop
 * rather than the mechanism.
 *
 * # There is no driver in the frontend any more, and that is the point
 *
 * A task is a separate process holding a script-API socket. Nothing in this
 * file schedules anything, so the class of bug those files hit twice — a
 * driver reporting stopped while its timer kept firing underneath — cannot be
 * written here. Stop kills a process; there is no half-stopped state.
 *
 * Which also means running state is *asked for*, never remembered: see
 * `taskState()`. A cached "running" flag that has gone stale looks exactly
 * like a live one, and this app has paid for that mistake before.
 */
import { invokeTauri, listenTauri, isTauri } from './tauri'

/** One runnable task, as `python/runner.py` describes it. */
export type TaskInfo = {
  id: string
  title: string
  summary: string
  /**
   * `read-only` or `sends commands`. Surfaced in the UI rather than kept
   * internal: a task that watches and a task that drives a live character
   * are different enough that the button should say so before it is pressed.
   */
  kind: string
  /**
   * "Combat", "Recovery", "Upkeep", "Utility", "Custom" or "Examples" -
   * `runner.py`'s `CATEGORY_ORDER`. The catalog already arrives grouped by
   * this (the Python side sorts it), so the UI only has to notice where one
   * group ends and the next begins, never sort by it itself - see
   * TaskFlowPanel.tsx.
   */
  category: string
}

export type PythonStatus = {
  /** The interpreter, or null when none was found. */
  python: string | null
  tasksDir: string | null
  tasks: TaskInfo[]
  /**
   * Why the list is empty, when it is. Four different causes — no Python, no
   * task folder, a catalog that would not import, a catalog that listed
   * nothing — need four different fixes, so they are never collapsed into one
   * "no tasks" that sends somebody to look in the wrong place.
   */
  note: string
}

export type TaskState = {
  running: boolean
  /** Which task, while one is running. Empty otherwise. */
  task: string
  /** Set when a task ended on its own, or could not be checked. */
  note: string
}

export type TaskLine = {
  task: string
  text: string
  /** True for stderr — a task's diagnostics, not what it chose to report. */
  error: boolean
}

const IDLE: TaskState = { running: false, task: '', note: '' }

/** What a script needs to connect: the port it should dial, and where its token lives. */
export type ScriptApiInfo = {
  /** `null` before the socket has bound - no task or script has started it yet. */
  port: number | null
  tokenPath: string
}

/**
 * `Companion()` (see `docs/PYTHON_API.md`) reads both of these off disk on its
 * own, so nothing a player runs actually needs this call - it exists for a
 * human confirming the socket is up, or pointing a non-Python client at it by
 * hand. `script_api_info` on the Rust side has carried this since it was
 * written and nothing called it until now - see ScriptApiPanel.tsx.
 */
export async function scriptApiInfo(): Promise<ScriptApiInfo> {
  const raw = (await invokeTauri('script_api_info')) as
    | { port?: number | null; tokenPath?: string }
    | undefined
  return { port: raw?.port ?? null, tokenPath: raw?.tokenPath ?? '' }
}

/** What can be run, and why nothing can, when nothing can. */
export async function pythonStatus(): Promise<PythonStatus> {
  const raw = await invokeTauri('python_status')
  if (!raw || typeof raw !== 'object') {
    return {
      python: null,
      tasksDir: null,
      tasks: [],
      note: isTauri()
        ? 'The task backend did not answer.'
        : 'Tasks run in the app, not in a browser preview.',
    }
  }
  return raw as PythonStatus
}

/**
 * Start a task. Starting one replaces whatever was running.
 *
 * Two tasks driving one character is never what anybody meant, and a second
 * press reads as a correction rather than a request for both — the one call
 * `FlowDriver.start` got right, kept.
 */
export async function startTask(id: string): Promise<TaskState> {
  const raw = await invokeTauri('run_python_task', { name: id })
  return (raw as TaskState) ?? IDLE
}

export async function stopTask(): Promise<TaskState> {
  const raw = await invokeTauri('stop_python_task')
  return (raw as TaskState) ?? IDLE
}

/**
 * Whether a task is running — asked, not remembered.
 *
 * Rust answers this by asking the operating system about the process, so a
 * task that exited on its own reports as stopped rather than leaving a flag
 * saying otherwise.
 */
export async function taskState(): Promise<TaskState> {
  const raw = await invokeTauri('python_task_state')
  return (raw as TaskState) ?? IDLE
}

/** Every line a running task prints. Returns an unsubscribe function. */
export function onTaskLine(handler: (line: TaskLine) => void): () => void {
  return listenTauri<TaskLine>('python:line', handler)
}

/** Start/stop transitions pushed from Rust. Returns an unsubscribe function. */
export function onTaskState(handler: (state: TaskState) => void): () => void {
  return listenTauri<TaskState>('python:state', handler)
}

/**
 * Hold or release every automated command.
 *
 * Pause is enforced in Rust at the script-API dispatch point, which is the one
 * line every automated command crosses. That is a real widening: the old Pause
 * lived in `flowDriver.ts` and stopped the driver scheduling its next step, so
 * it paused the seven flows this app shipped and nothing else — a hand-written
 * Lich script, or anything else holding a script socket, went straight past it.
 *
 * Commands are delayed, not dropped, and what the player types is never gated.
 * Returns the resulting state, so no caller has to assume the toggle took.
 */
export async function setPaused(paused: boolean): Promise<boolean> {
  const raw = await invokeTauri('set_paused', { paused })
  return typeof raw === 'boolean' ? raw : paused
}

export async function isPaused(): Promise<boolean> {
  return (await invokeTauri('is_paused')) === true
}
