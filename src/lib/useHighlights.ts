/**
 * The player's highlight rules, read from the app's own store.
 *
 * This used to read `read_genie_config('highlights.cfg')`, which meant a
 * player with no Genie install had no highlights and no way to make one. It
 * reads `playerConfig.ts` now (Q1, Lane Q); Genie's file is read exactly once,
 * by an import the player asks for, and never again by the running app.
 *
 * The signature is deliberately unchanged, so `GameLineRow`,
 * `HighlightedText`, `GameSignals`, `BattleColumn` and `GameChatColumn` are
 * untouched by the change of source: what a highlight *is* did not change,
 * only where it comes from.
 *
 * Module-level rather than a context, because there is exactly one config per
 * running app and threading a provider through the tree to say so would be
 * ceremony around a constant.
 */
import { useEffect, useState } from 'react'
import { resolveHighlights, type Highlight } from './highlights.ts'
import { loadPlayerConfig, subscribePlayerConfig } from './playerConfig.ts'

/**
 * What the hook returns, without being a hook.
 *
 * Exported so a check can drive the store and observe the runtime, rather than
 * observing a resolver call it wrote itself and calling that the same thing.
 */
export function currentHighlights(): { highlights: Highlight[]; note: string } {
  const cfg = loadPlayerConfig()
  const { entries, refused } = resolveHighlights(cfg)
  // The denominator, not only the count that loaded. A resolver that refused
  // half the rules and one that worked print the same thing otherwise, and
  // Genie's own silence about the rules it drops is the failure this app
  // declined to inherit along with the format.
  const note = refused.length
    ? `${entries.length} of ${cfg.highlights.length} highlights, ${refused.length} refused`
    : `${entries.length} of ${cfg.highlights.length} highlights`
  return { highlights: entries, note }
}

export function useHighlights(): { highlights: Highlight[]; note: string } {
  const [, bump] = useState(0)
  useEffect(() => subscribePlayerConfig(() => bump((n) => n + 1)), [])
  return currentHighlights()
}

/** Every refusal, for the editor to show beside the rule that caused it. */
export function highlightRefusals(): Array<{ id: string; why: string }> {
  return resolveHighlights(loadPlayerConfig()).refused
}
