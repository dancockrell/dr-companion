/**
 * Keyboard macros, native, reading Genie's own config format.
 *
 * Same reasoning as highlights.ts/aliases.ts: players have years of `#macro`
 * lines in `Config/macros.cfg`, and Dan's real file has 95 of them - every
 * F-key, every NumPad direction, three modifier layers deep (`{G, Shift,
 * Control}`). Read that format rather than inventing one.
 *
 *     #macro {Key} {command}
 *     #macro {Key, Modifier1, Modifier2} {command}
 *
 * `Key` and its modifiers are Genie's own key names - the same
 * `System.Windows.Forms.Keys` vocabulary a .NET WinForms app reads off a
 * KeyEventArgs, not a web KeyboardEvent.code. `keybindings.ts` is what
 * bridges the two for the handful of bindings it hardcodes; this module does
 * not attempt that translation for arbitrary macros - see its own header for
 * why a general Genie-script interpreter (`#class`, `#queue`, `#setvar`,
 * `$variable` substitution, the `\x` escape several of Dan's own F-key
 * macros use) is out of scope rather than guessed at.
 *
 * `command` may itself be several instructions joined with `;`, exactly like
 * an alias expansion, and is passed through untouched here for the same
 * reason: this is a config editor, not a script engine.
 */
import { invokeTauri, isTauri } from './tauri.ts'

export interface Macro {
  /** The bound key, Genie's own name for it - "F1", "NumPad8", "Escape", "D". */
  key: string
  /** Zero or more of "Shift"/"Control"/"Alt", in the order the file had them. */
  modifiers: string[]
  command: string
  /** 0-indexed source line, same reasoning as `Highlight.sourceLine`. */
  sourceLine: number
}

/** Genie writes modifiers in a fixed order (Shift, then Control, then Alt) in
 * every one of Dan's 95 real entries. Normalising to that order means two
 * macros bound to the same physical combo compare equal regardless of the
 * order a player typed them in when adding one by hand. */
const MODIFIER_ORDER = ['Shift', 'Control', 'Alt']

export function normalizeModifiers(mods: readonly string[]): string[] {
  return MODIFIER_ORDER.filter((m) => mods.includes(m))
}

/** A stable identity for "this physical key combo" - used to find duplicate
 * bindings, the same way highlight/alias conflict detection does. */
export function comboKey(key: string, modifiers: readonly string[]): string {
  return `${key}+${normalizeModifiers(modifiers).join('+')}`
}

/**
 * Parse a Genie macro config.
 *
 * Same tolerance as parseHighlights/parseAliases: skip what does not parse,
 * count the skips, hand them back rather than swallowing them in silence the
 * way Genie itself does.
 */
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
    const badModifier = modifiers.find((m) => !MODIFIER_ORDER.includes(m))
    if (badModifier) {
      skipped.push(`${line} - unknown modifier "${badModifier}"`)
      continue
    }

    entries.push({ key, modifiers, command, sourceLine: lineNo })
  }

  return { entries, skipped }
}

export interface MacroConfig {
  entries: Macro[]
  note: string
}

/**
 * Read and parse `Config/macros.cfg` through `read_genie_config`, same shape
 * as `loadAliasConfig`.
 */
export async function loadMacroConfig(): Promise<MacroConfig> {
  if (!isTauri()) {
    return { entries: [], note: 'No macros in a browser: the config lives beside Genie.' }
  }
  try {
    const cfg = (await invokeTauri('read_genie_config', { leaf: 'macros.cfg' })) as {
      found: boolean
      text: string
      note: string
    }
    if (!cfg.found) {
      return { entries: [], note: cfg.note }
    }
    const { entries, skipped } = parseMacros(cfg.text)
    const nonBlank = cfg.text.split('\n').filter((l) => l.trim().length > 0).length
    const note = skipped.length
      ? `${entries.length} of ${nonBlank} non-blank lines parsed, ${skipped.length} skipped`
      : `${entries.length} of ${nonBlank} non-blank lines parsed`
    return { entries, note }
  } catch (e) {
    return { entries: [], note: String(e) }
  }
}
