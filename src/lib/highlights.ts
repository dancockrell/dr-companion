/**
 * Highlights and sounds, native, reading Genie's own config format.
 *
 * The game pane was plain grey text, and Genie's is not. This is the piece
 * that makes the client worth switching to rather than merely equivalent: it
 * runs the corpus in `dr-genie-settings` - 53 entries, every one written
 * against text observed on the wire, with a validator and a negative-test
 * suite behind it - and it does it without Genie.
 *
 * # Why the Genie format rather than a better one
 *
 * A format of our own would be tidier and would strand everybody. Players have
 * years of `#highlight` lines, and the corpus this project already authored is
 * in that syntax with tests asserting its contents. Reading what people
 * already have is the difference between a client somebody can try on a
 * Tuesday and one that asks them to retype their config first.
 *
 *     #highlight {type} {colour} {pattern} {class} {sound}
 *
 * `type` is one of line, string, beginswith, regexp. `class` is a group that
 * can be switched off. `sound` is a filename.
 *
 * # What `string` means, and why it is not the same as `line`
 *
 * `line` colours the whole line; `string` colours only the matched text. That
 * distinction is most of what makes a real config look right: an arrival is a
 * whole coloured line because the event is the line, while a creature name
 * inside a sentence should be the only thing lit up, with the sentence around
 * it left alone.
 *
 * # Order
 *
 * First match wins for the line colour, so an earlier entry can take
 * precedence over a later one - which is how a config expresses "this specific
 * case, then the general one". Substring matches all apply, because two
 * different things inside one line can both be worth seeing.
 */

export type HighlightType = 'line' | 'string' | 'beginswith' | 'regexp'

export interface Highlight {
  type: HighlightType
  colour: string
  pattern: string
  cls?: string
  sound?: string
  /** Compiled once. A regexp recompiled per line per entry is the whole cost. */
  re?: RegExp
}

/** A stretch of a line that got its own colour. */
export interface Span {
  start: number
  end: number
  colour: string
}

export interface Painted {
  /** Colour for the whole line, if any entry claimed it. */
  lineColour?: string
  /** Substring highlights, sorted and non-overlapping. */
  spans: Span[]
  /** Sounds to play, de-duplicated, in config order. */
  sounds: string[]
  /** Which entries matched. Kept so a config can be debugged against real text. */
  matched: Highlight[]
}

const TYPES = new Set<HighlightType>(['line', 'string', 'beginswith', 'regexp'])

/**
 * Parse a Genie config.
 *
 * Skips what it does not understand rather than throwing, because that is what
 * Genie does and a client that refuses to start over one bad line in a
 * thousand-line config is a client people go back from. But it counts the
 * skips and hands them back: Genie's silence about malformed entries is
 * exactly the failure `dr-genie-settings/validate.mjs` exists to catch, and
 * repeating it here would be inheriting the bug along with the format.
 */
export function parseHighlights(text: string): { entries: Highlight[]; skipped: string[] } {
  const entries: Highlight[] = []
  const skipped: string[] = []

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line.startsWith('#highlight')) continue

    const groups = [...line.matchAll(/\{([^}]*)\}/g)].map((m) => m[1])
    if (groups.length < 3 || groups.length > 5) {
      skipped.push(`${line} - ${groups.length} groups, expected 3 to 5`)
      continue
    }

    const [type, colour, pattern, cls, sound] = groups
    if (!TYPES.has(type as HighlightType)) {
      skipped.push(`${line} - unknown type "${type}"`)
      continue
    }
    if (!/^#[0-9A-Fa-f]{6}$/.test(colour)) {
      skipped.push(`${line} - "${colour}" is not a colour`)
      continue
    }
    if (!pattern) {
      skipped.push(`${line} - empty pattern`)
      continue
    }

    const entry: Highlight = {
      type: type as HighlightType,
      colour,
      pattern,
      cls: cls || undefined,
      sound: sound || undefined,
    }

    if (type === 'regexp') {
      try {
        // Compiled once, here, so a broken pattern is reported at load rather
        // than failing silently on every line forever. Genie is .NET and this
        // is JavaScript; close enough for what these use, and a pattern that
        // fails to compile in either is certainly wrong.
        entry.re = new RegExp(pattern)
      } catch (e) {
        skipped.push(`${line} - ${(e as Error).message}`)
        continue
      }
    }

    entries.push(entry)
  }

  return { entries, skipped }
}

function matchOf(h: Highlight, line: string): { start: number; end: number } | null {
  switch (h.type) {
    case 'beginswith': {
      // Leading whitespace is layout, not content. The experience window
      // indents every row, and a `beginswith` that failed on those would be a
      // rule nobody could make work.
      const trimmed = line.trimStart()
      if (!trimmed.startsWith(h.pattern)) return null
      const offset = line.length - trimmed.length
      return { start: offset, end: offset + h.pattern.length }
    }
    case 'regexp': {
      const m = h.re?.exec(line)
      if (!m) return null
      return { start: m.index, end: m.index + m[0].length }
    }
    case 'line':
    case 'string': {
      const i = line.indexOf(h.pattern)
      if (i < 0) return null
      return { start: i, end: i + h.pattern.length }
    }
  }
}

/**
 * Work out what a line should look like.
 *
 * `off` is the set of classes switched off, so `#class people off` behaves the
 * way it does in Genie. Passed in rather than held here because it is UI state
 * and this file should stay a pure function of its inputs - which is also what
 * makes it testable without a game.
 */
export function paint(
  line: string,
  entries: Highlight[],
  off: ReadonlySet<string> = new Set()
): Painted {
  const out: Painted = { spans: [], sounds: [], matched: [] }

  for (const h of entries) {
    if (h.cls && off.has(h.cls)) continue

    const hit = matchOf(h, line)
    if (!hit) continue

    out.matched.push(h)

    if (h.type === 'string') {
      out.spans.push({ start: hit.start, end: hit.end, colour: h.colour })
    } else if (out.lineColour === undefined) {
      // First wins, so a config can put the specific case before the general.
      out.lineColour = h.colour
    }

    if (h.sound && !out.sounds.includes(h.sound)) out.sounds.push(h.sound)
  }

  // Overlaps have to go, or the renderer produces nested or crossing spans and
  // the text comes out duplicated. Earlier entries win, which matches the
  // first-wins rule above.
  out.spans.sort((a, b) => a.start - b.start || b.end - a.end)
  const kept: Span[] = []
  let reach = -1
  for (const s of out.spans) {
    if (s.start >= reach) {
      kept.push(s)
      reach = s.end
    }
  }
  out.spans = kept

  return out
}

/**
 * Cut a line into coloured pieces, ready to render.
 *
 * Returns the whole line as one piece when nothing matched, so the common case
 * - most lines, most of the time - costs one array entry and no work.
 */
export function segments(line: string, p: Painted): Array<{ text: string; colour?: string }> {
  if (!p.spans.length) return [{ text: line, colour: p.lineColour }]

  const out: Array<{ text: string; colour?: string }> = []
  let at = 0
  for (const s of p.spans) {
    if (s.start > at) out.push({ text: line.slice(at, s.start), colour: p.lineColour })
    out.push({ text: line.slice(s.start, s.end), colour: s.colour })
    at = s.end
  }
  if (at < line.length) out.push({ text: line.slice(at), colour: p.lineColour })
  return out
}
