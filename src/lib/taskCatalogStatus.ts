import { useSyncExternalStore } from 'react'
import { nodeStatus, type NodeStatus } from './nodeTasks.ts'
import { pythonStatus, type PythonStatus } from './pythonTasks.ts'
import { listScripts, scriptDirs, type ScriptDirs, type ScriptFile } from './scriptFiles.ts'
import { failedResource, fulfilledResource, loadingResource, type AsyncResource } from './asyncState.ts'

export type ResourceState<T> = AsyncResource<T>

export interface TaskCatalogSnapshot {
  python: ResourceState<PythonStatus>
  node: ResourceState<NodeStatus>
  scripts: ResourceState<ScriptFile[]>
  dirs: ResourceState<ScriptDirs>
  refreshing: boolean
  generation: number
}

let snapshot: TaskCatalogSnapshot = {
  python: loadingResource(), node: loadingResource(), scripts: loadingResource(), dirs: loadingResource(), refreshing: false, generation: 0,
}
const listeners = new Set<() => void>()
let started = false

function publish(next: TaskCatalogSnapshot) {
  snapshot = next
  listeners.forEach((listener) => listener())
}

function settled<T>(result: PromiseSettledResult<T>, previous: ResourceState<T>, empty: (value: T) => boolean): ResourceState<T> {
  if (result.status === 'fulfilled') return fulfilledResource(result.value, empty)
  return failedResource(previous, result.reason)
}

export async function refreshTaskCatalogs(): Promise<void> {
  const generation = snapshot.generation + 1
  publish({ ...snapshot, refreshing: true, generation })
  const [python, node, scripts, dirs] = await Promise.allSettled([
    pythonStatus(), nodeStatus(), listScripts(), scriptDirs(),
  ])
  if (snapshot.generation !== generation) return
  publish({
    python: settled(python, snapshot.python, (value) => value.tasks.length === 0),
    node: settled(node, snapshot.node, (value) => value.tasks.length === 0),
    scripts: settled(scripts, snapshot.scripts, (value) => value.length === 0),
    dirs: settled(dirs, snapshot.dirs, () => false),
    refreshing: false,
    generation,
  })
}

export function subscribeTaskCatalogs(listener: () => void) {
  listeners.add(listener)
  if (!started) {
    started = true
    void refreshTaskCatalogs()
  }
  return () => listeners.delete(listener)
}

export function getTaskCatalogSnapshot() {
  return snapshot
}

export function useTaskCatalogs() {
  return useSyncExternalStore(subscribeTaskCatalogs, getTaskCatalogSnapshot, getTaskCatalogSnapshot)
}
