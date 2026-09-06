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
import { isGenieScript, type AliasRule, type PlayerConfig } from './playerConfig.ts'

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
  /**
   * `$name` tokens no variable answered, in the order they were met, each
   * once.
   *
   * Left in the text verbatim rather than blanked - a command with a literal
   * `$shop` in it is visibly wrong, and one silently missing a word looks like
   * a command the player meant to type. The editor shows this list beside the
   * alias so the fix is "you have no variable called shop" rather than "this
   * alias does something odd".
   */
  unknownVariables: string[]
}

/** How many aliases may expand into aliases before this gives up and says so. */
const DEFAULT_MAX_DEPTH = 8

/**
 * `$name`, the variable token.
 *
 * A leading letter or underscore is what separates it from `$0`…`$9`, which
 * are positional alias arguments and are never looked up here - the same split
 * `variables.ts` made before it was deleted (`docs/PLAYER_CONFIG.md` §4.3). A
 * dot is admitted because Genie's own names carry one (`Time.hour`), so a
 * config that has them reads back the way it was written.
 */
const VARIABLE_TOKEN = /\$([A-Za-z_][A-Za-z0-9_.]*)/g

export interface ExpandOptions {
  maxDepth?: number
  /** `$name` → its value. Absent means no variable table, which is what every
   *  caller had before Q3 and still leaves the tokens verbatim. */
  variables?: ReadonlyMap<string, string>
}

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
 * Variables, substituted once over the finished text.
 *
 * Once, and at the end, rather than per expansion step, for two reasons. A
 * value that itself contains a `$` would be re-substituted by a second pass,
 * which is a rule nobody wrote down and could not be predicted from the
 * config. And a `$name` that is *not* inside an alias - `go $shop` typed
 * straight into a macro's command list, which is how Genie's own configs use
 * them - would otherwise never resolve, because no alias fired to carry it.
 *
 * `$0`…`$9` have already been consumed by `expandOnce` and could not match
 * `VARIABLE_TOKEN` anyway: they are positional arguments, not variables.
 *
 * Exported since #485 because the enable guards have to ask their question
 * about the text that will actually be sent, and the text that will actually
 * be sent is this function's output. A second substituter written inside a
 * guard would be a second opinion about what `$shop` means.
 */
export function substituteVariables(
  text: string,
  variables: ReadonlyMap<string, string> | undefined,
  unknown: string[] = []
): string {
  return text.replace(VARIABLE_TOKEN, (whole, name: string) => {
    const value = variables?.get(name)
    if (value === undefined) {
      if (!unknown.includes(name)) unknown.push(name)
      return whole
    }
    return value
  })
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
  opts: number | ExpandOptions = DEFAULT_MAX_DEPTH
): ExpandResult {
  // A number or an options object, both accepted on purpose. The third
  // parameter was a bare `maxDepth` before Q3 and two call sites plus a test
  // suite pass one; widening it is one function that answers both, where a
  // second entry point taking options would be the fork the lane exists not
  // to make.
  const settings: ExpandOptions = typeof opts === 'number' ? { maxDepth: opts } : opts
  const maxDepth = settings.maxDepth ?? DEFAULT_MAX_DEPTH
  const byName = new Map(entries.map((a) => [a.name.toLowerCase(), a]))
  const chain: string[] = []
  const unknownVariables: string[] = []
  let current = line

  const done = (capped: boolean): ExpandResult => ({
    text: substituteVariables(current, settings.variables, unknownVariables),
    expanded: chain.length > 0,
    chain,
    capped,
    unknownVariables,
  })

  for (let depth = 0; depth < maxDepth; depth++) {
    const { text, matched } = expandOnce(current, byName)
    if (!matched) return done(false)
    if (chain.includes(matched)) {
      // The cycle itself is the useful information, so `current` - the text
      // as of the repeat, not the raw input - is what a player would need to
      // see to find it.
      return done(true)
    }
    chain.push(matched)
    current = text
  }

  return done(true)
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
export function resolveAliases(
  cfg: Pick<PlayerConfig, 'aliases'> & Partial<Pick<PlayerConfig, 'variables'>>
): {
  entries: Alias[]
  refused: Array<{ id: string; why: string }>
} {
  const entries: Alias[] = []
  const refused: Array<{ id: string; why: string }> = []
  // The table the expansion will actually run against, so the guard below
  // judges the text that gets sent rather than the text as stored - #485.
  // Optional because two callers pass a whole `PlayerConfig` and a check may
  // pass an alias list alone; absent means "no variables", which is the same
  // answer as an empty table rather than a different code path.
  const variables = cfg.variables ? resolveVariables({ variables: cfg.variables }).variables : undefined
  cfg.aliases.forEach((rule, index) => {
    // Script before switched-off, because a scripted alias that somehow
    // arrived enabled - hand-edited storage, an older build, an import bug -
    // must still not run, and the reason a player needs is the script, not the
    // switch. `enableRefusal` is the same answer the editor's toggle gives, so
    // the two cannot disagree about which rules are runnable.
    const cannot = aliasEnableRefusal(rule, { variables })
    if (cannot) {
      refused.push({ id: rule.id, why: cannot })
      return
    }
    if (!rule.enabled) {
      refused.push({ id: rule.id, why: `"${rule.name}" is switched off` })
      return
    }
    entries.push({ name: rule.name, expansion: rule.expansion, sourceLine: index })
  })
  return { entries, refused }
}

/**
 * What a guard needs to know about the text a rule will actually produce.
 *
 * Shared with `macroEnableRefusal` in `keybindings.ts` rather than declared
 * twice, so the two domains cannot drift into asking different questions.
 */
export interface EnableRefusalOptions {
  /**
   * The variable table the text will be expanded against at fire time.
   *
   * Omitting it judges the stored text, which is what both guards did until
   * #485 and is right only when there are no variables in play: a macro or
   * alias reading `go $s` carries no `#` and passed, and `$s = "#queue clear"`
   * then put the directive on the wire as literal text. The guard has to ask
   * its question about the text that gets sent.
   */
  variables?: ReadonlyMap<string, string>
}

/**
 * Why this text is script this app cannot run, as a fragment for whichever
 * guard is asking, or null.
 *
 * The one predicate behind `aliasEnableRefusal`, `macroEnableRefusal` and
 * `plannedCommandRefusal`, so the enable-time answer and the fire-time answer
 * cannot differ. Two questions, not one, and the second is the one #485 was
 * about:
 *
 * 1. **Is the text that gets sent a directive?** `isGenieScript` on the
 *    *planned* text, not the stored text. A macro whose command is `$s`, with
 *    `$s = "#queue clear"`, stores no `#` and sends one.
 * 2. **Did a variable carry a directive into it?** `go $s` expands to
 *    `go #queue clear`, which `isGenieScript` does not call script - the
 *    leading word is `go` - and which the issue measured arriving at
 *    DragonRealms as literal text. Checked against the variable's *value*
 *    rather than by widening `isGenieScript`, so nothing changes for a config
 *    with no variables in it, and the refusal can name the row to edit.
 */
export function scriptRefusalWhy(
  source: string,
  planned: string,
  variables?: ReadonlyMap<string, string>
): string | null {
  if (isGenieScript(planned)) return 'a # directive or a \\x escape'
  if (!variables) return null
  for (const m of source.matchAll(VARIABLE_TOKEN)) {
    const value = variables.get(m[1])
    if (value !== undefined && isGenieScript(value)) return `$${m[1]} is "${value}"`
  }
  return null
}

/** The same question asked of stored text that has not been expanded yet. */
export function scriptRefusalFor(
  text: string,
  opts: EnableRefusalOptions = {}
): { expanded: string; why: string | null } {
  const expanded = substituteVariables(text, opts.variables)
  return { expanded, why: scriptRefusalWhy(text, expanded, opts.variables) }
}

/**
 * Why this alias may not be switched on, or null when it may.
 *
 * One answer, asked by the resolver above and by the Aliases tab's toggle. 87
 * of the 356 aliases in the real config measured for Q1 carry Genie script and
 * import switched off; a player who flips one on would get `#queue {...}` sent
 * to DragonRealms as literal text, which is not a refusal the game makes
 * politely. Named rather than silently ignored: the rule stays visible, with
 * its text, and says what would have to change.
 *
 * Judged against the **expanded** text since #485, because a guard on the
 * stored text is a guard on something that is not what gets sent.
 */
export function aliasEnableRefusal(
  rule: Pick<AliasRule, 'name' | 'expansion'>,
  opts: EnableRefusalOptions = {}
): string | null {
  const { expanded, why } = scriptRefusalFor(rule.expansion, opts)
  if (!why) return null
  const sends = expanded === rule.expansion ? '' : `, sending "${expanded}"`
  return (
    `"${rule.name}" contains Genie script (${why})${sends}. ` +
    'This app has no script engine, so it cannot be switched on.'
  )
}

/**
 * The variable table `expandAlias` takes, from the store.
 *
 * The one resolver for this domain. Disabled variables are left out and named
 * for the same reason a disabled alias is: a `$shop` that stopped resolving
 * because somebody unticked a row should read as switched off, not as a typo.
 * A later row with the same name wins, and the shadowed one is reported -
 * silently keeping either would make one of two identical-looking rows dead.
 */
export function resolveVariables(cfg: Pick<PlayerConfig, 'variables'>): {
  variables: Map<string, string>
  refused: Array<{ id: string; why: string }>
} {
  const variables = new Map<string, string>()
  const refused: Array<{ id: string; why: string }> = []
  for (const rule of cfg.variables) {
    if (!rule.enabled) {
      refused.push({ id: rule.id, why: `$${rule.name} is switched off` })
      continue
    }
    if (variables.has(rule.name)) {
      refused.push({
        id: rule.id,
        why: `$${rule.name} is set more than once; this row is the one that wins`,
      })
    }
    variables.set(rule.name, rule.value)
  }
  return { variables, refused }
}
