/**
 * TypeScript tasks — the same remote control as `pythonTasks.ts`, pointed at
 * `typescript/runner.ts` and the Rust commands in `src-tauri/src/node.rs`
 * instead of `runner.py`/`python.rs`.
 *
 * Deliberately a near-duplicate of `pythonTasks.ts` rather than one generic
 * module parameterised by language: the two event channels (`node:line` vs
 * `python:line`) and Tauri commands are genuinely different names, and a
 * shared abstraction over "which backend" would need a parameter at every
 * call site for a saving of maybe a dozen lines. `node.rs` mirrors
 * `python.rs` for the same reason, stated in that file's own header.
 *
 * The one thing this file does not duplicate is the "one task at a time"
 * rule: that is enforced per-backend in Rust (starting a Python task stops
 * a running Python task; starting a Node one stops a running Node one), but
 * *across* the two backends it is enforced by the caller — see
 * `TaskFlowPanel.tsx`'s `start()`, which stops whichever backend is not the
 * one about to run before starting the other. Two processes driving one
 * character at once is exactly the bug the single-backend rule exists to
 * prevent, and it doesn't stop mattering because the two processes happen to
 * be written in different languages.
 */
import { invokeTauri, listenTauri, isTauri } from './tauri.ts'

/** One runnable task, as `typescript/runner.ts` describes it. */
export type NodeTaskInfo = {
  id: string
  title: string
  summary: string
  kind: string
}

export type NodeStatus = {
  /** The Node command found, or null when none is usable. */
  node: string | null
  tasksDir: string | null
  tasks: NodeTaskInfo[]
  note: string
}

export type NodeTaskState = {
  running: boolean
  task: string
  note: string
}

export type NodeTaskLine = {
  task: string
  text: string
  error: boolean
}

const IDLE: NodeTaskState = { running: false, task: '', note: '' }

export async function nodeStatus(): Promise<NodeStatus> {
  const raw = await invokeTauri('node_status')
  if (!raw || typeof raw !== 'object') {
    return {
      node: null,
      tasksDir: null,
      tasks: [],
      note: isTauri()
        ? 'The task backend did not answer.'
        : 'Tasks run in the app, not in a browser preview.',
    }
  }
  return raw as NodeStatus
}

export async function startNodeTask(id: string): Promise<NodeTaskState> {
  const raw = await invokeTauri('run_node_task', { name: id })
  return (raw as NodeTaskState) ?? IDLE
}

export async function stopNodeTask(): Promise<NodeTaskState> {
  const raw = await invokeTauri('stop_node_task')
  return (raw as NodeTaskState) ?? IDLE
}

export async function nodeTaskState(): Promise<NodeTaskState> {
  const raw = await invokeTauri('node_task_state')
  return (raw as NodeTaskState) ?? IDLE
}

export function onNodeTaskLine(handler: (line: NodeTaskLine) => void): () => void {
  return listenTauri<NodeTaskLine>('node:line', handler)
}

export function onNodeTaskState(handler: (state: NodeTaskState) => void): () => void {
  return listenTauri<NodeTaskState>('node:state', handler)
}
