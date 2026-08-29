/**
 * Genie's `#var` variables, read-only.
 *
 *     #var {name} {value}
 *
 * Read Dan's real `Config/variables.cfg` (46 entries) to get this shape.
 * Deliberately no write path, unlike highlights/aliases/macros: most of what
 * lives in this file is Genie's own bookkeeping, not player configuration -
 * `roomid`, `downid`, `Time.timeOfDay` and the rest of the `Time.*` block are
 * written by Genie while it plays, not settings a person would tune by hand.
 * A handful (`ExpTracker.*`) look like genuine preferences, but the file
 * gives no structural way to tell the two kinds apart, and offering an editor
 * that can just as easily corrupt Genie's live room-tracking state as tweak a
 * preference is a worse trade than not offering one. This reads, for the
 * alias/macro previews to resolve `$name` against and for a searchable
 * inspector - something Genie itself has no equivalent of - and stops there.
 */
import { invokeTauri, isTauri } from './tauri.ts'

export interface Variable {
  name: string
  value: string
  sourceLine: number
}

/**
 * Parse a Genie variables config.
 *
 * Same tolerance as the other parsers here: skip what does not parse, count
 * the skips, hand them back.
 */
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

export interface VariableConfig {
  entries: Variable[]
  note: string
}

/** Read and parse `Config/variables.cfg`, same shape as `loadAliasConfig`. */
export async function loadVariableConfig(): Promise<VariableConfig> {
  if (!isTauri()) {
    return { entries: [], note: 'No variables in a browser: the config lives beside Genie.' }
  }
  try {
    const cfg = (await invokeTauri('read_genie_config', { leaf: 'variables.cfg' })) as {
      found: boolean
      text: string
      note: string
    }
    if (!cfg.found) {
      return { entries: [], note: cfg.note }
    }
    const { entries, skipped } = parseVariables(cfg.text)
    const nonBlank = cfg.text.split('\n').filter((l) => l.trim().length > 0).length
    const note = skipped.length
      ? `${entries.length} of ${nonBlank} non-blank lines parsed, ${skipped.length} skipped`
      : `${entries.length} of ${nonBlank} non-blank lines parsed`
    return { entries, note }
  } catch (e) {
    return { entries: [], note: String(e) }
  }
}

/**
 * Every `$name` token in `text`, in order of first appearance, de-duplicated.
 * Used to resolve variable references in an alias expansion or a macro
 * command against the live table, for a preview - never to decide what
 * actually gets sent, which stays exactly what the player typed or configured.
 *
 * Deliberately excludes `$0`/`$1`/... - those are alias positional
 * arguments (see `expandAlias`), a different substitution this app already
 * performs, not a Genie variable to look up.
 */
export function referencedVariables(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of text.matchAll(/\$([A-Za-z][A-Za-z0-9_.]*)/g)) {
    const name = m[1]
    if (!seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  return out
}
