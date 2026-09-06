/**
 * The whole player config as one document: written out, read back, merged in.
 *
 *   docs/PLAYER_CONFIG.md §4.2 is the format; §13 is the report.
 *
 * # One document, one writer, one validator
 *
 * Three things this module deliberately does not do, each because doing it
 * would have made a second of something that already exists:
 *
 * - **It does not write a file.** `playerFiles.ts`'s `writePlayerFile` is the
 *   whole write surface for anything this app puts on a player's disk, and it
 *   carries the compare-and-swap and the one-time backup that Q5 moved into
 *   `src-tauri/src/player_files.rs`. This module builds the text and hands it
 *   over, exactly as `pinsFile.ts` does.
 * - **It does not have its own header format.** `exportEnvelope.ts` reads the
 *   `{ version, provenance }` header, and the scene editor's export reads the
 *   same one. Two documents this app writes for a player, one header, one
 *   reader that admits or refuses it.
 * - **It does not have its own idea of a valid rule.** Every entry goes
 *   through `migratePlayerConfig`, which is the store's own reader, and then
 *   through the very predicate the matching editor calls before it saves:
 *   `compilePattern` for a highlight (Q2), `ruleRefusal` for a substitute or a
 *   gag (Q4), `isGenieScript` and `isBookkeepingVariable` for aliases, macros
 *   and variables (Q3). A rule this app would refuse to let a player type is a
 *   rule it refuses to import, and it says so naming the domain and the id.
 *   A second validator here would be a second answer to "what may a player
 *   have", and the two would diverge the first time either was improved.
 *
 * # Nothing is dropped in silence
 *
 * The report's per-domain counts are exhaustive against the file: every entry
 * the document held is added, updated, unchanged, or refused with a reason.
 * `tools/player-config-transfer-test.mjs` asserts that sum rather than
 * believing it, because a report whose numbers do not add up is exactly how a
 * rule goes missing while the screen says the import worked.
 *
 * A rule that is kept but switched off is a fourth outcome and it is reported
 * separately rather than folded into `updated`: a macro whose commands are
 * Genie script is imported with its text intact and `enabled: false`, which is
 * what the Macros editor does with the same rule, and a player who is not told
 * will read it as the import having half-worked.
 */
import {
  DOMAINS,
  PLAYER_CONFIG_VERSION,
  emptyPlayerConfig,
  identityOf,
  isBookkeepingVariable,
  isGenieScript,
  loadPlayerConfig,
  mergeImported,
  migratePlayerConfig,
  resetPlayerConfigCache,
  savePlayerConfig,
  type AliasRule,
  type Domain,
  type GagRule,
  type HighlightRule,
  type MacroRule,
  type MergeMode,
  type PlayerConfig,
  type Rule,
  type SubstituteRule,
  type VariableRule,
} from './playerConfig.ts'
import { compilePattern, refuseDeletingPreset } from './highlights.ts'
import { ruleRefusal } from './lineRules.ts'
import { readEnvelope, type ExportEnvelope } from './exportEnvelope.ts'
import { readPlayerFile, writePlayerFile } from './playerFiles.ts'

/**
 * The file, in `app_data_dir()/config` beside the pins.
 *
 * A fixed leaf rather than a save dialog: the point of Q5 was that "where did
 * it go" has an answer, and `reveal_file` opens that folder. A player who
 * wants it somewhere else copies it, which is a thing they can do and a thing
 * this app cannot get wrong on their behalf.
 */
export const PLAYER_CONFIG_LEAF = 'player-config.json'

/** The whole store plus the header every export this app writes carries. */
export interface PlayerConfigDocument extends ExportEnvelope, PlayerConfig {}

/** One entry the document held and this build would not store, naming what it
 *  was. A count is not a report: "refused 3" out of 400 rules names nothing a
 *  player can act on. */
export interface TransferRefusal {
  domain: Domain
  /** The entry's id where it had a readable one, null where the entry was too
   *  malformed to have one. Three states again: an id, no id, and a domain
   *  that could not be read at all (`id: null`, `why` naming the domain). */
  id: string | null
  why: string
}

/** One entry kept with its text intact and switched off, and why. */
export interface TransferDisabled {
  domain: Domain
  id: string
  why: string
}

/**
 * A preset the import removes with highlights still naming it.
 *
 * `why` is `refuseDeletingPreset`'s own sentence, unedited. That is the whole
 * point of the type: the editor already refuses to delete a preset while
 * highlights point at it (#490 named `PresetsTab` as the only caller), and a
 * `replace-all` that deletes the same preset from underneath the same
 * highlights said nothing. Two warnings about one situation, worded by two
 * places, would disagree the first time either was improved - so there is one,
 * and the import quotes it.
 */
export interface TransferOrphan {
  presetId: string
  /** The preset's name as the player knows it, or the id where the incoming
   *  document is the only thing that ever mentioned it. */
  presetName: string
  /** The highlights left pointing at it, named rather than counted. */
  highlights: Array<{ id: string; type: string; pattern: string }>
  why: string
}

export interface TransferReport {
  mode: MergeMode
  provenance: string
  /** True when the document was written by an older version of this format and
   *  was migrated on the way in. */
  migrated: boolean
  /** How many entries the document itself carried, per domain. The
   *  denominator: `added + updated + unchanged + refused` must equal it. */
  inFile: Record<Domain, number>
  added: Record<Domain, number>
  updated: Record<Domain, number>
  unchanged: Record<Domain, number>
  /** Rules that were here and the document did not carry. Only `replace-all`
   *  removes anything. */
  removed: Record<Domain, number>
  refused: TransferRefusal[]
  disabled: TransferDisabled[]
  /** Presets this import removes that surviving highlights still name. Empty
   *  for every `update`, because `update` removes nothing. */
  orphaned: TransferOrphan[]
}

const zeroes = (): Record<Domain, number> =>
  Object.fromEntries(DOMAINS.map((d) => [d, 0])) as Record<Domain, number>

/**
 * Why an editor would refuse to save this rule, or null.
 *
 * Every branch delegates. This function's whole content is which question to
 * ask of which domain; the answers belong to the modules that also answer them
 * for the live runtime.
 */
export function editorRefusal(domain: Domain, rule: Rule): string | null {
  switch (domain) {
    case 'highlights': {
      const h = rule as HighlightRule
      const compiled = compilePattern(h.type, h.pattern)
      return compiled.ok ? null : `pattern ${JSON.stringify(h.pattern)}: ${compiled.why}`
    }
    case 'substitutes': {
      const s = rule as SubstituteRule
      const why = ruleRefusal(s.find, s.regex)
      return why === null ? null : `find ${JSON.stringify(s.find)}: ${why}`
    }
    case 'gags': {
      const g = rule as GagRule
      const why = ruleRefusal(g.pattern, g.regex)
      return why === null ? null : `pattern ${JSON.stringify(g.pattern)}: ${why}`
    }
    case 'variables': {
      const v = rule as VariableRule
      return isBookkeepingVariable(v.name)
        ? `${v.name} is Genie's own bookkeeping, not a value a player sets; the Variables editor refuses to create one`
        : null
    }
    default:
      return null
  }
}

/**
 * Why this rule is kept and switched off, or null.
 *
 * Not a refusal: the text is stored exactly as it arrived, so the player sees
 * what they had. It simply does not fire, because nothing in this app can
 * execute a Genie script directive.
 */
export function scriptDisabled(domain: Domain, rule: Rule): string | null {
  if (domain === 'aliases' && isGenieScript((rule as AliasRule).expansion)) {
    return 'the expansion is Genie script, which this app cannot run'
  }
  if (domain === 'macros' && (rule as MacroRule).commands.some(isGenieScript)) {
    return 'a command is Genie script, which this app cannot run'
  }
  return null
}

/**
 * The store as a document.
 *
 * Every entry is run back through `migratePlayerConfig` on the way out, which
 * is not defensiveness: it is what makes the bytes deterministic. The reader
 * rebuilds an entry field by field in a fixed order, so an entry an editor
 * created with its keys in another order still serialises identically, and two
 * exports of one store are the same file. A diff that is really a key order is
 * a diff nobody can review.
 */
export function exportPlayerConfig(
  config: PlayerConfig = loadPlayerConfig(),
  provenance = 'player'
): PlayerConfigDocument {
  const out = emptyPlayerConfig() as PlayerConfig
  for (const domain of DOMAINS) {
    const read = migratePlayerConfig(
      { version: PLAYER_CONFIG_VERSION, entries: config[domain] as Rule[] },
      domain
    )
    ;(out[domain] as Rule[]) = read.entries
  }
  return { ...out, version: PLAYER_CONFIG_VERSION, provenance }
}

/** The document as the bytes that go on disk: two-space JSON with a trailing
 *  newline, so a text editor and `git diff` both behave. */
export function serializePlayerConfig(doc: PlayerConfigDocument): string {
  const ordered: Record<string, unknown> = { version: doc.version, provenance: doc.provenance }
  for (const domain of DOMAINS) ordered[domain] = doc[domain]
  return `${JSON.stringify(ordered, null, 2)}\n`
}

export interface ParsedDocument {
  config: PlayerConfig
  provenance: string
  migrated: boolean
  inFile: Record<Domain, number>
  refused: TransferRefusal[]
  disabled: TransferDisabled[]
}

/**
 * The one parser. Header, then every domain, then every entry.
 *
 * Refuses the whole document only for a header this build cannot read - a
 * version it does not know, no provenance, not an object at all. Everything
 * below that is per entry, so one bad rule in one domain costs that rule and
 * the other six domains import.
 */
export function parsePlayerConfigDocument(
  file: unknown
): { ok: false; reason: string } | { ok: true; parsed: ParsedDocument } {
  const header = readEnvelope(file, {
    kind: 'a player config export',
    version: PLAYER_CONFIG_VERSION,
    // No older format has ever been written. When there is a version 2 this is
    // where 1 goes, and `migratePlayerConfig` already knows how to read a
    // lower-versioned domain, which is why the list is here and not a boolean.
    migratable: [],
  })
  if (!header.ok) return { ok: false, reason: header.reason }

  const doc = file as Record<string, unknown>
  const config = emptyPlayerConfig()
  const inFile = zeroes()
  const refused: TransferRefusal[] = []
  const disabled: TransferDisabled[] = []

  for (const domain of DOMAINS) {
    const raw = doc[domain]
    inFile[domain] = Array.isArray(raw) ? raw.length : 0
    const read = migratePlayerConfig({ version: header.version, entries: raw }, domain)
    if (read.status === 'refused') {
      // Deliberately not `read.why`: the store's own refusal names a
      // localStorage key, which is the right sentence there and a confusing
      // one about a file somebody mailed you.
      refused.push({
        domain,
        id: null,
        why: `the document's "${domain}" is not a list of rules`,
      })
      continue
    }
    for (const why of read.dropped) refused.push({ domain, id: null, why })
    const kept: Rule[] = []
    for (const entry of read.entries) {
      const no = editorRefusal(domain, entry)
      if (no !== null) {
        refused.push({ domain, id: entry.id, why: no })
        continue
      }
      const off = scriptDisabled(domain, entry)
      if (off !== null && entry.enabled) {
        disabled.push({ domain, id: entry.id, why: off })
        kept.push({ ...entry, enabled: false })
        continue
      }
      kept.push(entry)
    }
    ;(config[domain] as Rule[]) = kept
  }

  return {
    ok: true,
    parsed: { config, provenance: header.provenance, migrated: header.migrated, inFile, refused, disabled },
  }
}

/** `JSON.parse` with the syntax error turned into a sentence, so a pasted
 *  half-file reads as a bad paste rather than as a stack trace. One place,
 *  because both the text parser and the text preview need it and a second copy
 *  would eventually word it differently. */
function readJsonText(text: string): { ok: false; reason: string } | { ok: true; value: unknown } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (e) {
    return { ok: false, reason: `That is not JSON: ${(e as Error).message}` }
  }
}

export function parsePlayerConfigText(
  text: string
): { ok: false; reason: string } | { ok: true; parsed: ParsedDocument } {
  const read = readJsonText(text)
  if (!read.ok) return read
  return parsePlayerConfigDocument(read.value)
}

/**
 * Parse, then merge against what is here. Pure - the caller writes.
 *
 * Preview and apply are the same call: the panel runs it to show the report,
 * and applying writes the `config` it already computed rather than merging a
 * second time. Two merges would be two chances to disagree, and the count the
 * player was shown would be a claim about a run that never happened.
 */
export function previewPlayerConfigImport(
  file: unknown,
  mode: MergeMode = 'update',
  current: PlayerConfig = loadPlayerConfig()
): { ok: false; reason: string } | { ok: true; config: PlayerConfig; report: TransferReport } {
  const parsed = parsePlayerConfigDocument(file)
  if (!parsed.ok) return parsed
  const { config, report: merge } = mergeImported(current, parsed.parsed.config, mode)
  const refusedPer = zeroes()
  for (const r of parsed.parsed.refused) refusedPer[r.domain] += 1
  return {
    ok: true,
    config,
    report: {
      mode,
      provenance: parsed.parsed.provenance,
      migrated: parsed.parsed.migrated,
      inFile: parsed.parsed.inFile,
      added: merge.added,
      updated: merge.updated,
      unchanged: merge.unchanged,
      removed: merge.removed,
      refused: parsed.parsed.refused,
      disabled: parsed.parsed.disabled,
      // Computed from the merged config the caller is about to write, not from
      // the document: a highlight is orphaned by what survives, and only the
      // merge knows that.
      orphaned: orphanedByImport(current, config),
    },
  }
}

/**
 * Highlights that would come out of this import naming a preset that is no
 * longer there.
 *
 * `wouldRemove` reports identities per domain and nothing crosses between
 * them, which is why `replace-all` could delete a preset while the highlights
 * pointing at it survived and nothing said so (#490). The case that bites is a
 * partial document: one carrying somebody's highlights and not their presets,
 * or carrying presets under different ids. Then seven lines quietly change
 * colour and the report's numbers all add up.
 *
 * Not a data-loss bug - `resolveHighlights` resolves a dangling `presetId` to
 * the default colour and says so in `refused`, so nothing is dropped. It is
 * the same warning the editor gives before deleting a preset by hand, given
 * before a document deletes twenty of them at once, and it is that function's
 * words rather than a second wording of the same fact.
 */
export function orphanedByImport(
  current: PlayerConfig,
  merged: PlayerConfig
): TransferOrphan[] {
  const kept = new Set(merged.presets.map((p) => p.id))
  const names = new Map<string, string>()
  for (const h of merged.highlights) {
    if (!h.presetId || kept.has(h.presetId)) continue
    if (names.has(h.presetId)) continue
    names.set(h.presetId, current.presets.find((p) => p.id === h.presetId)?.name ?? h.presetId)
  }

  const out: TransferOrphan[] = []
  for (const [presetId, presetName] of names) {
    const refusal = refuseDeletingPreset({ id: presetId, name: presetName }, merged.highlights)
    // `ok` cannot happen: the id came out of those very highlights. Handled
    // rather than asserted, because a silent `[]` here would be exactly the
    // warning gap this function was written to close.
    if (refusal.ok) continue
    out.push({
      presetId,
      presetName,
      highlights: refusal.users.map((h) => ({ id: h.id, type: h.type, pattern: h.pattern })),
      why: refusal.why,
    })
  }
  return out
}

/** How many highlights this import would leave without their preset. The
 *  sentence the panel shows, and the number a check can assert. */
export function orphanCount(orphans: readonly TransferOrphan[]): number {
  return orphans.reduce((n, o) => n + o.highlights.length, 0)
}

/** The same preview from text, so the panel has one entry point rather than
 *  parsing the paste once for its error message and again for its report. */
export function previewPlayerConfigImportText(
  text: string,
  mode: MergeMode = 'update',
  current: PlayerConfig = loadPlayerConfig()
): { ok: false; reason: string } | { ok: true; config: PlayerConfig; report: TransferReport } {
  const read = readJsonText(text)
  if (!read.ok) return read
  return previewPlayerConfigImport(read.value, mode, current)
}

/**
 * Apply what the preview computed. Writes all seven keys, then forgets the
 * cache so every reader re-reads.
 *
 * Takes the already-merged config rather than re-deriving it, for the reason
 * above. A failed write is reported per domain rather than swallowed: six
 * domains that landed and one that hit the quota is a different situation from
 * seven that did not, and only one of them means the player should try again.
 */
export function applyPlayerConfigImport(config: PlayerConfig): {
  ok: boolean
  failures: Array<{ domain: Domain; message: string }>
} {
  const result = savePlayerConfig(config)
  resetPlayerConfigCache()
  return result
}

/**
 * Write the whole store to `app_data_dir()/config/player-config.json`.
 *
 * Reads the file and writes it in the same breath, handing back what it just
 * read as `expectedPrevious`. That is the compare-and-swap, and the reason it
 * is here rather than in the caller: acting on a measurement taken minutes ago
 * is what lets a second window of this app overwrite the first one's export
 * with nothing on screen to say so.
 */
export async function exportPlayerConfigToFile(
  config: PlayerConfig = loadPlayerConfig()
): Promise<{ path: string; backedUp: boolean; bytes: number }> {
  const text = serializePlayerConfig(exportPlayerConfig(config))
  const current = await readPlayerFile(PLAYER_CONFIG_LEAF)
  const written = await writePlayerFile(
    PLAYER_CONFIG_LEAF,
    text,
    current.found ? current.text : ''
  )
  return { ...written, bytes: text.length }
}

/** Read the document back off disk. `found: false` is the ordinary answer for
 *  a player who has never exported, not an error. */
export async function readPlayerConfigFile(): Promise<{ found: boolean; text: string; path: string; note: string }> {
  const file = await readPlayerFile(PLAYER_CONFIG_LEAF)
  return { found: file.found, text: file.text, path: file.path, note: file.note }
}

/**
 * The identities a document carries, for a caller that wants to say what a
 * `replace-all` would delete before running it.
 *
 * Same `identityOf` the merge uses, so the warning and the deletion cannot
 * disagree about which rules those are.
 */
export function wouldRemove(current: PlayerConfig, incoming: PlayerConfig): Record<Domain, string[]> {
  const out = {} as Record<Domain, string[]>
  for (const domain of DOMAINS) {
    const theirs = new Set((incoming[domain] as Rule[]).map((r) => identityOf(domain, r)))
    out[domain] = (current[domain] as Rule[])
      .filter((r) => !theirs.has(identityOf(domain, r)))
      .map((r) => identityOf(domain, r))
  }
  return out
}
