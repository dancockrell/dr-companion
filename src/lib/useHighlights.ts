/**
 * The player's highlight config, loaded once and shared.
 *
 * Two panes paint game text now - the main window and the channel tabs - and
 * each loading its own copy would mean two parses of the same file, two
 * moments where they could disagree, and a config reload that fixed one of
 * them. A highlight means one thing everywhere or it means nothing.
 *
 * Module-level rather than a context, because there is exactly one config per
 * running app and threading a provider through the tree to say so would be
 * ceremony around a constant.
 */
import { useEffect, useState } from 'react'
import { parseHighlights, type Highlight } from './highlights.ts'
import { invokeTauri, isTauri } from './tauri.ts'

let cached: Highlight[] | null = null
let note = ''
let inFlight: Promise<void> | null = null
const listeners = new Set<() => void>()

async function load() {
  if (!isTauri()) {
    cached = []
    note = 'No highlights in a browser: the config lives beside Genie.'
    return
  }
  try {
    const cfg = (await invokeTauri('read_genie_config', { leaf: 'highlights.cfg' })) as {
      found: boolean
      text: string
      note: string
    }
    if (!cfg.found) {
      cached = []
      note = cfg.note
      return
    }
    const { entries, skipped } = parseHighlights(cfg.text)
    cached = entries
    // Genie drops malformed entries in silence, which is the single failure
    // dr-genie-settings/validate.mjs exists to catch. Inheriting the format is
    // not a reason to inherit the bug.
    note = skipped.length
      ? `${entries.length} highlights, ${skipped.length} skipped`
      : `${entries.length} highlights`
  } catch (e) {
    cached = []
    note = String(e)
  }
}

export function useHighlights(): { highlights: Highlight[]; note: string } {
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

  return { highlights: cached ?? [], note }
}

/** Read the config again, for when it has been edited. */
export function reloadHighlights() {
  cached = null
  note = ''
  if (!inFlight) {
    inFlight = load().finally(() => {
      inFlight = null
      for (const l of listeners) l()
    })
  }
}
