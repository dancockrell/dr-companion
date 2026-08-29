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
  /**
   * 0-indexed line number this entry was parsed from, in the file text
   * `parseHighlights` was given. Lets an editor replace or remove exactly
   * this line without touching anything else in the file - comments,
   * section headers, other entries - the way regenerating the whole file
   * from the parsed array would. See `genieConfigEdit.ts`.
   */
  sourceLine: number
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
 * How long one pattern may take on a short probe string before it is refused.
 *
 * A compiled regexp says nothing about what it costs to run. `(\w+\s?)+$` is
 * a pattern somebody writes meaning "a run of words to the end of the line",
 * it compiles without complaint, and against one ordinary room description it
 * did not finish in thirty seconds. `paint()` runs per rendered line and
 * GamePane keeps 400 in the DOM, so that is not a slow client, it is a client
 * that never paints again.
 *
 * Catching it is possible because the cost is exponential in the input, so a
 * deliberately short probe separates the two populations by orders of
 * magnitude. Measured on `(a+)+$`: 4.7ms at 16 characters, 12.5 at 20, 40.7
 * at 22, 159 at 24, 2513 at 28. Every ordinary pattern in a real config runs
 * in well under a millisecond, so a budget of 20ms is not a close call in
 * either direction.
 */
const PATTERN_BUDGET_MS = 20

/**
 * Strings that make an ambiguous quantifier do its worst, kept short on
 * purpose - see PATTERN_BUDGET_MS.
 *
 * Backtracking is only expensive when the match *fails*: a pattern that
 * matches returns as soon as it succeeds. So each body is tried against
 * several terminators, because which one defeats a given pattern depends on
 * what it is anchored to.
 *
 * That is not theoretical tidiness. A first version of this ended every probe
 * with `!` and caught `(a+)+$` and `(\w+\s?)+$` but not `(\s*\w+\s*)+!` -
 * which matched the probes instantly and then hung for thirty seconds on a
 * real room description, because that one ends in a letter. A probe set that
 * only fails one way only finds patterns that fail that way.
 */
const PROBE_BODIES = [
  'a'.repeat(22),
  'ab '.repeat(7).trim(),
  'x1 y2 z3 w4 v5 u6 t7',
  // A digit run, because `(\d+)+$` passed every other probe: none of them
  // held enough consecutive digits to make it backtrack. Found by testing the
  // guard rather than by reading it.
  '1'.repeat(22),
]
const PROBE_TAILS = ['', '!', '.', '#']
const PROBES = PROBE_BODIES.flatMap((body) => PROBE_TAILS.map((tail) => body + tail))

/**
 * Run a compiled pattern against the probes and report the worst time.
 *
 * There is no way to interrupt a running regexp in JavaScript, so this cannot
 * be a timeout - it is a measurement taken once, on input short enough that
 * even a catastrophic pattern returns quickly, and the entry is refused on
 * what that measurement says. The alternative is discovering the cost on a
 * real game line, on the render thread, forever.
 */
function slowestProbeMs(re: RegExp): number {
  let worst = 0
  for (const probe of PROBES) {
    const t0 = performance.now()
    try {
      re.exec(probe)
    } catch {
      // A pattern that throws is the compile step's problem, not this one.
    }
    worst = Math.max(worst, performance.now() - t0)
    if (worst > PATTERN_BUDGET_MS) break
  }
  return worst
}

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

  const lines = text.split('\n')
  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo].trim()
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
      sourceLine: lineNo,
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

      // Compiling is not the same as being safe to run. See PATTERN_BUDGET_MS.
      const worst = slowestProbeMs(entry.re)
      if (worst > PATTERN_BUDGET_MS) {
        skipped.push(
          `${line} - pattern took ${worst.toFixed(0)}ms on a 22-character probe ` +
            '(nested quantifiers backtrack exponentially); it would freeze the game pane, ' +
            'so it is not loaded'
        )
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
