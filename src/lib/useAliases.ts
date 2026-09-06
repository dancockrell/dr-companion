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
import { resolveAliases, resolveVariables, type Alias } from './aliases.ts'
import { loadPlayerConfig, subscribePlayerConfig } from './playerConfig.ts'

export interface ResolvedAliases {
  aliases: Alias[]
  /**
   * `$name` to its value, handed to `expandAlias` beside the table.
   *
   * Returned here rather than looked up inside `expandAlias` so the expander
   * stays pure, and so one subscription feeds both halves: an alias and its
   * variables arriving in two renders would let `$shop` resolve against a table
   * one edit behind the alias reading it.
   */
  variables: Map<string, string>
  note: string
}

/** What the hook returns, without being a hook - see `currentHighlights`. */
export function currentAliases(): ResolvedAliases {
  const cfg = loadPlayerConfig()
  const { entries, refused } = resolveAliases(cfg)
  const { variables } = resolveVariables(cfg)
  const aliasNote = refused.length
    ? `${entries.length} of ${cfg.aliases.length} aliases, ${refused.length} switched off`
    : `${entries.length} of ${cfg.aliases.length} aliases`
  // Both denominators, because an expansion that quietly stopped resolving
  // `$shop` looks exactly like one that never had a variable in it.
  const note = `${aliasNote}, ${variables.size} of ${cfg.variables.length} variables`
  return { aliases: entries, variables, note }
}

export function useAliases(): ResolvedAliases {
  const [, bump] = useState(0)
  useEffect(() => subscribePlayerConfig(() => bump((n) => n + 1)), [])
  return currentAliases()
}
