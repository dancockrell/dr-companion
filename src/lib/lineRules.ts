/**
 * Substitutes and gags: the one place a game line is rewritten or hidden.
 *
 * # A gag is a display preference, not a delete
 *
 * The raw buffer in `gameLink.ts` is **never** rewritten. `applyLineRules` is
 * pure and is called on read, by `useGameLines()` alone, so:
 *
 * - the transcript, the bug bundle and `aiWorkerHost.ts`'s ingest - which
 *   reads `gameLines()` directly, deliberately outside the hook - still see
 *   every line exactly as the game sent it;
 * - changing a rule re-applies to everything already on screen, because the
 *   rewrite happens where the reading happens rather than where the writing
 *   did;
 * - "show gagged lines" can put a hidden line back, because it was never
 *   gone.
 *
 * A gag that filtered `buffer.push` would be indistinguishable from a gag
 * that works, right up until somebody needed the line back and it did not
 * exist anywhere. `tools/line-rules-test.mjs` asserts the raw buffer is byte
 * identical before and after, and its first sabotage moves the filter into
 * the push to prove that check can fail.
 *
 * # Order: substitutes, then gags
 *
 * Stated here because it is the sort of thing two readers assume differently.
 * Substitutes run first, so a gag matches the text the player is actually
 * looking at rather than the text underneath it. Genie applies them in this
 * order too; more to the point, the other order makes a gag written against
 * what is on screen fail for a reason nobody can see.
 *
 * # Literal by default, regular expression on request
 *
 * `#substitute {find} {replace}` and `#gag {pattern}` are literal substrings
 * in Genie - which is what an imported rule keeps meaning here, because
 * reinterpreting stored text under a new meaning is a whole class of quiet
 * bug. A rule the player marks `regex` is compiled through
 * `highlights.ts`'s `compilePattern`, the same gate a highlight rule and the
 * highlight editor go through: not a second matcher, and not a second opinion
 * about which patterns are safe to run per rendered line. That function gained
 * a `flags` argument for this, because a substitute replaces every occurrence
 * and so needs the same pattern with `g`.
 *
 * A pattern that cannot compile, or that backtracks catastrophically, is
 * refused **at save** by `ruleRefusal()` and never reaches here. This module
 * still refuses it a second time rather than trusting that, because a rule
 * can also arrive from an import or from a storage key written by another
 * build, and a `catch` in the render path is the wrong place to find out.
 */
import { compilePattern } from './highlights.ts'
import type { GagRule, SubstituteRule } from './playerConfig.ts'

export interface LineRuleSet {
  substitutes: readonly SubstituteRule[]
  gags: readonly GagRule[]
}

export interface LineRuleResult {
  /** The text to show. The input, unchanged, when no substitute matched. */
  text: string
  /** True when a gag matched. The caller decides what that means on screen. */
  gagged: boolean
  /** Ids of the rules that fired, in the order they fired. The preview shows
   *  these, so "why did this line change" has an answer that is not a guess. */
  matched: string[]
}

/**
 * Compiled patterns, keyed by mode and text.
 *
 * `applyLineRules` runs per rendered line and the game pane keeps hundreds,
 * so compiling and probing a pattern on every one of them is the whole cost.
 * Keyed on the pattern rather than on the rule id: editing a rule's text
 * produces a different key, so a stale compile cannot survive an edit.
 */
const compiled = new Map<string, RegExp | null>()

function compile(pattern: string): RegExp | null {
  const key = pattern
  const held = compiled.get(key)
  if (held !== undefined) return held
  const result = compilePattern('regexp', pattern, 'g')
  const re = result.ok ? (result.re ?? null) : null
  compiled.set(key, re)
  return re
}

/**
 * Why this rule cannot be saved, or `null`.
 *
 * The editor calls this before writing, so an unrunnable pattern is refused
 * with its reason on screen instead of being stored and then silently
 * skipped forever. Exported rather than inlined into the tab, because the
 * runtime has to make the same judgement and two judgements would eventually
 * differ.
 */
export function ruleRefusal(pattern: string, regex?: boolean): string | null {
  if (!pattern) return 'nothing to match'
  if (!regex) return null
  const result = compilePattern('regexp', pattern, 'g')
  return result.ok ? null : result.why
}

function replaceLiteral(text: string, find: string, replace: string): string {
  // `split`/`join` rather than a constructed RegExp: the find text is the
  // player's, and escaping it into a pattern is a step that can be got wrong
  // for no gain when the literal case needs no pattern at all.
  return text.split(find).join(replace)
}

/**
 * Substitutes then gags, in that order, against one line. Pure.
 *
 * Disabled rules do not fire and do not appear in `matched`; neither do
 * rules whose pattern the guard refuses. An empty rule set returns the input
 * unchanged, which is a no-op and not "nothing matched, so hide it" - the
 * distinction the empty-set case in the test exists to hold.
 */
export function applyLineRules(text: string, rules: LineRuleSet): LineRuleResult {
  const matched: string[] = []
  let out = text

  for (const rule of rules.substitutes) {
    if (!rule.enabled || !rule.find) continue
    if (rule.regex) {
      const re = compile(rule.find)
      if (!re) continue
      re.lastIndex = 0
      if (!re.test(out)) continue
      re.lastIndex = 0
      out = out.replace(re, rule.replace)
      matched.push(rule.id)
    } else {
      if (!out.includes(rule.find)) continue
      out = replaceLiteral(out, rule.find, rule.replace)
      matched.push(rule.id)
    }
  }

  for (const rule of rules.gags) {
    if (!rule.enabled || !rule.pattern) continue
    if (rule.regex) {
      const re = compile(rule.pattern)
      if (!re) continue
      re.lastIndex = 0
      if (!re.test(out)) continue
    } else if (!out.includes(rule.pattern)) {
      continue
    }
    matched.push(rule.id)
    // Stops at the first gag that fires: a line is hidden once, and listing
    // every other gag that would also have hidden it tells the player
    // nothing they can act on.
    return { text: out, gagged: true, matched }
  }

  return { text: out, gagged: false, matched }
}

/** For a test that needs the compile cache cold between cases. */
export function resetLineRuleCache() {
  compiled.clear()
}
