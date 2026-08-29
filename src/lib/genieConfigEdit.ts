/**
 * Turning an edit into a text change Genie's own format can still read, and
 * nothing else in the file can tell happened.
 *
 * `highlights.ts`/`aliases.ts` are parse-and-discard: comments, section
 * headers, ordering and blank lines never survive into the parsed array, only
 * the entries that matched. That is fine for reading (the game pane never
 * needed the comments), and it is exactly wrong for writing - regenerating a
 * whole file from the parsed model would throw away every hand-written
 * rationale in `dr-genie-settings/Config/highlights.cfg`, which is most of
 * that file. So editing here never regenerates anything. It patches:
 *
 * - **Edit** replaces exactly the one line an entry's `sourceLine` points at.
 * - **Delete** removes exactly that line, nothing around it.
 * - **Add** appends under one clearly-labelled section at the end of the
 *   file, created once - so a player's own additions are visibly theirs,
 *   distinct from the curated entries above them, and never interleaved into
 *   a comment block that was explaining something else.
 *
 * Every other byte in the file - including every comment this project has
 * spent two days writing - passes through untouched.
 */

/** A file's own line-ending convention, detected rather than assumed, so
 * patching a CRLF checkout does not silently turn it into LF (which reads to
 * git as touching every line) or vice versa. */
export function detectEol(text: string): '\r\n' | '\n' {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

function splitLines(text: string): string[] {
  return text.split(/\r\n|\n/)
}

/** Genie's own field-delimiter. A value containing either brace would either
 * prematurely close its group or open a phantom one - the same corruption
 * class `dr-genie-settings/validate.mjs` was written to catch on the config
 * side. Checked before a line is ever built, not after, because a braces
 * check on the *output* line can't tell a legitimate closing brace from a
 * value that broke the format. */
export function hasUnsafeBraces(value: string): boolean {
  return value.includes('{') || value.includes('}')
}

export interface HighlightFields {
  type: string
  colour: string
  pattern: string
  cls?: string
  sound?: string
}

/**
 * `#highlight {type} {colour} {pattern} {class} {sound}`, with the trailing
 * groups present only as far as they need to be - a `sound` with no `cls`
 * still emits an empty `{}` for class, since sound is genuinely the fifth
 * positional group and skipping the fourth would shift it into the wrong
 * slot on the next parse. Every real entry in this project's own
 * `highlights.cfg` pairs a sound with a class, so that empty-class case is
 * defensive rather than something the corpus actually does.
 */
export function formatHighlightLine(h: HighlightFields): string {
  const groups = [h.type, h.colour, h.pattern]
  if (h.cls || h.sound) groups.push(h.cls ?? '')
  if (h.sound) groups.push(h.sound)
  return `#highlight ${groups.map((g) => `{${g}}`).join(' ')}`
}

export interface AliasFields {
  name: string
  expansion: string
}

/** `#alias {name} {expansion}` - always exactly two groups, Genie's own alias
 * syntax has no optional third. */
export function formatAliasLine(a: AliasFields): string {
  return `#alias {${a.name}} {${a.expansion}}`
}

export interface MacroFields {
  key: string
  modifiers: string[]
  command: string
}

/** `#macro {Key, Modifier1, Modifier2} {command}` - the modifier list is
 * comma-joined inside the same brace group as the key, never its own group;
 * every one of Dan's 95 real entries does it this way. */
export function formatMacroLine(m: MacroFields): string {
  const combo = [m.key, ...m.modifiers].join(', ')
  return `#macro {${combo}} {${m.command}}`
}

/**
 * Replace exactly one source line, leaving every other line - including
 * every comment - byte-identical.
 *
 * `lineIndex` must be a real index into `text`'s own lines (from a
 * `Highlight`/`Alias`'s `sourceLine`, parsed from this same `text`) - calling
 * this against a `text` the entry was not parsed from is a caller error, not
 * something this function can detect, since a line index is only meaningful
 * relative to the exact text it came from.
 */
export function replaceLine(text: string, lineIndex: number, newLine: string): string {
  const eol = detectEol(text)
  const lines = splitLines(text)
  if (lineIndex < 0 || lineIndex >= lines.length) {
    throw new Error(`line ${lineIndex} is out of range for a ${lines.length}-line file`)
  }
  lines[lineIndex] = newLine
  return lines.join(eol)
}

/** Remove exactly one source line. Same index contract as `replaceLine`. */
export function removeLine(text: string, lineIndex: number): string {
  const eol = detectEol(text)
  const lines = splitLines(text)
  if (lineIndex < 0 || lineIndex >= lines.length) {
    throw new Error(`line ${lineIndex} is out of range for a ${lines.length}-line file`)
  }
  lines.splice(lineIndex, 1)
  return lines.join(eol)
}

/**
 * The heading a player's own additions land under - created once, at the
 * bottom of the file, the first time this app ever adds an entry. Distinct
 * from every curated section heading in this project's own files (those use
 * `# ---` rule lines; this deliberately doesn't, so it's never mistaken for
 * one written by hand) and greppable on its own, so a future pass can find
 * every player-added entry without re-parsing the whole file.
 */
export const PLAYER_SECTION_MARKER = '# >>> Added in DR Companion - edit or remove freely <<<'

/**
 * Append a new directive line under the player-added section, creating that
 * section if this is the first addition. Pure append past whatever `text`
 * already contains - nothing above the marker is ever touched, so this is
 * safe to call no matter how the rest of the file is structured.
 */
export function appendUnderPlayerSection(text: string, newLine: string): string {
  const eol = detectEol(text)
  const hasMarker = text.split(/\r\n|\n/).some((l) => l.trim() === PLAYER_SECTION_MARKER)

  if (hasMarker) {
    const sep = text.endsWith('\n') || text.endsWith('\r\n') ? '' : eol
    return `${text}${sep}${newLine}${eol}`
  }

  const sep = text.length === 0 || text.endsWith('\n') || text.endsWith('\r\n') ? '' : eol
  const blankBefore = text.length === 0 ? '' : eol
  return `${text}${sep}${blankBefore}${PLAYER_SECTION_MARKER}${eol}${newLine}${eol}`
}

/**
 * Whether a `sourceLine` sits at or after the player-added marker - the
 * distinction a list view uses to show "yours" separately from "the ones
 * that shipped with this app". Recomputed from the live text rather than
 * cached on the entry, since a delete or an earlier add shifts every line
 * number after it.
 */
export function isPlayerAddedLine(text: string, lineIndex: number): boolean {
  const lines = splitLines(text)
  const markerAt = lines.findIndex((l) => l.trim() === PLAYER_SECTION_MARKER)
  return markerAt !== -1 && lineIndex > markerAt
}
