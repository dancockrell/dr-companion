/**
 * Text substitution, native, reading Genie's own config format.
 *
 *     #substitute {find} {replace}
 *
 * Same two-group shape as `#alias` - Genie's directive syntax is uniform
 * across every config type this project has read a real file for
 * (`#highlight`, `#alias`, `#macro`, `#var`, all confirmed against files with
 * real content). This one is the exception: `Config/substitutes.cfg` is
 * empty on this machine, so unlike the others, this format is inferred from
 * that established convention rather than confirmed against a populated
 * file. Worth re-checking against a real file the first time this produces
 * a line that Genie does not honor.
 *
 * `find` replaces as a literal substring in what the game sends, before it
 * is displayed - not a regular expression, matching how Genie's own
 * substitution is documented to work (unlike `#highlight`'s `regexp` type,
 * which is explicit about being one).
 */
import { invokeTauri, isTauri } from './tauri.ts'

export interface Substitute {
  find: string
  replace: string
  sourceLine: number
}

/**
 * Parse a Genie substitutes config.
 *
 * Same tolerance as the other parsers here: skip what does not parse, count
 * the skips, hand them back.
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

export interface SubstituteConfig {
  entries: Substitute[]
  note: string
}

/** Read and parse `Config/substitutes.cfg`, same shape as `loadAliasConfig`. */
export async function loadSubstituteConfig(): Promise<SubstituteConfig> {
  if (!isTauri()) {
    return { entries: [], note: 'No substitutes in a browser: the config lives beside Genie.' }
  }
  try {
    const cfg = (await invokeTauri('read_genie_config', { leaf: 'substitutes.cfg' })) as {
      found: boolean
      text: string
      note: string
    }
    if (!cfg.found) {
      return { entries: [], note: cfg.note }
    }
    const { entries, skipped } = parseSubstitutes(cfg.text)
    const nonBlank = cfg.text.split('\n').filter((l) => l.trim().length > 0).length
    const note = skipped.length
      ? `${entries.length} of ${nonBlank} non-blank lines parsed, ${skipped.length} skipped`
      : `${entries.length} of ${nonBlank} non-blank lines parsed`
    return { entries, note }
  } catch (e) {
    return { entries: [], note: String(e) }
  }
}
