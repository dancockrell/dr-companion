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

/**
 * What `resolveHighlights` needs of a stored rule.
 *
 * Structural rather than an import of `playerConfig.ts`'s `HighlightRule`, so
 * this module - which every rendered line runs through - keeps no dependency
 * on the store. `playerConfig.ts`'s types satisfy these by construction, and
 * `tsc` says so at the one call site.
 */
export interface HighlightPresetRule {
  id: string
  fg: string
}

export interface HighlightStoreRule {
  id: string
  enabled: boolean
  type: HighlightType
  pattern: string
  presetId?: string
  colour?: string
  sound?: string
  cls?: string
}

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
 * Lengths the prefix-derived probes are built at, ascending.
 *
 * 22 characters is below the knee. The pattern in #482 measured 0.7ms at 40
 * characters, 126ms at 50 and 21663ms at 60 on this machine, so a probe set
 * that stops at 22 is measuring the flat part of an exponential curve. The
 * steps are 10 apart rather than 20 because the growth factor over 20
 * characters was around 170x, and a guard that leaps that far can pay the very
 * cost it exists to avoid. `patternRefusal` runs *before* this loop for the
 * same reason: nothing carrying a nested quantifier ever reaches an 80
 * character probe.
 */
const PROBE_LENGTHS = [40, 50, 60, 70, 80]

/** `body` repeated and cut to exactly `n` characters. */
function repeatTo(body: string, n: number): string {
  return body.repeat(Math.ceil(n / body.length)).slice(0, n)
}

/**
 * Probe strings built from the pattern's own opening.
 *
 * Every string in `PROBES` is an unanchored body, so a pattern anchored to
 * text none of them contains fails at its first token on all sixteen,
 * measures ~0ms, and is admitted - and then backtracks catastrophically on the
 * real game line it was written for. That is #482, and the shape is an
 * ordinary loot highlight: `^You rummage (\w+\s?)+kronars$`.
 *
 * So the probe is derived from the candidate rather than from a fixed corpus.
 * `probePrefix` synthesises text satisfying the pattern's deterministic
 * opening, the pathological body follows it, and the quantifier is entered
 * instead of skipped. "A probe set that only fails one way only finds patterns
 * that fail that way" - the sentence the fixed probes were written under, one
 * level out: a probe set the candidate cannot reach finds nothing at all.
 */
function prefixProbes(pattern: string): string[] {
  const prefix = probePrefix(pattern)
  if (!prefix) return []
  const out: string[] = []
  for (const length of PROBE_LENGTHS) {
    for (const body of PROBE_BODIES) {
      for (const tail of PROBE_TAILS) {
        const room = length - prefix.length - tail.length
        // Below this there is not enough body left to backtrack through and
        // the probe measures the prefix rather than the quantifier.
        if (room < 8) continue
        out.push(prefix + repeatTo(body, room) + tail)
      }
    }
  }
  return out
}

/**
 * Run a compiled pattern against the probes and report the worst time.
 *
 * There is no way to interrupt a running regexp in JavaScript, so this cannot
 * be a timeout - it is a measurement taken once, on input short enough that
 * even a catastrophic pattern returns quickly, and the entry is refused on
 * what that measurement says. The alternative is discovering the cost on a
 * real game line, on the render thread, forever.
 */
function slowestProbeMs(re: RegExp, probes: readonly string[]): number {
  let worst = 0
  for (const probe of probes) {
    // A `g` pattern carries `lastIndex` from one exec to the next, so without
    // this the later probes start part-way in and measure less work than they
    // appear to.
    re.lastIndex = 0
    const t0 = performance.now()
    try {
      re.exec(probe)
    } catch {
      // A pattern that throws is the compile step's problem, not this one.
    }
    worst = Math.max(worst, performance.now() - t0)
    if (worst > PATTERN_BUDGET_MS) break
  }
  re.lastIndex = 0
  return worst
}

/* ------------------------------------------------------------------ *
 * The syntactic half of the guard.
 *
 * A measurement can only report what the input it was given happened to
 * cost, and #482 is the case where the input cannot reach the construct.
 * The structure can be read directly, so it is: a pattern is refused for
 * *what it is* before anything is timed, and the timing that follows is the
 * net for shapes this analyser does not name.
 *
 * The two constructs below are the whole of it, and they are the two ways a
 * backtracking engine turns a failing match into exponential work:
 *
 *   1. **A quantifier inside an unbounded-quantified group.** `(a+)+`,
 *      `(\w+\s?)+`, `(.*)*`, `(\s*\w+\s*)+`, `((\w|\s)+)+`. The same
 *      characters can be divided between the inner and outer repetition in
 *      2^n ways, and a failing tail makes the engine try all of them.
 *   2. **An unbounded-quantified group whose alternatives can start with the
 *      same character.** `(a|a)*`, `(a|ab)+`. Same arithmetic, reached
 *      through the alternation rather than through a second quantifier.
 *
 * Deliberately *not* refused: a quantified group with no inner quantifier and
 * disjoint branches (`(say|whisper)+`, `(\w|\s)+`), which is deterministic
 * and is what real rules are made of; and anything under a lookaround, which
 * is bounded by its own zero width. The false-positive rate over the real
 * corpora is measured rather than asserted - see
 * `docs/PLAYER_CONFIG.md` §2.4 and `tools/pattern-analyser-test.mjs`.
 *
 * When the parser meets syntax it does not model it returns null and the
 * analyser abstains, saying so rather than reporting "safe": the probes below
 * are then the only evidence, and that is a weaker claim than a clean parse.
 * ------------------------------------------------------------------ */

interface Quantifier {
  min: number
  max: number
}
interface PatternNode {
  kind: 'atom' | 'group' | 'anchor'
  /** Exactly the text this node was parsed from, so a refusal can quote it. */
  source: string
  /** Alternatives, for a group. One entry means no `|`. */
  alts: PatternNode[][]
  lookaround: boolean
  quant: Quantifier | null
}

/**
 * Enough of a regexp parser to answer the two questions above, and no more.
 *
 * Returns null for anything it does not model - `\p{...}`, `\u{...}`, a
 * backreference, an unbalanced group - rather than guessing, because a
 * mis-parse here would refuse a rule a player is entitled to write.
 */
function parsePattern(source: string): PatternNode[] | null {
  let i = 0

  const quantifier = (): Quantifier | null => {
    const c = source[i]
    let q: Quantifier | null = null
    if (c === '*') {
      q = { min: 0, max: Infinity }
      i++
    } else if (c === '+') {
      q = { min: 1, max: Infinity }
      i++
    } else if (c === '?') {
      q = { min: 0, max: 1 }
      i++
    } else if (c === '{') {
      const close = source.indexOf('}', i)
      if (close < 0) return null
      const body = source.slice(i + 1, close)
      const m = /^(\d+)(,(\d*)?)?$/.exec(body)
      // `{L}` after `\p` and friends is not a quantifier; the caller has
      // already refused those, so anything that fails here is a literal brace.
      if (!m) return null
      i = close + 1
      const min = Number(m[1])
      q = { min, max: m[2] === undefined ? min : m[3] ? Number(m[3]) : Infinity }
    }
    // A lazy or possessive marker changes which match is found, not how many
    // ways there are to look for it.
    if (q && (source[i] === '?' || source[i] === '+')) i++
    return q
  }

  const alternation = (): PatternNode[][] | null => {
    const alts: PatternNode[][] = []
    let seq: PatternNode[] = []
    while (i < source.length && source[i] !== ')') {
      if (source[i] === '|') {
        i++
        alts.push(seq)
        seq = []
        continue
      }
      const node = atom()
      if (!node) return null
      seq.push(node)
    }
    alts.push(seq)
    return alts
  }

  const atom = (): PatternNode | null => {
    const start = i
    const c = source[i]
    let kind: PatternNode['kind'] = 'atom'
    let alts: PatternNode[][] = []
    let lookaround = false

    if (c === '(') {
      i++
      kind = 'group'
      if (source[i] === '?') {
        const next = source[i + 1]
        if (next === ':') i += 2
        else if (next === '=' || next === '!') {
          lookaround = true
          i += 2
        } else if (next === '<' && (source[i + 2] === '=' || source[i + 2] === '!')) {
          lookaround = true
          i += 3
        } else if (next === '<') {
          const close = source.indexOf('>', i)
          if (close < 0) return null
          i = close + 1
        } else return null
      }
      const inner = alternation()
      if (!inner || source[i] !== ')') return null
      alts = inner
      i++
    } else if (c === '[') {
      i++
      if (source[i] === '^') i++
      if (source[i] === ']') i++
      while (i < source.length && source[i] !== ']') {
        if (source[i] === '\\') i++
        i++
      }
      if (source[i] !== ']') return null
      i++
    } else if (c === '\\') {
      const esc = source[i + 1]
      if (esc === undefined) return null
      // Not modelled: property escapes, code-point escapes, backreferences.
      if (esc === 'p' || esc === 'P' || esc === 'u' || esc === 'k' || /\d/.test(esc)) return null
      if ('bBAZzG'.includes(esc)) kind = 'anchor'
      i += 2
    } else if (c === '^' || c === '$') {
      kind = 'anchor'
      i++
    } else if (c === '*' || c === '+' || c === '?') {
      // A quantifier with nothing before it; `new RegExp` has already refused
      // this, so reaching here means the parser is out of step.
      return null
    } else {
      i++
    }

    const quant = quantifier()
    return { kind, source: source.slice(start, i), alts, lookaround, quant }
  }

  const parsed = alternation()
  if (!parsed || i !== source.length) return null
  // A top-level `|` is an alternation like any other, so it is wrapped rather
  // than flattened: flattening would let `probePrefix` splice two branches
  // into one string that matches neither.
  if (parsed.length === 1) return parsed[0]
  return [{ kind: 'group', source, alts: parsed, lookaround: false, quant: null }]
}

const unbounded = (q: Quantifier | null): boolean => q !== null && q.max === Infinity

/**
 * Why repeating this group's body can divide one string in more than one way,
 * or null.
 *
 * Star height on its own is the obvious rule and it is wrong, which is worth
 * writing down because that is what this was in its first version. Measured,
 * on this machine, with a plain `RegExp` and no module involved:
 *
 *   ([A-Za-z]+ )+\.               0.0ms at 60 characters
 *   (\w+\s+)+of the (\w+\s*)+$    1.6ms at 40, 16.4ms at 50, and climbing
 *                                 about tenfold every ten characters
 *
 * Both have a quantifier inside a quantified group. The first is safe: a
 * mandatory space separates the repetitions, so there is exactly one way to cut
 * `abcd abcd ` into iterations. The second is not - and it was sitting in
 * `highlight-test.mjs`'s own list of patterns that must be allowed to load,
 * which is how a star-height rule would have looked like a false positive when
 * it was telling the truth.
 *
 * So the test is ambiguity, not nesting, and two shapes produce it:
 *
 *   A. **The body ends in an optional part** while something in it repeats
 *      without limit - `(\w+\s?)+`, `(\s*\w+\s*)+`, `(.*\s?)+`, `(\w+\s*)+`.
 *      The body can stop early, so the next repetition picks up mid-token.
 *   B. **The body is one thing that already repeats without limit** -
 *      `(a+)+`, `(.*)*`, `((\w|\s)+)+`, `(\d+)+`. Repeating a repetition is
 *      ambiguous by construction.
 *
 * Neither fires on `([A-Za-z]+ )+` or `(\w+\s+)+`, whose last part is
 * mandatory. That is the whole difference, and it is the difference the two
 * measurements above are of.
 */
function ambiguousRepeat(alts: readonly PatternNode[][]): string | null {
  for (const seq of alts) {
    const parts = seq.filter((n) => n.kind !== 'anchor' && !n.lookaround)
    if (parts.length === 0) continue
    if (parts.length === 1 && unbounded(parts[0].quant)) {
      return 'repeats something that already repeats without limit'
    }
    const last = parts[parts.length - 1]
    if (parts.some((n) => unbounded(n.quant)) && last.quant !== null && last.quant.min === 0) {
      return (
        `repeats a group ending in the optional "${last.source}", so the same text ` +
        'divides between repetitions in more than one way'
      )
    }
  }
  return null
}

/**
 * Characters used to decide whether two alternatives can begin the same way.
 *
 * A representative of each class a real rule uses, so `\w` and `\d` are seen
 * to overlap while `\w` and `\s` are seen not to. Testing membership with the
 * engine itself rather than with a table of our own means the answer cannot
 * disagree with the regexp that will actually run.
 */
const FIRST_SET_ALPHABET = ['a', 'B', '5', ' ', '_', '-', '.', ',', "'", '!', '#', '\t']

function atomMatches(atomSource: string, ch: string): boolean {
  try {
    return new RegExp(`^(?:${atomSource})$`).test(ch)
  } catch {
    return false
  }
}

/** Which characters of `alphabet` this sequence can begin with. */
function firstSet(nodes: readonly PatternNode[], alphabet: readonly string[]): Set<string> {
  const out = new Set<string>()
  for (const n of nodes) {
    if (n.kind === 'anchor') continue
    if (n.kind === 'group') {
      for (const alt of n.alts) for (const ch of firstSet(alt, alphabet)) out.add(ch)
    } else {
      for (const ch of alphabet) if (atomMatches(n.source, ch)) out.add(ch)
    }
    // An optional atom does not consume, so the next one can start the match.
    if (n.quant && n.quant.min === 0) continue
    if (n.lookaround) continue
    break
  }
  return out
}

/**
 * Two alternatives of `alts` that can start with the same character, if any.
 *
 * The alphabet is `FIRST_SET_ALPHABET` plus every single character the
 * alternation itself mentions. Without that second half `(herb|herbs)+` came
 * back clean, because neither branch can start with any of the twelve
 * representatives - a check whose alphabet cannot contain the answer reports
 * "no overlap" for the same reason a suite that never ran reports no failures.
 * Found by this suite failing on the case it was written for.
 */
function overlappingBranches(alts: readonly PatternNode[][]): [string, string] | null {
  const mentioned = alts.flatMap((alt) => alt.flatMap((n) => [...n.source]))
  const alphabet = [...new Set([...FIRST_SET_ALPHABET, ...mentioned])]
  const sets = alts.map((alt) => ({
    text: alt.map((n) => n.source).join(''),
    set: firstSet(alt, alphabet),
  }))
  for (let a = 0; a < sets.length; a++) {
    for (let b = a + 1; b < sets.length; b++) {
      for (const ch of sets[a].set) {
        if (sets[b].set.has(ch)) return [sets[a].text, sets[b].text]
      }
    }
  }
  return null
}

function scan(nodes: readonly PatternNode[]): string | null {
  for (const n of nodes) {
    if (n.kind === 'group' && !n.lookaround && unbounded(n.quant)) {
      const ambiguous = ambiguousRepeat(n.alts)
      if (ambiguous) {
        return (
          `${n.source} ${ambiguous}. An ambiguous repetition can split the same characters ` +
          'between its repetitions in exponentially many ways, so a line that nearly matches ' +
          'backtracks through all of them and the game pane never paints again'
        )
      }
      if (n.alts.length > 1) {
        const clash = overlappingBranches(n.alts)
        if (clash) {
          return (
            `${n.source} repeats a group whose alternatives "${clash[0]}" and "${clash[1]}" ` +
            'can both start with the same character. A failing match tries every way of ' +
            'choosing between them, which is exponential in the length of the line'
          )
        }
      }
    }
    for (const alt of n.alts) {
      const why = scan(alt)
      if (why) return why
    }
  }
  return null
}

/**
 * Why this pattern is refused on its structure alone, or null.
 *
 * Three answers, not two, and the third is the point of having it: a sentence
 * (refused), null with `parsed: true` (read and found clean), and null with
 * `parsed: false` (not modelled - the timing below is the only evidence).
 * Folding the last two together would be this repo's rule 1 exactly: a check
 * that could not run reporting the same thing as a check that found nothing.
 */
export function patternRefusal(pattern: string): { why: string | null; parsed: boolean } {
  const nodes = parsePattern(pattern)
  if (!nodes) return { why: null, parsed: false }
  return { why: scan(nodes), parsed: true }
}

/** A wider sample than the first-set alphabet, for synthesising a prefix. */
const SAMPLE_CHARS = [
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  ...FIRST_SET_ALPHABET,
]

/**
 * Text satisfying the pattern's deterministic opening, or ''.
 *
 * Walks the parsed nodes from the front and synthesises one character per
 * fixed-width atom - a literal, an escape, a class, a `.` - stopping at the
 * first thing whose width is not fixed: a group, an unbounded or optional
 * quantifier, an alternation. That is the point at which the pattern stops
 * telling us what it wants and starts being the thing under test.
 *
 * `^You rummage (\w+\s?)+kronars$` yields `You rummage `, which is what makes
 * a probe reach the quantifier at all.
 *
 * Exported because it is the half of #482's fix that a check can assert
 * directly: "the probes got slower" is a claim about a timing, while "the
 * probe for this pattern begins `You rummage `" is a property, and a timing
 * on a shared machine is the wrong thing to hang a suite on.
 */
export function probePrefix(pattern: string): string {
  const nodes = parsePattern(pattern)
  if (!nodes) return ''
  let out = ''
  for (const n of nodes) {
    if (n.kind === 'anchor') {
      // `^` and `\b` are zero-width: they constrain where the match starts,
      // and a prefix built from what follows still satisfies them.
      continue
    }
    if (n.kind === 'group') break
    const repeats = n.quant === null ? 1 : n.quant.min === n.quant.max ? n.quant.min : 0
    if (repeats === 0) break
    // The atom's own text is tried first, so a literal `:` or an escaped `\[`
    // contributes itself rather than falling off the end of the sample and
    // truncating the prefix at the first punctuation mark. `atomMatches`
    // filters it, so `\d` proposing `d` costs nothing and `0` still wins.
    const literal = n.source.length === 1 ? n.source : n.source.length === 2 && n.source[0] === '\\' ? n.source[1] : null
    const ch = [...(literal === null ? [] : [literal]), ...SAMPLE_CHARS].find((c) =>
      atomMatches(n.source, c)
    )
    if (ch === undefined) break
    out += ch.repeat(repeats)
    if (out.length >= 32) break
  }
  return out
}

/**
 * The one gate a pattern passes before anything runs it.
 *
 * `parseHighlights` (a Genie file), `resolveHighlights` (the store) and the
 * editor's save all ask the same question - is this pattern safe to run once
 * per rendered line - and asking it three ways is how a rule refused at load
 * gets accepted at save and freezes the game pane anyway. So it is asked
 * once, here, and the callers differ only in what they do with the answer.
 *
 * Two states, and the second is the point: a pattern that compiles is not a
 * pattern that is safe to run, so a refusal carries the measured time rather
 * than a category. See PATTERN_BUDGET_MS.
 *
 * Two questions are asked in that second state, in this order and for this
 * reason. `patternRefusal` reads the structure, which is the only thing that
 * can catch a pattern no probe reaches (#482); the probes then time it,
 * including on strings built from its own opening, which is the net for a
 * shape the analyser does not model. Structure first is not a preference: an
 * 80-character probe of a nested quantifier would cost the twenty seconds
 * this whole gate exists to refuse, and the analyser is what guarantees no
 * such pattern ever reaches the loop.
 *
 * `lineRules.ts` is the fourth caller and the reason for `flags`: a substitute
 * replaces every occurrence, so it needs the same pattern with `g`. A second
 * compile there would be a second opinion about which patterns a player is
 * allowed to write, and two of them would eventually disagree.
 */
export function compilePattern(
  type: HighlightType,
  pattern: string,
  flags = ''
): { ok: true; re?: RegExp } | { ok: false; why: string } {
  if (!pattern) return { ok: false, why: 'empty pattern' }
  if (type !== 'regexp') return { ok: true }

  let re: RegExp
  try {
    // Compiled here, so a broken pattern is reported at load or at save
    // rather than failing silently on every line forever. Genie is .NET and
    // this is JavaScript; close enough for what these use, and a pattern that
    // fails to compile in either is certainly wrong.
    re = new RegExp(pattern, flags)
  } catch (e) {
    return { ok: false, why: (e as Error).message }
  }

  // Compiling is not the same as being safe to run. See PATTERN_BUDGET_MS.
  // The structure is read before anything is timed, so a pattern the probes
  // cannot reach is still refused, and so no probe ever runs a construct that
  // could take twenty seconds to answer.
  const structural = patternRefusal(pattern)
  if (structural.why) {
    return { ok: false, why: `${structural.why}, so it is not loaded` }
  }

  const probes = [...PROBES, ...prefixProbes(pattern)]
  const worst = slowestProbeMs(re, probes)
  if (worst > PATTERN_BUDGET_MS) {
    return {
      ok: false,
      why:
        `took ${worst.toFixed(0)}ms on a ${probes.length}-string probe set ` +
        '(a failing match backtracks exponentially); it would freeze the game pane, ' +
        'so it is not loaded',
    }
  }
  return { ok: true, re }
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

    // The same gate the store and the editor go through. See compilePattern.
    const compiled = compilePattern(entry.type, pattern)
    if (!compiled.ok) {
      skipped.push(`${line} - ${compiled.why}`)
      continue
    }
    if (compiled.re) entry.re = compiled.re

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

/**
 * Store rules to the runtime `Highlight[]` `paint()` already takes.
 *
 * The one resolver for this domain: preset ids resolved to colours, disabled
 * rules dropped, regexps compiled and probed by the same
 * `PATTERN_BUDGET_MS` guard `parseHighlights` uses, because a pattern that
 * freezes the game pane does so whether it arrived from a file or from a form.
 *
 * Refusals are returned rather than swallowed. A rule that names a preset the
 * player has since deleted renders in the default colour **and** appears in
 * `refused`, so the editor can say so beside the rule; dropping it silently is
 * what Genie does and is the failure this whole module declined to inherit.
 */
export function resolveHighlights(cfg: {
  highlights: readonly HighlightStoreRule[]
  presets: readonly HighlightPresetRule[]
}): { entries: Highlight[]; refused: Array<{ id: string; why: string }> } {
  const entries: Highlight[] = []
  const refused: Array<{ id: string; why: string }> = []
  const byId = new Map(cfg.presets.map((p) => [p.id, p]))

  cfg.highlights.forEach((rule, index) => {
    if (!rule.enabled) {
      refused.push({ id: rule.id, why: `"${rule.pattern}" is switched off` })
      return
    }

    let colour = rule.colour ?? ''
    if (rule.presetId) {
      const preset = byId.get(rule.presetId)
      if (preset) colour = preset.fg
      else {
        refused.push({
          id: rule.id,
          why: `names a preset that no longer exists (${rule.presetId}); shown in the default colour`,
        })
      }
    }

    const entry: Highlight = {
      type: rule.type,
      colour,
      pattern: rule.pattern,
      ...(rule.cls ? { cls: rule.cls } : {}),
      ...(rule.sound ? { sound: rule.sound } : {}),
      sourceLine: index,
    }

    const compiled = compilePattern(rule.type, rule.pattern)
    if (!compiled.ok) {
      refused.push({ id: rule.id, why: compiled.why })
      return
    }
    if (compiled.re) entry.re = compiled.re

    entries.push(entry)
  })

  return { entries, refused }
}

/**
 * What a new rule or preset gets before the player picks a colour.
 *
 * Here rather than in the tab that uses it because `tools/color-token-test.mjs`
 * ratchets raw colour literals in `src/components`, and rightly: a colour
 * typed into a component is a colour that can disagree with the same colour
 * typed into another one. This is not a theme token - it is a seed value for
 * the player's own data, which is why it is a constant in this module rather
 * than an entry in `src/index.css`.
 */
export const DEFAULT_HIGHLIGHT_COLOUR = '#66DDFF'

/**
 * `#rrggbb` if this value is one, otherwise null.
 *
 * A real `presets.cfg` holds CSS colour names as well as hex, and
 * `<input type="color">` accepts only the second. Three states collapsed to
 * two would mean showing a swatch that silently says black for `wheat`, so a
 * caller gets null and shows the text instead of a wrong colour.
 */
export function asHexColour(value: string): string | null {
  const v = value.trim()
  if (v.length !== 7 || v[0] !== '#') return null
  for (const ch of v.slice(1)) {
    const hex = '0123456789abcdefABCDEF'
    if (!hex.includes(ch)) return null
  }
  return v.toLowerCase()
}

/**
 * Every highlight that names this preset.
 *
 * The editor refuses to delete a preset while this is non-empty, and prints
 * the rules rather than the count alone: "3 highlights use it" is a fact the
 * player cannot act on, and going and finding them by hand is exactly the
 * work the message is supposed to save.
 *
 * `resolveHighlights` already survives a dangling reference - the rule renders
 * in the default colour and appears in `refused` - so this is not load-bearing
 * for correctness. It is load-bearing for not silently changing how seven
 * lines look because one preset went away.
 */
export function highlightsUsingPreset(
  presetId: string,
  highlights: readonly HighlightStoreRule[]
): HighlightStoreRule[] {
  return highlights.filter((h) => h.presetId === presetId)
}

/** How many recent game lines the editor's preview runs the rules over. */
export const HIGHLIGHT_PREVIEW_LINES = 200

/**
 * What the editor's preview shows when nothing is attached.
 *
 * Captured off the wire, not invented: text somebody assumed DragonRealms
 * looks like is how a GemStone mindstate ladder ended up in a DragonRealms
 * config once already.
 *
 * In this module rather than in the tab that renders it, for two reasons that
 * are the same reason. `tools/highlight-test.mjs` runs `paint()` over exactly
 * these strings and compares the result to what the browser put on screen, and
 * it cannot import a `.tsx` file to get them - a second copy in the test would
 * be a check that the test agrees with itself. And a `.tsx` exporting
 * constants beside a component breaks fast refresh, which the linter says out
 * loud.
 */
export const HIGHLIGHT_PREVIEW_SAMPLE: readonly string[] = [
  'Obvious paths: north, east, southwest.',
  'You notice as a black lynx pads into the area.',
  'Wipsy just arrived.',
  'You are bleeding from a wound in your left leg.',
  'GENIE HAS FLAGGED YOU AS IDLE, PLEASE RESPOND!',
  'You feel fully attuned to the mana streams again.',
]

/**
 * May this preset be deleted, and if not, exactly which rules stop it.
 *
 * Pure, and here rather than inside the tab, because the message is the
 * product. "3 highlights use it" is a fact the player cannot act on; going and
 * finding those three by hand is the work the refusal is supposed to save. A
 * message assembled inside a component is also a message no check can read,
 * and this one has a property worth asserting: the count and every rule.
 *
 * `resolveHighlights` already survives a dangling reference - the rule renders
 * in the default colour and appears in `refused` - so this is not load-bearing
 * for correctness. It is load-bearing for not silently changing how seven
 * lines look because one preset went away.
 */
export function refuseDeletingPreset(
  preset: { id: string; name: string },
  highlights: readonly HighlightStoreRule[]
): { ok: true } | { ok: false; why: string; users: HighlightStoreRule[] } {
  const users = highlightsUsingPreset(preset.id, highlights)
  if (users.length === 0) return { ok: true }
  return {
    ok: false,
    users,
    why:
      `"${preset.name}" is used by ${users.length} ` +
      `${users.length === 1 ? 'highlight' : 'highlights'}: ` +
      users.map((h) => `${h.type} "${h.pattern}"`).join(', ') +
      '. Point those at another preset first, or give them their own colour.',
  }
}
