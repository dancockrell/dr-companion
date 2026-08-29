/**
 * Line gags, native, reading Genie's own config format.
 *
 *     #gag {pattern}
 *
 * One group - Genie's directive syntax is uniform across every config type
 * this project reads, just with a different number of groups per directive.
 * Same caveat as `substitutes.ts`: `Config/gags.cfg` is empty on this
 * machine, so this format is inferred from the established convention
 * (highlight/alias/macro/var, all confirmed against real files) rather than
 * confirmed against a populated one.
 *
 * `pattern` is a literal substring match against a whole line, same as
 * `#highlight`'s `line` type - a gag hides the entire line, it does not
 * redact part of it.
 */
import { invokeTauri, isTauri } from './tauri.ts'

export interface Gag {
  pattern: string
  sourceLine: number
}

/**
 * Parse a Genie gags config.
 *
 * Same tolerance as the other parsers here: skip what does not parse, count
 * the skips, hand them back.
 */
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

export interface GagConfig {
  entries: Gag[]
  note: string
}

/** Read and parse `Config/gags.cfg`, same shape as `loadAliasConfig`. */
export async function loadGagConfig(): Promise<GagConfig> {
  if (!isTauri()) {
    return { entries: [], note: 'No gags in a browser: the config lives beside Genie.' }
  }
  try {
    const cfg = (await invokeTauri('read_genie_config', { leaf: 'gags.cfg' })) as {
      found: boolean
      text: string
      note: string
    }
    if (!cfg.found) {
      return { entries: [], note: cfg.note }
    }
    const { entries, skipped } = parseGags(cfg.text)
    const nonBlank = cfg.text.split('\n').filter((l) => l.trim().length > 0).length
    const note = skipped.length
      ? `${entries.length} of ${nonBlank} non-blank lines parsed, ${skipped.length} skipped`
      : `${entries.length} of ${nonBlank} non-blank lines parsed`
    return { entries, note }
  } catch (e) {
    return { entries: [], note: String(e) }
  }
}
