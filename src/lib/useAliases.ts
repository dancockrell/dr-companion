/**
 * The player's aliases, read from the app's own store.
 *
 * Same shape as `useHighlights` and for the same reason: one config per
 * running app, module-level rather than a context, so a change reaches every
 * consumer at once rather than one of them. `aliases.ts` owns the format and
 * `resolveAliases`; this owns only the subscription.
 *
 * Dan's real file has 356 entries and they are how he types. `appc sword`
 * meaning `appraise sword careful` is not a convenience feature to him, it is
 * the vocabulary - which is why the note reports the denominator rather than a
 * count. A resolver that silently drops half of them and one that works look
 * identical if all you print is how many loaded.
 *
 * The source is `playerConfig.ts` now, not `read_genie_config('aliases.cfg')`
 * (Q1, Lane Q): the import reads that file once, when the player asks.
 */
import { useEffect, useState } from 'react'
import { resolveAliases, type Alias } from './aliases.ts'
import { loadPlayerConfig, subscribePlayerConfig } from './playerConfig.ts'

/** What the hook returns, without being a hook - see `currentHighlights`. */
export function currentAliases(): { aliases: Alias[]; note: string } {
  const cfg = loadPlayerConfig()
  const { entries, refused } = resolveAliases(cfg)
  const note = refused.length
    ? `${entries.length} of ${cfg.aliases.length} aliases, ${refused.length} switched off`
    : `${entries.length} of ${cfg.aliases.length} aliases`
  return { aliases: entries, note }
}

export function useAliases(): { aliases: Alias[]; note: string } {
  const [, bump] = useState(0)
  useEffect(() => subscribePlayerConfig(() => bump((n) => n + 1)), [])
  return currentAliases()
}
