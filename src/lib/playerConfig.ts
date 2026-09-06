/**
 * The player's own rules: presets, highlights, aliases, macros, substitutes,
 * gags and variables. One store, one owner, one localStorage key per domain.
 *
 * # Why this exists
 *
 * PR #456 deleted the in-app editors for all seven, correctly - they edited
 * *Genie's* `Config\*.cfg` files and the app no longer routes through Genie.
 * What it left behind is a client whose player cannot colour a line, name a
 * shortcut or bind a key without opening the program the app spent an
 * increment removing. This is the store those editors write to instead, and
 * `useHighlights`/`useAliases` read it rather than reading Genie's files, so a
 * machine with no Genie install has highlights and aliases for the first time.
 *
 * The design, the schema and the resolver signatures are
 * `docs/PLAYER_CONFIG.md`; where this file and that page disagree, this file
 * is right and the page is stale (its own §9 says so).
 *
 * # Beside `PersistedPrefs`, not inside it
 *
 * A decision, stated as one rather than left looking like the obvious
 * arrangement. `persistence.ts` is the one store for *preferences* and this is
 * the one store for *rules*; they use the same `storage.ts` primitives. A
 * player's 356 aliases living in the same key as `alertsVolume` would mean
 * every volume change rewrote the whole config, and one `QuotaExceededError`
 * lost both. Two keys owned by two modules is not two sources of truth.
 *
 * # Ids, not source lines
 *
 * `Highlight.sourceLine` and `Alias.sourceLine` are offsets into a file that
 * an editor no longer edits. Entries here carry a generated `id`, so an editor
 * patches one rule by identity and reordering the list cannot silently repoint
 * an edit at a different rule.
 */
import { useEffect, useState } from 'react'
import { readJSON, writeJSONVerified, type StorageWriteResult } from './storage.ts'

/**
 * The schema version each domain key carries.
 *
 * Bumped when the *shape* of an entry changes, never when a field's meaning
 * changes under the same shape - old data read under a new meaning is the
 * quietest bug there is (plan trap 12), so a meaning change gets a new version
 * and a migration that can be pointed at, not a reinterpretation.
 */
export const PLAYER_CONFIG_VERSION = 1

export type Domain =
  | 'presets'
  | 'highlights'
  | 'aliases'
  | 'macros'
  | 'substitutes'
  | 'gags'
  | 'variables'

/**
 * Every domain, in the order the panel shows them.
 *
 * Exported because it is the denominator every check in
 * `tools/player-config-test.mjs` counts against: a run that exercised five
 * domains and reported clean is the failure that list exists to make
 * impossible.
 */
export const DOMAINS: readonly Domain[] = [
  'presets',
  'highlights',
  'aliases',
  'macros',
  'substitutes',
  'gags',
  'variables',
]

/** Where an entry came from. Never used to decide behaviour - only to show a
 *  player which of their rules arrived from a Genie import, and to let the
 *  import report say what it added. */
export type RuleSource = 'player' | 'genie-import'

export interface RuleBase {
  /** Stable id, generated on create. */
  id: string
  enabled: boolean
  source: RuleSource
  /** Free-text group, Genie's `#class`. `offClasses.ts` already mutes by this
   *  name and keeps doing so, unchanged. */
  cls?: string
}

export interface PresetRule extends RuleBase {
  name: string
  /** `#RRGGBB` or a CSS colour name - every colour in a real `presets.cfg` is
   *  one of the two. */
  fg: string
  bg?: string
  bold: boolean
}

export interface HighlightRule extends RuleBase {
  type: 'line' | 'string' | 'beginswith' | 'regexp'
  pattern: string
  /** Exactly one of these two. A rule naming a preset that no longer exists
   *  resolves to the default text colour and is reported, never dropped. */
  presetId?: string
  colour?: string
  sound?: string
}

export interface AliasRule extends RuleBase {
  name: string
  /** `$0`/`$1`… positional, `$name` variables, `;` chains. */
  expansion: string
}

export interface MacroRule extends RuleBase {
  /** Genie's `System.Windows.Forms.Keys` name - 'F2', 'NumPad8', 'D3', 'A'.
   *  `keybindings.ts`'s `codeToGenieKey()` is the one translation from
   *  `KeyboardEvent.code`. */
  key: string
  /** Normalised to this order on write, so two bindings on one physical chord
   *  compare equal however they were typed. */
  modifiers: Array<'Shift' | 'Control' | 'Alt'>
  /** One command per entry. Sent through the lane one at a time. */
  commands: string[]
}

export interface SubstituteRule extends RuleBase {
  /** A literal substring by default; a regular expression when `regex` is set. */
  find: string
  replace: string
  /**
   * Treat `find` as a regular expression.
   *
   * Optional and absent by default, so every rule Q1's import wrote and every
   * rule already in a player's storage keeps meaning what it meant:
   * `#substitute {find} {replace}` is a literal in Genie, and reinterpreting
   * stored text under a new meaning is the quiet bug this field is shaped to
   * avoid. `$1` and friends work in `replace` when this is on.
   */
  regex?: boolean
}

export interface GagRule extends RuleBase {
  /** A literal substring by default; a regular expression when `regex` is set.
   *  Matching hides the whole line. */
  pattern: string
  /** Treat `pattern` as a regular expression. Same default, same reason as
   *  `SubstituteRule.regex`. */
  regex?: boolean
}

export interface VariableRule extends RuleBase {
  /** Referenced as `$name`. */
  name: string
  value: string
}

export type Rule =
  | PresetRule
  | HighlightRule
  | AliasRule
  | MacroRule
  | SubstituteRule
  | GagRule
  | VariableRule

export interface DomainRule {
  presets: PresetRule
  highlights: HighlightRule
  aliases: AliasRule
  macros: MacroRule
  substitutes: SubstituteRule
  gags: GagRule
  variables: VariableRule
}

export interface PlayerConfig {
  version: number
  presets: PresetRule[]
  highlights: HighlightRule[]
  aliases: AliasRule[]
  macros: MacroRule[]
  substitutes: SubstituteRule[]
  gags: GagRule[]
  variables: VariableRule[]
}

/**
 * One named constant per key, rather than a template built from the domain.
 *
 * `tools/build-player-data-doc.mjs` finds storage keys by scanning for a
 * constant whose name ends in KEY assigned a string literal, and refuses to
 * publish an inventory that does not describe every one it finds. (That scan
 * reads raw text, comments included, so this paragraph deliberately describes
 * the pattern rather than writing one out.) A key assembled at runtime is a key that
 * inventory cannot see, which is exactly the key a player would lose without
 * the doc ever mentioning it.
 */
const PLAYER_CONFIG_PRESETS_KEY = 'drc.player-config.presets.v1'
const PLAYER_CONFIG_HIGHLIGHTS_KEY = 'drc.player-config.highlights.v1'
const PLAYER_CONFIG_ALIASES_KEY = 'drc.player-config.aliases.v1'
const PLAYER_CONFIG_MACROS_KEY = 'drc.player-config.macros.v1'
const PLAYER_CONFIG_SUBSTITUTES_KEY = 'drc.player-config.substitutes.v1'
const PLAYER_CONFIG_GAGS_KEY = 'drc.player-config.gags.v1'
const PLAYER_CONFIG_VARIABLES_KEY = 'drc.player-config.variables.v1'

const DOMAIN_KEYS: Record<Domain, string> = {
  presets: PLAYER_CONFIG_PRESETS_KEY,
  highlights: PLAYER_CONFIG_HIGHLIGHTS_KEY,
  aliases: PLAYER_CONFIG_ALIASES_KEY,
  macros: PLAYER_CONFIG_MACROS_KEY,
  substitutes: PLAYER_CONFIG_SUBSTITUTES_KEY,
  gags: PLAYER_CONFIG_GAGS_KEY,
  variables: PLAYER_CONFIG_VARIABLES_KEY,
}

export function storageKeyFor(domain: Domain): string {
  return DOMAIN_KEYS[domain]
}

/** What one key holds. */
export interface StoredDomain {
  version: number
  entries: unknown[]
}

/**
 * Three states, not two.
 *
 * `absent` and `refused` both produce an empty entry list, and folding them
 * together is the lie this whole repo's rule 1 is about: "there is nothing
 * stored" and "something is stored and I could not read it" must never print
 * the same answer, because only one of them means a player has lost rules.
 */
export type MigrationStatus = 'absent' | 'current' | 'migrated' | 'refused'

export interface Migration<T = Rule> {
  status: MigrationStatus
  entries: T[]
  /** How many entries were rewritten from an older shape. Zero unless
   *  `status` is `migrated`. */
  migrated: number
  /** One string per entry that could not be read, with the reason. */
  dropped: string[]
  /** Present when `status` is `refused`, naming what stopped it. */
  why?: string
}

let idCounter = 0

/**
 * A generated entry id.
 *
 * Prefixed with the domain so an id read out of a report or a JSON export says
 * what it belongs to. `crypto.randomUUID` where it exists, a counter and the
 * clock where it does not, because an import of 356 aliases inside one
 * millisecond must not produce two entries with the same id.
 */
export function newId(domain: Domain): string {
  const rnd =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : `${Date.now().toString(36)}${(idCounter += 1).toString(36)}`
  return `${domain.slice(0, 3)}-${rnd}`
}

const MODIFIER_ORDER: Array<'Shift' | 'Control' | 'Alt'> = ['Shift', 'Control', 'Alt']

/** Genie writes modifiers Shift, Control, Alt in every one of the 95 real
 *  entries read for this. Normalising to that order means two bindings on one
 *  physical chord compare equal however they were typed. */
export function normalizeModifiers(
  mods: readonly string[]
): Array<'Shift' | 'Control' | 'Alt'> {
  return MODIFIER_ORDER.filter((m) => mods.includes(m))
}

/**
 * A command this app cannot execute: Genie script.
 *
 * `#class`, `#queue`, `#setvar` and the `\x` escapes several real F-key macros
 * use are directives to a script engine this app does not have. Such a rule is
 * kept with its text intact and `enabled: false`, so the player sees exactly
 * what Genie had and nothing fires a directive nobody implements.
 *
 * Lived in `playerConfigImport.ts` until Q3 and is here now because it is a
 * property of a stored rule rather than of an import: the alias resolver, the
 * keybinding resolver and both editors ask it, and `aliases.ts` importing the
 * importer would have been a cycle. `playerConfigImport.ts` re-exports it, so
 * there is one implementation and no caller had to move.
 */
export function isGenieScript(command: string): boolean {
  return command
    .split(';')
    .some((part) => part.trim().startsWith('#') || /\\x/.test(part))
}

/**
 * Genie's own bookkeeping in `variables.cfg`, which is most of a real one.
 *
 * `roomid`, `downid` and the whole `Time.*` block are written by Genie while it
 * plays, not settings a person tuned. Holding them would put a stale room id in
 * a player's variable table and let an alias resolve `$roomid` to somewhere
 * they were last May. The import counts and names them rather than dropping
 * them in silence, and the Variables editor refuses to create one, saying why.
 */
export function isBookkeepingVariable(name: string): boolean {
  return name === 'roomid' || name === 'downid' || name.startsWith('Time.')
}

/**
 * What the Variables tab shows as reserved, in the words the refusal uses.
 *
 * The names, not a count: a player who imported a real config sees 12 of their
 * 46 variables missing, and "12 were Genie's own" is only useful beside the
 * shapes that make it true.
 */
export const RESERVED_VARIABLE_NAMES: readonly string[] = ['roomid', 'downid', 'Time.*']

const isString = (v: unknown): v is string => typeof v === 'string'

/**
 * Validate one raw entry for a domain.
 *
 * Returns the entry or a reason. Written per domain rather than by a schema
 * library because the reasons are the product: a dropped rule the player is
 * never told about is a rule they think they still have.
 */
function readEntry(domain: Domain, raw: unknown): { entry: Rule } | { why: string } {
  if (typeof raw !== 'object' || raw === null) return { why: `not an object: ${JSON.stringify(raw)}` }
  const r = raw as Record<string, unknown>
  const id = isString(r.id) && r.id ? r.id : newId(domain)
  const base: RuleBase = {
    id,
    // A v0 entry has no `enabled` and no `source`; both default rather than
    // refuse, because an imported rule that arrives disabled is a rule the
    // player will report as missing.
    enabled: typeof r.enabled === 'boolean' ? r.enabled : true,
    source: r.source === 'genie-import' ? 'genie-import' : 'player',
    ...(isString(r.cls) && r.cls ? { cls: r.cls } : {}),
  }

  switch (domain) {
    case 'presets': {
      if (!isString(r.name) || !r.name) return { why: 'a preset with no name' }
      if (!isString(r.fg) || !r.fg) return { why: `preset "${r.name}" has no colour` }
      return {
        entry: {
          ...base,
          name: r.name,
          fg: r.fg,
          ...(isString(r.bg) && r.bg ? { bg: r.bg } : {}),
          bold: r.bold === true,
        } satisfies PresetRule,
      }
    }
    case 'highlights': {
      const types = ['line', 'string', 'beginswith', 'regexp']
      if (!isString(r.type) || !types.includes(r.type)) return { why: `unknown highlight type ${JSON.stringify(r.type)}` }
      if (!isString(r.pattern) || !r.pattern) return { why: 'a highlight with no pattern' }
      if (!isString(r.presetId) && !isString(r.colour)) {
        return { why: `highlight "${r.pattern}" names neither a preset nor a colour` }
      }
      return {
        entry: {
          ...base,
          type: r.type as HighlightRule['type'],
          pattern: r.pattern,
          ...(isString(r.presetId) && r.presetId ? { presetId: r.presetId } : {}),
          ...(isString(r.colour) && r.colour ? { colour: r.colour } : {}),
          ...(isString(r.sound) && r.sound ? { sound: r.sound } : {}),
        } satisfies HighlightRule,
      }
    }
    case 'aliases': {
      if (!isString(r.name) || !r.name) return { why: 'an alias with no name' }
      if (!isString(r.expansion) || !r.expansion) return { why: `alias "${r.name}" has no expansion` }
      return { entry: { ...base, name: r.name, expansion: r.expansion } satisfies AliasRule }
    }
    case 'macros': {
      if (!isString(r.key) || !r.key) return { why: 'a macro bound to no key' }
      const commands = Array.isArray(r.commands) ? r.commands.filter(isString) : []
      if (commands.length === 0) return { why: `macro on "${r.key}" has no commands` }
      const mods = Array.isArray(r.modifiers) ? r.modifiers.filter(isString) : []
      return {
        entry: { ...base, key: r.key, modifiers: normalizeModifiers(mods), commands } satisfies MacroRule,
      }
    }
    case 'substitutes': {
      if (!isString(r.find) || !r.find) return { why: 'a substitute with nothing to find' }
      return {
        entry: {
          ...base,
          find: r.find,
          replace: isString(r.replace) ? r.replace : '',
          // Only carried when true. Written as `regex: false` on every literal
          // rule it would double the size of a Genie import for no meaning,
          // and `identityOf` would then have to care about a field that says
          // "the default".
          ...(r.regex === true ? { regex: true } : {}),
        } satisfies SubstituteRule,
      }
    }
    case 'gags': {
      if (!isString(r.pattern) || !r.pattern) return { why: 'a gag with no pattern' }
      return {
        entry: {
          ...base,
          pattern: r.pattern,
          ...(r.regex === true ? { regex: true } : {}),
        } satisfies GagRule,
      }
    }
    case 'variables': {
      if (!isString(r.name) || !r.name) return { why: 'a variable with no name' }
      return { entry: { ...base, name: r.name, value: isString(r.value) ? r.value : '' } satisfies VariableRule }
    }
  }
}

/**
 * Read one domain's stored value into entries, saying which of the four things
 * happened.
 *
 * `raw` is whatever came out of storage, so every shape here is a shape a
 * player's machine can actually present: nothing stored, the current version,
 * an older one, and a newer one written by a build they have since downgraded
 * from. The last is refused by name rather than half-read - a v2 entry read as
 * a v1 is old data under a new meaning, and reinterpreting it silently is how
 * a config comes back subtly wrong instead of visibly empty.
 */
export function migratePlayerConfig(raw: unknown, domain: Domain): Migration {
  if (raw === null || raw === undefined) {
    return { status: 'absent', entries: [], migrated: 0, dropped: [] }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      status: 'refused',
      entries: [],
      migrated: 0,
      dropped: [],
      why: `${storageKeyFor(domain)} does not hold a { version, entries } object`,
    }
  }
  const held = raw as Partial<StoredDomain>
  const version = typeof held.version === 'number' ? held.version : 0
  if (version > PLAYER_CONFIG_VERSION) {
    return {
      status: 'refused',
      entries: [],
      migrated: 0,
      dropped: [],
      why:
        `${storageKeyFor(domain)} is version ${version}; this build understands ` +
        `${PLAYER_CONFIG_VERSION}. Refusing to read it rather than reinterpreting a newer shape.`,
    }
  }
  if (!Array.isArray(held.entries)) {
    return {
      status: 'refused',
      entries: [],
      migrated: 0,
      dropped: [],
      why: `${storageKeyFor(domain)} has no entries array`,
    }
  }

  const entries: Rule[] = []
  const dropped: string[] = []
  for (const raw2 of held.entries) {
    const read = readEntry(domain, raw2)
    if ('why' in read) dropped.push(read.why)
    else entries.push(read.entry)
  }

  // A v0 key was written before entries carried `id`, `enabled` and `source`;
  // `readEntry` supplies all three, so the migration is the read itself and
  // `migrated` counts what it rewrote.
  const migrated = version < PLAYER_CONFIG_VERSION ? entries.length : 0
  return {
    status: version < PLAYER_CONFIG_VERSION ? 'migrated' : 'current',
    entries,
    migrated,
    dropped,
  }
}

const cache = new Map<Domain, Rule[]>()
const migrations = new Map<Domain, Migration>()
const listeners = new Set<() => void>()

function publish() {
  for (const l of listeners) l()
}

/**
 * One domain, read through storage and migrated.
 *
 * Cached, because `paint()` runs per rendered line and the game pane keeps 400
 * of them: re-parsing seven keys per line is the whole cost.
 */
export function loadDomain(domain: Domain): Migration {
  const held = migrations.get(domain)
  if (held) return held
  // Named `key` rather than passed inline: `build-player-data-doc.mjs` walks
  // every storage call site and insists the identifier it is handed is one the
  // inventory knows, and a call it cannot resolve is a key that could go
  // undocumented.
  const key = storageKeyFor(domain)
  const raw = readJSON<unknown>(key, null)
  const result = migratePlayerConfig(raw, domain)
  migrations.set(domain, result)
  cache.set(domain, result.entries)
  // A migrated key is written back at its new version, so the migration runs
  // once rather than on every read for the rest of the install's life. A
  // refused one is left exactly where it is: overwriting a config written by a
  // newer build is the data loss this refusal exists to prevent.
  if (result.status === 'migrated') persist(domain, result.entries)
  return result
}

export function domainEntries<D extends Domain>(domain: D): Array<DomainRule[D]> {
  return loadDomain(domain).entries as Array<DomainRule[D]>
}

/**
 * The one write for all seven domains, and it checks the bytes came home.
 *
 * `writeJSONVerified` rather than `writeJSON`, which is the difference between
 * reporting what `setItem` did and reporting what the store kept. A backing
 * store that is full, that refuses without throwing, or that truncates returns
 * from `setItem` with no complaint - #461 measured exactly that, which is why
 * the verified writer exists, and #483 measured this module calling the
 * unverified one anyway: `setDomain` returned `{ok:true}`, updated its cache,
 * and the player was shown two aliases where the store held one.
 *
 * `setDomain` already refuses to update the cache on a failed write, so the
 * `lost` kind needs nothing else to reach the editors: every tab renders
 * `Could not save: <message>` from the result, and `StorageWarning` counts the
 * pending write in the header. The guard was there; it was being handed an
 * answer that could not say no.
 */
function persist(domain: Domain, entries: readonly Rule[]): StorageWriteResult {
  const key = storageKeyFor(domain)
  return writeJSONVerified(key, {
    version: PLAYER_CONFIG_VERSION,
    entries: [...entries],
  } satisfies StoredDomain)
}

/**
 * Replace one domain's entries.
 *
 * Returns the storage result rather than swallowing it, and **does not update
 * the in-memory copy when the write failed**. An editor that kept the edit in
 * memory after a `QuotaExceededError` would show the player a rule that
 * vanishes on the next reload, which is worse than refusing it: they would
 * spend the evening believing it was saved.
 */
export function setDomain<D extends Domain>(
  domain: D,
  entries: readonly DomainRule[D][]
): StorageWriteResult {
  const result = persist(domain, entries)
  if (!result.ok) return result
  const copy = [...entries] as Rule[]
  cache.set(domain, copy)
  migrations.set(domain, {
    status: 'current',
    entries: copy,
    migrated: 0,
    dropped: migrations.get(domain)?.dropped ?? [],
  })
  publish()
  return result
}

export function addEntry<D extends Domain>(domain: D, entry: DomainRule[D]): StorageWriteResult {
  return setDomain(domain, [...domainEntries(domain), entry])
}

export function updateEntry<D extends Domain>(
  domain: D,
  id: string,
  patch: Partial<DomainRule[D]>
): StorageWriteResult {
  return setDomain(
    domain,
    domainEntries(domain).map((e) => (e.id === id ? { ...e, ...patch } : e))
  )
}

export function removeEntry(domain: Domain, id: string): StorageWriteResult {
  return setDomain(
    domain,
    domainEntries(domain).filter((e) => e.id !== id) as never
  )
}

/** The whole store, every domain read and migrated. */
export function loadPlayerConfig(): PlayerConfig {
  return {
    version: PLAYER_CONFIG_VERSION,
    presets: domainEntries('presets'),
    highlights: domainEntries('highlights'),
    aliases: domainEntries('aliases'),
    macros: domainEntries('macros'),
    substitutes: domainEntries('substitutes'),
    gags: domainEntries('gags'),
    variables: domainEntries('variables'),
  }
}

/** Every domain's migration outcome, for the panel to show and for a check to
 *  assert against. */
export function playerConfigMigrations(): Record<Domain, Migration> {
  const out = {} as Record<Domain, Migration>
  for (const d of DOMAINS) out[d] = loadDomain(d)
  return out
}

export const emptyPlayerConfig = (): PlayerConfig => ({
  version: PLAYER_CONFIG_VERSION,
  presets: [],
  highlights: [],
  aliases: [],
  macros: [],
  substitutes: [],
  gags: [],
  variables: [],
})

/**
 * Forget every cached read.
 *
 * For a test that writes storage underneath this module, and for the panel
 * after an import, which writes all seven keys at once.
 */
export function resetPlayerConfigCache() {
  cache.clear()
  migrations.clear()
  publish()
}

export function subscribePlayerConfig(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Live-subscribed, for the editors and for the hooks that feed the runtime. */
export function usePlayerConfig(): PlayerConfig {
  const [, bump] = useState(0)
  useEffect(() => subscribePlayerConfig(() => bump((n) => n + 1)), [])
  return loadPlayerConfig()
}

/**
 * What identifies a rule to a player, so a second import of the same Genie
 * file adds nothing rather than doubling their config.
 *
 * Deliberately not the id, which is generated per import and would make every
 * re-import unique. Q6 turns this into the preview/apply merge
 * `docs/PLAYER_CONFIG.md` §6.2 describes; this is the one-run form of it.
 */
export function identityOf(domain: Domain, rule: Rule): string {
  switch (domain) {
    case 'presets':
    case 'variables':
      return (rule as PresetRule).name
    case 'aliases':
      return (rule as AliasRule).name
    case 'highlights':
      return `${(rule as HighlightRule).type}:${(rule as HighlightRule).pattern}`
    case 'macros':
      return `${(rule as MacroRule).key}+${(rule as MacroRule).modifiers.join('+')}`
    case 'substitutes':
      return (rule as SubstituteRule).find
    case 'gags':
      return (rule as GagRule).pattern
  }
}

/**
 * What a merge may do with a rule that is already here under the same
 * identity, and what it does with rules the incoming set does not mention.
 *
 * - `keep-mine` leaves it alone. This is what a second Genie import does: the
 *   player has edited these since, and Genie's file is the older opinion.
 * - `update` takes the incoming fields, keeping the local id so anything
 *   holding that id still resolves. This is what importing a config document
 *   the player carried from their other machine does.
 * - `replace-all` is `update` plus deletion: what the document does not carry
 *   is removed. Destructive on purpose, so it is a separate word rather than
 *   an option flag on the other two, and the panel confirms it before running.
 */
export type MergeMode = 'keep-mine' | 'update' | 'replace-all'

/**
 * Four numbers per domain, and they are exhaustive on purpose: every entry in
 * the incoming set lands in exactly one of `added`, `updated` or `unchanged`,
 * so `added + updated + unchanged` equals what the document held for that
 * domain. A report whose counts do not sum to the file is a report that lost
 * something quietly, which is the thing this whole surface exists to prevent -
 * `tools/player-config-transfer-test.mjs` asserts the sum rather than trusting
 * it. `removed` is about what was here, not about what arrived, and is zero
 * outside `replace-all`.
 */
export interface MergeReport {
  added: Record<Domain, number>
  updated: Record<Domain, number>
  unchanged: Record<Domain, number>
  removed: Record<Domain, number>
}

/** Everything but the generated id, which is per-machine and is not part of
 *  whether two rules say the same thing. */
function sameRule(a: Rule, b: Rule): boolean {
  const strip = (r: Rule) => {
    const { id: _id, ...rest } = r as Rule & { id: string }
    return JSON.stringify(Object.fromEntries(Object.entries(rest).sort(([x], [y]) => (x < y ? -1 : 1))))
  }
  return strip(a) === strip(b)
}

/**
 * Merge an incoming config into what is already stored, by identity. Pure; the
 * caller writes.
 *
 * One merge, three modes, rather than one merge for the Genie import and a
 * second for the config document: they differ only in what happens on an
 * identity collision, and two implementations of "is this the same rule" would
 * eventually disagree about it. `identityOf` is that judgement and it is
 * already one function.
 */
export function mergeImported(
  current: PlayerConfig,
  imported: PlayerConfig,
  mode: MergeMode = 'keep-mine'
): { config: PlayerConfig; report: MergeReport } {
  const config = emptyPlayerConfig()
  const report: MergeReport = {
    added: {} as Record<Domain, number>,
    updated: {} as Record<Domain, number>,
    unchanged: {} as Record<Domain, number>,
    removed: {} as Record<Domain, number>,
  }
  for (const domain of DOMAINS) {
    const held = current[domain] as Rule[]
    const byIdentity = new Map(held.map((r) => [identityOf(domain, r), r]))
    const incoming = new Map<string, Rule>()
    let added = 0
    let updated = 0
    let unchanged = 0

    // Build the result in the order the player already had, so an update does
    // not reorder somebody's list under them, then append what is new.
    const out: Rule[] = [...held]
    for (const rule of imported[domain] as Rule[]) {
      const identity = identityOf(domain, rule)
      incoming.set(identity, rule)
      const mine = byIdentity.get(identity)
      if (!mine) {
        byIdentity.set(identity, rule)
        out.push(rule)
        added += 1
        continue
      }
      if (mode === 'keep-mine' || sameRule(mine, rule)) {
        unchanged += 1
        continue
      }
      // The local id survives an update: it is this machine's handle on the
      // rule, and anything holding it (a preset a highlight names, a matched
      // id in a preview) would otherwise be repointed at nothing.
      const merged = { ...rule, id: mine.id } as Rule
      out[out.indexOf(mine)] = merged
      byIdentity.set(identity, merged)
      updated += 1
    }

    let removed = 0
    let kept = out
    if (mode === 'replace-all') {
      kept = out.filter((r) => incoming.has(identityOf(domain, r)))
      removed = out.length - kept.length
    }

    ;(config[domain] as Rule[]) = kept
    report.added[domain] = added
    report.updated[domain] = updated
    report.unchanged[domain] = unchanged
    report.removed[domain] = removed
  }
  return { config, report }
}

/** Write a whole config, one key per domain, reporting every failure rather
 *  than stopping at the first: a guard that discards the six writes that
 *  worked is worse than no guard. */
export function savePlayerConfig(config: PlayerConfig): {
  ok: boolean
  failures: Array<{ domain: Domain; message: string }>
} {
  const failures: Array<{ domain: Domain; message: string }> = []
  for (const domain of DOMAINS) {
    const result = setDomain(domain, config[domain] as never)
    if (!result.ok) failures.push({ domain, message: result.message })
  }
  return { ok: failures.length === 0, failures }
}
