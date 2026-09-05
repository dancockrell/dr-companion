/**
 * The player's macro config, loaded once and shared - same shape as
 * `useAliases`/`useHighlights` and for the same reason: one config per
 * running app, module-level rather than a context, so a save through the
 * editor is visible everywhere at once.
 */
import { useEffect, useState } from 'react'
import { loadMacroConfig, type Macro } from './macros.ts'

let cached: Macro[] | null = null
let note = ''
let inFlight: Promise<void> | null = null
const listeners = new Set<() => void>()

async function load() {
  const cfg = await loadMacroConfig()
  cached = cfg.entries
  note = cfg.note
}

export function useMacros(): { macros: Macro[]; note: string } {
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

  return { macros: cached ?? [], note }
}

/** Read the config again, for when it has been edited through MacrosEditor. */
export function reloadMacros() {
  cached = null
  note = ''
  if (!inFlight) {
    inFlight = load().finally(() => {
      inFlight = null
      for (const l of listeners) l()
    })
  }
}
