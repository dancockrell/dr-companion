/**
 * The player's substitute config, loaded once and shared - same shape as
 * `useAliases`/`useMacros`.
 */
import { useEffect, useState } from 'react'
import { loadSubstituteConfig, type Substitute } from './substitutes.ts'

let cached: Substitute[] | null = null
let note = ''
let inFlight: Promise<void> | null = null
const listeners = new Set<() => void>()

async function load() {
  const cfg = await loadSubstituteConfig()
  cached = cfg.entries
  note = cfg.note
}

export function useSubstitutes(): { substitutes: Substitute[]; note: string } {
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

  return { substitutes: cached ?? [], note }
}

/** Read the config again, for when it has been edited through SubstitutesEditor. */
export function reloadSubstitutes() {
  cached = null
  note = ''
  if (!inFlight) {
    inFlight = load().finally(() => {
      inFlight = null
      for (const l of listeners) l()
    })
  }
}
