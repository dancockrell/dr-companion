/**
 * The player's gag config, loaded once and shared - same shape as
 * `useAliases`/`useMacros`.
 */
import { useEffect, useState } from 'react'
import { loadGagConfig, type Gag } from './gags'

let cached: Gag[] | null = null
let note = ''
let inFlight: Promise<void> | null = null
const listeners = new Set<() => void>()

async function load() {
  const cfg = await loadGagConfig()
  cached = cfg.entries
  note = cfg.note
}

export function useGags(): { gags: Gag[]; note: string } {
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

  return { gags: cached ?? [], note }
}

/** Read the config again, for when it has been edited through GagsEditor. */
export function reloadGags() {
  cached = null
  note = ''
  if (!inFlight) {
    inFlight = load().finally(() => {
      inFlight = null
      for (const l of listeners) l()
    })
  }
}
