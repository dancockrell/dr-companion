/**
 * Grouping the unified Tasks & Scripts panel's tiles by category, for
 * TaskFlowPanel.tsx.
 *
 * Its own file, separate from pythonTasks.ts, on purpose: that file imports
 * `invokeTauri`/`listenTauri` from `./tauri` at runtime, which a plain
 * `node --experimental-strip-types` test cannot resolve without a bundler.
 * This file has no runtime imports at all, so `tools/task-grouping-test.mjs`
 * can import it directly.
 */

/**
 * Items, grouped by category, in the order categories first appear.
 *
 * `T` is generic - originally this only took `TaskInfo[]` (the Python
 * catalog, pre-sorted by `runner.py`'s `CATEGORY_ORDER`), and stayed generic
 * when the panel stopped having a separate "Scripts" tab and started
 * building one combined tile list (tasks plus Lich/Ruby scripts) that needs
 * the exact same grouping. Genuinely the same operation on a different
 * shape, not two features that happen to look alike.
 *
 * This only has to notice where one group ends and the next begins, which is
 * why it walks the list once rather than sorting again: a second sort here
 * could disagree with the caller's own order (a stable-vs-unstable sort
 * difference, or a category this file has never heard of) and nobody would
 * notice, because the result would still look sorted.
 */
export function groupTasksByCategory<T extends { category: string }>(
  items: T[]
): { category: string; items: T[] }[] {
  const groups: { category: string; items: T[] }[] = []
  for (const t of items) {
    const last = groups[groups.length - 1]
    if (last && last.category === t.category) last.items.push(t)
    else groups.push({ category: t.category, items: [t] })
  }
  return groups
}

/**
 * Return the new flat id order for a drop the task catalog can represent.
 * Non-catalog entries and cross-category targets are rejected together so
 * drag sources, target highlighting, and the persisted move share one rule.
 */
export function moveTaskWithinCategory<T extends { id: string; category: string }>(
  ordered: T[],
  id: string,
  overId: string
): string[] | null {
  if (!canMoveTaskWithinCategory(ordered, id, overId)) return null
  const next = ordered.map((item) => item.id)
  const from = next.indexOf(id)
  next.splice(from, 1)
  const to = next.indexOf(overId)
  if (to === -1) return null
  next.splice(to, 0, id)
  return next
}

/** The single eligibility rule used by drag feedback and persisted moves. */
export function canMoveTaskWithinCategory<T extends { id: string; category: string }>(
  ordered: T[],
  id: string,
  overId: string
): boolean {
  if (id === overId) return false
  const byId = new Map(ordered.map((item) => [item.id, item]))
  const fromTask = byId.get(id)
  const overTask = byId.get(overId)
  return fromTask !== undefined && overTask !== undefined && fromTask.category === overTask.category
}
