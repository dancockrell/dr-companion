/**
 * Grouping the Tasks tab's catalog by category, for TaskFlowPanel.tsx.
 *
 * Its own file, separate from pythonTasks.ts, on purpose: that file imports
 * `invokeTauri`/`listenTauri` from `./tauri` at runtime, which a plain
 * `node --experimental-strip-types` test cannot resolve without a bundler.
 * This file's only import is `import type`, fully erased at compile time
 * (see pinTaskGenerator.ts's own comment for the same reasoning), so
 * `tools/task-grouping-test.mjs` can import it directly.
 */
import type { TaskInfo } from './pythonTasks'

/**
 * Tasks, grouped by category, in the order categories first appear.
 *
 * The catalog already arrives sorted by `runner.py`'s `CATEGORY_ORDER` -
 * this only has to notice where one group ends and the next begins, which is
 * why it walks the list once rather than sorting again: a second sort here
 * could disagree with the Python side's own order (a stable-vs-unstable sort
 * difference, or a category this file has never heard of) and nobody would
 * notice, because the result would still look sorted.
 */
export function groupTasksByCategory(tasks: TaskInfo[]): { category: string; items: TaskInfo[] }[] {
  const groups: { category: string; items: TaskInfo[] }[] = []
  for (const t of tasks) {
    const last = groups[groups.length - 1]
    if (last && last.category === t.category) last.items.push(t)
    else groups.push({ category: t.category, items: [t] })
  }
  return groups
}
