/**
 * Genie's UI colour presets, loaded once and shared - same shape as
 * `useAliases`/`useMacros`.
 */
import { useEffect, useState } from 'react'
import { loadPresetConfig, type Preset } from './presets.ts'

let cached: Preset[] | null = null
let note = ''
let inFlight: Promise<void> | null = null
const listeners = new Set<() => void>()

async function load() {
  const cfg = await loadPresetConfig()
  cached = cfg.entries
  note = cfg.note
}

export function usePresets(): { presets: Preset[]; note: string } {
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

  return { presets: cached ?? [], note }
}

/** Read the config again, for when it has been edited through PresetsEditor. */
export function reloadPresets() {
  cached = null
  note = ''
  if (!inFlight) {
    inFlight = load().finally(() => {
      inFlight = null
      for (const l of listeners) l()
    })
  }
}
