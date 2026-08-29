/**
 * Genie's UI colour scheme, native, reading Genie's own config format.
 *
 *     #preset {name} {colours} {bold}
 *
 * Read Dan's real `Config/presets.cfg` (31 entries) to get this shape.
 * `colours` is one or two CSS-recognisable colour names or `#RRGGBB` hex
 * values, comma-separated - foreground alone (`Magenta`), or
 * `foreground, background` (`Black, White`). Every name observed in the real
 * file (Crimson, PaleGoldenrod, GreenYellow, ...) is a standard CSS named
 * colour, so no name-to-hex table is needed to render a swatch from one.
 *
 * `bold` is `True`/`False`, matching every other boolean this project has
 * read out of a Genie config so far.
 *
 * `name` is a fixed vocabulary Genie assigns meaning to internally (`health`,
 * `mana`, `roomname`, `automapper.line`, ...) - this reads and edits the
 * colours assigned to those names, it does not invent new preset names of
 * its own, since a name Genie does not recognise would just never be applied
 * anywhere.
 */
import { invokeTauri, isTauri } from './tauri.ts'

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

/**
 * Parse a Genie presets config.
 *
 * Same tolerance as the other parsers here: skip what does not parse, count
 * the skips, hand them back.
 */
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

export interface PresetConfig {
  entries: Preset[]
  note: string
}

/** Read and parse `Config/presets.cfg`, same shape as `loadAliasConfig`. */
export async function loadPresetConfig(): Promise<PresetConfig> {
  if (!isTauri()) {
    return { entries: [], note: 'No presets in a browser: the config lives beside Genie.' }
  }
  try {
    const cfg = (await invokeTauri('read_genie_config', { leaf: 'presets.cfg' })) as {
      found: boolean
      text: string
      note: string
    }
    if (!cfg.found) {
      return { entries: [], note: cfg.note }
    }
    const { entries, skipped } = parsePresets(cfg.text)
    const nonBlank = cfg.text.split('\n').filter((l) => l.trim().length > 0).length
    const note = skipped.length
      ? `${entries.length} of ${nonBlank} non-blank lines parsed, ${skipped.length} skipped`
      : `${entries.length} of ${nonBlank} non-blank lines parsed`
    return { entries, note }
  } catch (e) {
    return { entries: [], note: String(e) }
  }
}
