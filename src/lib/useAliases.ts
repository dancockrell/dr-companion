/**
 * The player's alias config, loaded once and shared.
 *
 * Same shape as `useHighlights` and for the same reason: one config per
 * running app, module-level rather than a context, so a reload fixes every
 * consumer at once rather than one of them. `aliases.ts` owns the parsing and
 * the file read; this owns only the caching and the subscription.
 *
 * Dan's real file has 356 entries and they are how he types. `appc sword`
 * meaning `appraise sword careful` is not a convenience feature to him, it is
 * the vocabulary — which is why the note below reports the denominator rather
 * than a count. A parser that silently drops half the file and one that works
 * look identical if all you print is how many loaded.
 */
import { useEffect, useState } from 'react'
import { loadAliasConfig, type Alias } from './aliases.ts'

let cached: Alias[] | null = null
let note = ''
let inFlight: Promise<void> | null = null
const listeners = new Set<() => void>()

async function load() {
  const cfg = await loadAliasConfig()
  cached = cfg.entries
  note = cfg.note
}

export function useAliases(): { aliases: Alias[]; note: string } {
  const [, bump] = useState(0)

  useEffect(() => {
    const fn = () => bump((n) => n + 1)
    listeners.add(fn)

    if (cached === null && !inFlight) {
      inFlight = load().finally(() => {
        inFlight = null
        for (const l of listeners) l()
      })
    }

    return () => {
      listeners.delete(fn)
    }
  }, [])

  return { aliases: cached ?? [], note }
}

/** Read the config again, for when it has been edited - same shape as
 * `useHighlights`'s `reloadHighlights`, added 29 Aug 2026 alongside the
 * in-app alias editor, which is the first thing that ever needed it. */
export function reloadAliases() {
  cached = null
  note = ''
  if (!inFlight) {
    inFlight = load().finally(() => {
      inFlight = null
      for (const l of listeners) l()
    })
  }
}
