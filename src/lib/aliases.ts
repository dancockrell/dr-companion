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
 * this project's frontend's own command separator (`main.rb`'s
 * `$clean_lich_char` is `;` for anything that isn't `--genie`). That chaining
 * is sent through untouched and handled by the game side, not split apart
 * here.
 *
 * Anything else starting with `$` - `$preposition`, `$shop`, `$patient` and
 * so on - is a Genie *variable*, not an alias argument. This module has no
 * variable engine and does not invent one; those tokens pass through
 * verbatim, same as any other alias this table has no entry for.
 */
import { invokeTauri, isTauri } from './tauri.ts'

export interface Alias {
  name: string
  expansion: string
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

  for (const raw of text.split('\n')) {
    const line = raw.trim()
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

    entries.push({ name, expansion })
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

export interface AliasConfig {
  entries: Alias[]
  note: string
}

/**
 * Read and parse `Config/aliases.cfg`, the same way `useHighlights.ts` reads
 * `highlights.cfg` - through `read_genie_config`, which resolves the leaf
 * against Genie's real config directory rather than this app's own.
 *
 * A plain async function, not a hook: this file owns the parsing logic only,
 * not the call site or any component state. Whoever wires this into the send
 * path decides whether it is cached, reloaded, or read fresh each time.
 */
export async function loadAliasConfig(): Promise<AliasConfig> {
  if (!isTauri()) {
    return { entries: [], note: 'No aliases in a browser: the config lives beside Genie.' }
  }
  try {
    const cfg = (await invokeTauri('read_genie_config', { leaf: 'aliases.cfg' })) as {
      found: boolean
      text: string
      note: string
    }
    if (!cfg.found) {
      return { entries: [], note: cfg.note }
    }
    const { entries, skipped } = parseAliases(cfg.text)
    // Assert the denominator, not just the count that parsed: a parser that
    // silently drops half the file and one that works look identical if all
    // you print is "N aliases loaded". Genie itself drops malformed alias
    // lines in silence, and inheriting the format is not a reason to
    // inherit that failure.
    const nonBlank = cfg.text.split('\n').filter((l) => l.trim().length > 0).length
    const note = skipped.length
      ? `${entries.length} of ${nonBlank} non-blank lines parsed, ${skipped.length} skipped`
      : `${entries.length} of ${nonBlank} non-blank lines parsed`
    return { entries, note }
  } catch (e) {
    return { entries: [], note: String(e) }
  }
}
