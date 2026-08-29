/**
 * The player's `#var` table, loaded once and shared - same shape as
 * `useAliases`/`useMacros`. Reload matters more here than for the others:
 * unlike highlights/aliases/macros, this file is partly live game state
 * Genie rewrites while playing (see `variables.ts`'s header), so a value
 * read five minutes ago may already be stale in a way a config file never
 * is.
 */
import { useEffect, useState } from 'react'
import { loadVariableConfig, type Variable } from './variables'

let cached: Variable[] | null = null
let note = ''
let inFlight: Promise<void> | null = null
const listeners = new Set<() => void>()

async function load() {
  const cfg = await loadVariableConfig()
  cached = cfg.entries
  note = cfg.note
}

export function useVariables(): { variables: Variable[]; note: string } {
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

  return { variables: cached ?? [], note }
}

/** Read the config again - e.g. a player clicking "refresh" in the
 * variables panel because Genie has been running and the values moved on. */
export function reloadVariables() {
  cached = null
  note = ''
  if (!inFlight) {
    inFlight = load().finally(() => {
      inFlight = null
      for (const l of listeners) l()
    })
  }
}
