/**
 * Command aliases, native, reading Genie's own config format.
 *
 * Same reasoning as highlights.ts: players have years of `#alias` lines in
 * `Config/aliases.cfg`, and reading that format rather than inventing one is
 * the difference between a client somebody can try today and one that asks
 * them to retype 356 shortcuts first. Read Dan's real file
 * (`C:\Genie4\Config\aliases.cfg`) to get this shape, not assumed from a spec:
 *
 *     #alias {name} {expansion}
 *
 * `expansion` may contain positional tokens - `$0` is everything typed after
 * the alias word, `$1`/`$2`/... are that remainder split on whitespace, one
 * word each - and may itself be several DR commands joined with `;`, which is
 * this app's command separator: Lich runs headless on this route, with no
 * frontend to say otherwise, so `main.rb:58`'s `$clean_lich_char` is `;`. See
 * `frontends.ts`'s `prefixFor`, which is the one place that answer is
 * computed. That chaining is sent through untouched and handled by the game
 * side, not split apart here.
 *
 * Anything else starting with `$` - `$preposition`, `$shop`, `$patient` and
 * so on - is a Genie *variable*, not an alias argument. This module has no
 * variable engine and does not invent one; those tokens pass through
 * verbatim, same as any other alias this table has no entry for.
 *
 * The live source is no longer that file. `playerConfig.ts` holds the
 * player's aliases and `resolveAliases` below turns them into the `Alias[]`
 * `expandAlias` takes; `playerConfigImport.ts` reads `aliases.cfg` once, on an
 * import the player asks for. `loadAliasConfig` is gone with the live read
 * (Q1, Lane Q): a client that needed Genie installed to have an alias is the
 * gap that lane exists to close.
 */
import type { PlayerConfig } from './playerConfig.ts'

export interface Alias {
  name: string
  expansion: string
  /** 0-indexed source line, same reasoning as `Highlight.sourceLine` - lets an
   * editor patch exactly this line rather than regenerating the file. */
  sourceLine: number
}

/**
 * Parse a Genie alias config.
 *
 * Same tolerance as parseHighlights: skip what does not parse rather than
 * refuse the whole file, but count the skips and hand them back rather than
 * swallowing them the way Genie itself does.
 */
export function parseAliases(text: string): { entries: Alias[]; skipped: string[] } {
  const entries: Alias[] = []
  const skipped: string[] = []

  const lines = text.split('\n')
  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo].trim()
    if (!line.startsWith('#alias')) continue

    const groups = [...line.matchAll(/\{([^}]*)\}/g)].map((m) => m[1])
    if (groups.length !== 2) {
      skipped.push(`${line} - ${groups.length} groups, expected 2`)
      continue
    }

    const [name, expansion] = groups
    if (!name) {
      skipped.push(`${line} - empty alias name`)
      continue
    }
    if (!expansion) {
      skipped.push(`${line} - empty expansion`)
      continue
    }

    entries.push({ name, expansion, sourceLine: lineNo })
  }

  return { entries, skipped }
}

export interface ExpandResult {
  /** What to actually send. Equal to the input when nothing matched. */
  text: string
  /** Whether any alias fired at all. */
  expanded: boolean
  /** Alias names that fired, in the order they fired. Empty when `expanded` is false. */
  chain: string[]
  /**
   * Expansion stopped because it hit `maxDepth` or a repeat, not because
   * there was nothing left to expand. `chain` still holds what did run.
   */
  capped: boolean
}

/** How many aliases may expand into aliases before this gives up and says so. */
const DEFAULT_MAX_DEPTH = 8

/**
 * One expansion step: does `line`'s first word name an alias, and if so what
 * does it become.
 *
 * Splits on the first run of whitespace only, so an expansion's own internal
 * spacing (`ask guard about $0`) is left alone. Matching is case-insensitive
 * on the alias name - inferred, not read from the file, since every name in
 * Dan's config happens to be lowercase and nothing in it says whether typing
 * `APPC` should also work. Worth revisiting if that turns out wrong.
 */
function expandOnce(
  line: string,
  byName: Map<string, Alias>
): { text: string; matched: string | null } {
  const trimmed = line.trimStart()
  const spaceAt = trimmed.search(/\s/)
  const word = spaceAt === -1 ? trimmed : trimmed.slice(0, spaceAt)
  const rest = spaceAt === -1 ? '' : trimmed.slice(spaceAt + 1).trim()

  const alias = byName.get(word.toLowerCase())
  if (!alias) return { text: line, matched: null }

  const args = rest.length ? rest.split(/\s+/) : []
  const substituted = alias.expansion.replace(/\$(\d+)/g, (_, digits: string) => {
    const i = Number(digits)
    return i === 0 ? rest : (args[i - 1] ?? '')
  })

  return { text: substituted, matched: alias.name.toLowerCase() }
}

/**
 * Expand a typed line against the alias table, following an alias into
 * another alias up to `maxDepth` deep.
 *
 * Recursion is checked against the *leading* command of the expansion only -
 * the same shape the observed config uses throughout (a leading DR command or
 * Genie `#`-command, with any further `;`-joined commands being literal, not
 * further alias names). An alias chained after a `;` with no space before it
 * is not re-expanded; none of the 356 entries in Dan's file do this, and
 * guessing at semantics nothing here exercises would be inventing a spec
 * again, which is the thing this module exists not to do.
 *
 * Two ways this stops without exhausting `maxDepth`, both reported rather
 * than silent: a name reappearing in its own chain (an actual cycle, caught
 * immediately), or nothing left to expand (the normal end).
 */
export function expandAlias(
  line: string,
  entries: readonly Alias[],
  maxDepth = DEFAULT_MAX_DEPTH
): ExpandResult {
  const byName = new Map(entries.map((a) => [a.name.toLowerCase(), a]))
  const chain: string[] = []
  let current = line

  for (let depth = 0; depth < maxDepth; depth++) {
    const { text, matched } = expandOnce(current, byName)
    if (!matched) {
      return { text: current, expanded: chain.length > 0, chain, capped: false }
    }
    if (chain.includes(matched)) {
      // The cycle itself is the useful information, so `current` - the text
      // as of the repeat, not the raw input - is what a player would need to
      // see to find it.
      return { text: current, expanded: true, chain, capped: true }
    }
    chain.push(matched)
    current = text
  }

  return { text: current, expanded: true, chain, capped: true }
}

/**
 * Store rules to the runtime `Alias[]` `expandAlias` already takes.
 *
 * The one resolver for this domain, and it is the one the runtime calls
 * (`useAliases` -> `GameCommandBar`). Disabled rules are dropped and named, so
 * the editor Q3 builds can say why a rule it can see is not firing rather than
 * leaving a player to wonder.
 *
 * `sourceLine` survives as an index because `Alias` still declares it and
 * `expandAlias` never reads it; it is no longer an offset into a file, and
 * nothing addresses a rule by it any more - an editor patches by
 * `AliasRule.id`.
 */
export function resolveAliases(cfg: Pick<PlayerConfig, 'aliases'>): {
  entries: Alias[]
  refused: Array<{ id: string; why: string }>
} {
  const entries: Alias[] = []
  const refused: Array<{ id: string; why: string }> = []
  cfg.aliases.forEach((rule, index) => {
    if (!rule.enabled) {
      refused.push({ id: rule.id, why: `"${rule.name}" is switched off` })
      return
    }
    entries.push({ name: rule.name, expansion: rule.expansion, sourceLine: index })
  })
  return { entries, refused }
}
