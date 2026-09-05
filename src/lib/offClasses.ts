/**
 * Which highlight classes are muted - Genie's own `#class {name} off`
 * concept, which `highlights.ts`'s `paint()` already accepts as an `off` set
 * but which nothing in this app actually populated until now.
 *
 * Deliberately not written into `highlights.cfg` itself: Genie's `#class off`
 * is a config directive that changes the file everyone shares, while this is
 * a per-listener display preference - a player muting the "people" class
 * because arrivals are noise to them should not silently mute it for anyone
 * whose settings they later share. Persisted separately, in localStorage,
 * the same way sound-channel volumes are.
 */
import { useEffect, useState } from 'react'
import { readJSON, writeJSON } from './storage.ts'

const KEY = 'drc.off-highlight-classes.v1'

let cached: Set<string> | null = null
const listeners = new Set<() => void>()

function load(): Set<string> {
  if (cached) return cached
  cached = new Set(readJSON<string[]>(KEY, []))
  return cached
}

function persist() {
  writeJSON(KEY, [...(cached ?? [])])
}

/** The current off-set, read fresh - for call sites that are not React
 * components (or that only need one read, not live updates). */
export function offClasses(): Set<string> {
  return load()
}

export function toggleClass(cls: string) {
  const set = load()
  if (set.has(cls)) set.delete(cls)
  else set.add(cls)
  persist()
  for (const l of listeners) l()
}

/** Live-subscribed version, for anything that renders based on which classes
 * are off - the game pane's painting, and the toggle switches themselves. */
export function useOffClasses(): Set<string> {
  const [, bump] = useState(0)
  useEffect(() => {
    load()
    const fn = () => bump((n) => n + 1)
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }, [])
  return load()
}
