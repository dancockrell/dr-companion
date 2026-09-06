/**
 * The one-time Genie import: seven `Config\*.cfg` files in, one `PlayerConfig`
 * and a report out.
 *
 * # Pure on purpose
 *
 * `importGenieConfig` takes the *text* of each file and returns the store. The
 * reads and the write belong to the caller, so the whole mapping is testable
 * with no Genie install, no Tauri and no localStorage - which is what lets
 * `tools/player-config-import-test.mjs` state `parsed` and `imported` against
 * `lines` as a denominator on fixtures and on a real config alike.
 *
 * # The parsers are recovered, not rewritten
 *
 * PR #456 deleted `substitutes.ts`, `gags.ts`, `presets.ts`, `variables.ts`
 * and `macros.ts` along with the editors that used them. Their parsers were
 * read against Dan's real files and were correct; writing new ones would be
 * inventing a second reading of a format somebody had already measured. The
 * five below are recovered verbatim from
 *
 *     git show 2327a971^:src/lib/{substitutes,gags,presets,variables,macros}.ts
 *
 * minus each module's `load*Config()`, which called `read_genie_config`
 * directly and is exactly what this lane removes: after this import nothing in
 * the running app reads a Genie config leaf again. They live here rather than
 * in five restored modules because there is one consumer, and five files with
 * one caller each is a shape that invites a second copy.
 *
 * `#highlight` and `#alias` are *not* recovered - `highlights.ts` and
 * `aliases.ts` are alive and own those formats. This calls them.
 *
 * # What does not come across
 *
 * Named, never dropped in silence. `docs/PLAYER_CONFIG.md` §6.1 is the table;
 * `UNSUPPORTED_ALWAYS` below is the part of it that is true of every import.
 */
import { parseHighlights } from './highlights.ts'
import { parseAliases } from './aliases.ts'
import {
  emptyPlayerConfig,
  isBookkeepingVariable,
  isGenieScript,
  newId,
  normalizeModifiers,
  type AliasRule,
  type Domain,
  type GagRule,
  type HighlightRule,
  type MacroRule,
  type PlayerConfig,
  type PresetRule,
  type SubstituteRule,
  type VariableRule,
} from './playerConfig.ts'

export type GenieLeaf =
  | 'highlights.cfg'
  | 'aliases.cfg'
  | 'macros.cfg'
  | 'presets.cfg'
  | 'substitutes.cfg'
  | 'gags.cfg'
  | 'variables.cfg'

/** The leaf each domain is imported from, and the order the report lists. */
export const GENIE_LEAVES: Record<GenieLeaf, Domain> = {
  'presets.cfg': 'presets',
  'highlights.cfg': 'highlights',
  'aliases.cfg': 'aliases',
  'macros.cfg': 'macros',
  'substitutes.cfg': 'substitutes',
  'gags.cfg': 'gags',
  'variables.cfg': 'variables',
}

export interface FileReport {
  leaf: GenieLeaf
  /** The file was supplied and had at least one non-blank line. A supplied
   *  file of nothing is `found: false`, not an import of zero. */
  found: boolean
  /** Non-blank lines. The denominator, so a parser that dropped half the file
   *  cannot report the same thing as one that worked. */
  lines: number
  parsed: number
  imported: number
  /** One string per refusal, with the line and the reason. */
  skipped: string[]
}

export interface ImportReport {
  perFile: FileReport[]
  /** Genie features this app has no home for. Listed, never dropped in
   *  silence. */
  unsupported: string[]
  /** Set when nothing at all could be read. An import that quietly reports
   *  "0 imported" over an empty input is a filter that emptied its input and
   *  called it a pass; this names the reason instead. */
  refused?: string
}

/* ------------------------------------------------------------------ *
 * The five recovered parsers. See the header: verbatim from 2327a971^.
 * ------------------------------------------------------------------ */

export interface Preset {
  name: string
  /** Comma-separated as Genie writes it - "Black, White" or "Magenta". */
  colours: string
  bold: boolean
  sourceLine: number
}

/** `colours` split into foreground and (if present) background, trimmed. */
export function presetColours(colours: string): { fg: string; bg: string | null } {
  const parts = colours.split(',').map((c) => c.trim())
  return { fg: parts[0] ?? '', bg: parts[1] || null }
}

export function parsePresets(text: string): { entries: Preset[]; skipped: string[] } {
  const entries: Preset[] = []
  const skipped: string[] = []

  const lines = text.split('\n')
  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo].trim()
    if (!line.startsWith('#preset')) continue

    const groups = [...line.matchAll(/\{([^}]*)\}/g)].map((m) => m[1])
    if (groups.length !== 3) {
      skipped.push(`${line} - ${groups.length} groups, expected 3`)
      continue
    }

    const [name, colours, bold] = groups
    if (!name) {
      skipped.push(`${line} - empty name`)
      continue
    }
    if (!colours.trim()) {
      skipped.push(`${line} - empty colours`)
      continue
    }
    if (bold !== 'True' && bold !== 'False') {
      skipped.push(`${line} - "${bold}" is not True or False`)
      continue
    }

    entries.push({ name, colours, bold: bold === 'True', sourceLine: lineNo })
  }

  return { entries, skipped }
}

export interface Macro {
  /** The bound key, Genie's own name for it - "F1", "NumPad8", "Escape", "D". */
  key: string
  /** Zero or more of "Shift"/"Control"/"Alt", in the order the file had them. */
  modifiers: string[]
  command: string
  sourceLine: number
}

const MACRO_MODIFIERS = ['Shift', 'Control', 'Alt']

export function parseMacros(text: string): { entries: Macro[]; skipped: string[] } {
  const entries: Macro[] = []
  const skipped: string[] = []

  const lines = text.split('\n')
  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo].trim()
    if (!line.startsWith('#macro')) continue

    const groups = [...line.matchAll(/\{([^}]*)\}/g)].map((m) => m[1])
    if (groups.length !== 2) {
      skipped.push(`${line} - ${groups.length} groups, expected 2`)
      continue
    }

    const [combo, command] = groups
    const parts = combo.split(',').map((p) => p.trim())
    const key = parts[0]
    const modifiers = parts.slice(1)

    if (!key) {
      skipped.push(`${line} - empty key`)
      continue
    }
    if (!command) {
      skipped.push(`${line} - empty command`)
      continue
    }
    const badModifier = modifiers.find((m) => !MACRO_MODIFIERS.includes(m))
    if (badModifier) {
      skipped.push(`${line} - unknown modifier "${badModifier}"`)
      continue
    }

    entries.push({ key, modifiers, command, sourceLine: lineNo })
  }

  return { entries, skipped }
}

export interface Variable {
  name: string
  value: string
  sourceLine: number
}

export function parseVariables(text: string): { entries: Variable[]; skipped: string[] } {
  const entries: Variable[] = []
  const skipped: string[] = []

  const lines = text.split('\n')
  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo].trim()
    if (!line.startsWith('#var')) continue

    const groups = [...line.matchAll(/\{([^}]*)\}/g)].map((m) => m[1])
    if (groups.length !== 2) {
      skipped.push(`${line} - ${groups.length} groups, expected 2`)
      continue
    }

    const [name, value] = groups
    if (!name) {
      skipped.push(`${line} - empty name`)
      continue
    }

    entries.push({ name, value, sourceLine: lineNo })
  }

  return { entries, skipped }
}

export interface Substitute {
  find: string
  replace: string
  sourceLine: number
}

/**
 * `#substitute {find} {replace}`.
 *
 * **Format inferred, not read.** `Config/substitutes.cfg` was empty on the
 * machine both this and the deleted module were written against, so the
 * two-group shape comes from the uniform directive convention every other
 * Genie config here *was* confirmed against. Re-check on the first populated
 * file anybody produces, and correct `docs/PLAYER_CONFIG.md` §6.1 if it
 * disagrees.
 */
export function parseSubstitutes(text: string): { entries: Substitute[]; skipped: string[] } {
  const entries: Substitute[] = []
  const skipped: string[] = []

  const lines = text.split('\n')
  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo].trim()
    if (!line.startsWith('#substitute')) continue

    const groups = [...line.matchAll(/\{([^}]*)\}/g)].map((m) => m[1])
    if (groups.length !== 2) {
      skipped.push(`${line} - ${groups.length} groups, expected 2`)
      continue
    }

    const [find, replace] = groups
    if (!find) {
      skipped.push(`${line} - empty find text`)
      continue
    }

    entries.push({ find, replace, sourceLine: lineNo })
  }

  return { entries, skipped }
}

export interface Gag {
  pattern: string
  sourceLine: number
}

/** `#gag {pattern}`. Same inferred-format caveat as `parseSubstitutes`. */
export function parseGags(text: string): { entries: Gag[]; skipped: string[] } {
  const entries: Gag[] = []
  const skipped: string[] = []

  const lines = text.split('\n')
  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo].trim()
    if (!line.startsWith('#gag')) continue

    const groups = [...line.matchAll(/\{([^}]*)\}/g)].map((m) => m[1])
    if (groups.length !== 1) {
      skipped.push(`${line} - ${groups.length} groups, expected 1`)
      continue
    }

    const [pattern] = groups
    if (!pattern) {
      skipped.push(`${line} - empty pattern`)
      continue
    }

    entries.push({ pattern, sourceLine: lineNo })
  }

  return { entries, skipped }
}

/* ------------------------------------------------------------------ *
 * The mapping.
 * ------------------------------------------------------------------ */

/**
 * Genie's own bookkeeping, and a command this app cannot execute.
 *
 * Both moved to `playerConfig.ts` by Q3 and re-exported here, because the
 * editors need the same two answers and an importer is the wrong owner for a
 * property of a *stored* rule: `aliases.ts` asking this module would have made
 * a cycle, and a second copy of either predicate is the fork that would let the
 * import and the editor disagree about which rules are runnable.
 */
export { isBookkeepingVariable, isGenieScript }

const BOOKKEEPING = isBookkeepingVariable

const UNSUPPORTED_ALWAYS = [
  'Window layout, palettes, #script and plugins are not imported: this app has no equivalent surface for them.',
  'The Genie class-off state stays a per-listener display preference here (`drc.off-highlight-classes.v1`) and is not imported, so importing a shared config cannot mute classes for anybody else.',
]

const nonBlank = (text: string) => text.split('\n').filter((l) => l.trim().length > 0).length

/**
 * Read every supplied Genie file into one store.
 *
 * `files` is keyed by leaf; a leaf that is absent, or present and blank, is
 * reported `found: false`. If *no* leaf has content the whole import is
 * refused by name - a run that reports "imported 0" over an empty input is a
 * filter that emptied its input and called it a pass.
 */
export function importGenieConfig(files: Partial<Record<GenieLeaf, string>>): {
  config: PlayerConfig
  report: ImportReport
} {
  const config = emptyPlayerConfig()
  const perFile: FileReport[] = []
  const unsupported: string[] = []

  const start = (leaf: GenieLeaf): FileReport => {
    const text = files[leaf]
    const lines = typeof text === 'string' ? nonBlank(text) : 0
    const report: FileReport = {
      leaf,
      found: typeof text === 'string' && lines > 0,
      lines,
      parsed: 0,
      imported: 0,
      skipped: [],
    }
    perFile.push(report)
    return report
  }

  // Presets first: a highlight can name one, and the id it names has to exist
  // by the time the highlight is read.
  const presetIds = new Map<string, string>()
  {
    const r = start('presets.cfg')
    if (r.found) {
      const { entries, skipped } = parsePresets(files['presets.cfg'] as string)
      r.parsed = entries.length
      r.skipped.push(...skipped)
      for (const p of entries) {
        const { fg, bg } = presetColours(p.colours)
        const rule: PresetRule = {
          id: newId('presets'),
          enabled: true,
          source: 'genie-import',
          name: p.name,
          fg,
          ...(bg ? { bg } : {}),
          bold: p.bold,
        }
        presetIds.set(p.name, rule.id)
        config.presets.push(rule)
      }
      r.imported = config.presets.length
    }
  }

  {
    const r = start('highlights.cfg')
    if (r.found) {
      const { entries, skipped } = parseHighlights(files['highlights.cfg'] as string)
      r.parsed = entries.length
      r.skipped.push(...skipped)
      for (const h of entries) {
        const rule: HighlightRule = {
          id: newId('highlights'),
          enabled: true,
          source: 'genie-import',
          type: h.type,
          pattern: h.pattern,
          colour: h.colour,
          ...(h.cls ? { cls: h.cls } : {}),
          ...(h.sound ? { sound: h.sound } : {}),
        }
        config.highlights.push(rule)
      }
      r.imported = config.highlights.length
    }
  }

  {
    const r = start('aliases.cfg')
    if (r.found) {
      const { entries, skipped } = parseAliases(files['aliases.cfg'] as string)
      r.parsed = entries.length
      r.skipped.push(...skipped)
      let scripted = 0
      for (const a of entries) {
        const script = isGenieScript(a.expansion)
        if (script) scripted += 1
        const rule: AliasRule = {
          id: newId('aliases'),
          enabled: !script,
          source: 'genie-import',
          name: a.name,
          expansion: a.expansion,
        }
        config.aliases.push(rule)
      }
      r.imported = config.aliases.length
      if (scripted) {
        unsupported.push(
          `aliases.cfg: ${scripted} of ${entries.length} expansions contain Genie script ` +
            '(#directives or \\x escapes). Imported with their text intact and switched off, ' +
            'because this app has no script engine to run them.'
        )
      }
    }
  }

  {
    const r = start('macros.cfg')
    if (r.found) {
      const { entries, skipped } = parseMacros(files['macros.cfg'] as string)
      r.parsed = entries.length
      r.skipped.push(...skipped)
      let scripted = 0
      for (const m of entries) {
        const script = isGenieScript(m.command)
        if (script) scripted += 1
        const rule: MacroRule = {
          id: newId('macros'),
          enabled: !script,
          source: 'genie-import',
          key: m.key,
          modifiers: normalizeModifiers(m.modifiers),
          // `;` is this app's command separator too (`frontends.ts`'s
          // `prefixFor`), so one Genie command line becomes the command list
          // the lane sends one at a time.
          commands: m.command
            .split(';')
            .map((c) => c.trim())
            .filter(Boolean),
        }
        config.macros.push(rule)
      }
      r.imported = config.macros.length
      if (scripted) {
        unsupported.push(
          `macros.cfg: ${scripted} of ${entries.length} bindings contain Genie script ` +
            '(#directives or \\x escapes). Imported with their text intact and switched off.'
        )
      }
    }
  }

  {
    const r = start('substitutes.cfg')
    if (r.found) {
      const { entries, skipped } = parseSubstitutes(files['substitutes.cfg'] as string)
      r.parsed = entries.length
      r.skipped.push(...skipped)
      for (const s of entries) {
        const rule: SubstituteRule = {
          id: newId('substitutes'),
          enabled: true,
          source: 'genie-import',
          find: s.find,
          replace: s.replace,
        }
        config.substitutes.push(rule)
      }
      r.imported = config.substitutes.length
    }
  }

  {
    const r = start('gags.cfg')
    if (r.found) {
      const { entries, skipped } = parseGags(files['gags.cfg'] as string)
      r.parsed = entries.length
      r.skipped.push(...skipped)
      for (const g of entries) {
        const rule: GagRule = {
          id: newId('gags'),
          enabled: true,
          source: 'genie-import',
          pattern: g.pattern,
        }
        config.gags.push(rule)
      }
      r.imported = config.gags.length
    }
  }

  {
    const r = start('variables.cfg')
    if (r.found) {
      const { entries, skipped } = parseVariables(files['variables.cfg'] as string)
      r.parsed = entries.length
      r.skipped.push(...skipped)
      const bookkeeping: string[] = []
      for (const v of entries) {
        if (BOOKKEEPING(v.name)) {
          bookkeeping.push(v.name)
          continue
        }
        const rule: VariableRule = {
          id: newId('variables'),
          enabled: true,
          source: 'genie-import',
          name: v.name,
          value: v.value,
        }
        config.variables.push(rule)
      }
      r.imported = config.variables.length
      if (bookkeeping.length) {
        unsupported.push(
          `variables.cfg: ${bookkeeping.length} of ${entries.length} are Genie own ` +
            `bookkeeping and are not imported (${bookkeeping.slice(0, 4).join(', ')}` +
            `${bookkeeping.length > 4 ? ', …' : ''}). They are written by Genie while it plays, ` +
            'not settings anybody tuned.'
        )
      }
    }
  }

  unsupported.push(...UNSUPPORTED_ALWAYS)

  const report: ImportReport = { perFile, unsupported }
  if (!perFile.some((f) => f.found)) {
    report.refused =
      'None of the seven Genie config files had a single non-blank line. Nothing was imported, ' +
      'and this is refused rather than reported as an import of zero: an empty input and a ' +
      'working import that found nothing look identical otherwise.'
  }
  return { config, report }
}

/** The seven leaves, in the order a report lists them. */
export const GENIE_LEAF_ORDER = Object.keys(GENIE_LEAVES) as GenieLeaf[]
