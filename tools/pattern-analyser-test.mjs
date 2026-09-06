/**
 * The pattern guard: what it refuses, what it must never refuse, and how it
 * knows.
 *
 *   node tools/pattern-analyser-test.mjs
 *
 * # The defect this exists for
 *
 * Issue #482. `compilePattern` timed a candidate against sixteen fixed probes,
 * every one an unanchored body, so a pattern with a literal anchor failed at
 * its first token on all sixteen in O(1), measured ~0ms, and was admitted -
 * then took 21.7 seconds on a 60-character prefix of the game line it was
 * written for. `^You rummage (\w+\s?)+kronars$` is not a contrived pattern; it
 * is a loot highlight.
 *
 * The guard now asks two questions in a fixed order, and this suite asserts
 * each of them separately because they fail in different ways:
 *
 *   - `patternRefusal` reads the structure. It can catch a pattern no probe
 *     reaches, which is the whole of #482, and it can be wrong by refusing
 *     something a player is entitled to write - so the false-positive rate is
 *     **measured against real configs**, not asserted.
 *   - `probePrefix` derives probe text from the candidate's own opening, so
 *     the timing half stops measuring strings the pattern rejects at once.
 *   - and when the parser cannot model the pattern at all it abstains, which
 *     is a third answer and not a pass. Issue #500: the abstain path had no
 *     coverage from the corpus - 0 of 467 real rules reach it - and it fell
 *     through to acceptance with an empty probe set. Section 3b is its
 *     fixture population, since the corpus cannot be one.
 *
 * # Why the corpus and not a fixture
 *
 * A fixture of patterns somebody wrote to pass this analyser proves the
 * analyser agrees with its author. The populations that matter are the ones
 * already on disk: `dr-genie-settings/Config/highlights.cfg`, which is the
 * corpus this project authored with its own validator behind it, and the live
 * Genie install's own files, which are what an import actually reads. Absent
 * corpora are NOT CHECKED with the path named, never a silent pass - a
 * false-positive rate of zero over zero rules is the same lie as a suite that
 * asserted nothing.
 *
 * Point it somewhere else with DRC_PATTERN_CORPUS (semicolon-separated), which
 * is also how the "no corpus" branch is executed on purpose rather than waited
 * for: `DRC_PATTERN_CORPUS=nowhere.cfg node tools/pattern-analyser-test.mjs`
 * must end on "not checked", never on "all passed".
 */
import { existsSync, readFileSync } from 'node:fs'
import { compilePattern, paint, patternRefusal, probePlan, probePrefix, resolveHighlights } from '../src/lib/highlights.ts'

let failed = 0
let checked = 0
const unchecked = []
const ok = (name, cond, detail = '') => {
  checked++
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(66)}${detail}`)
}
const skip = (name, why) => {
  unchecked.push(name)
  console.log(`SKIP ${name.padEnd(66)}${why}`)
}

/* ------------------------------------------------------------------ *
 * 1. The patterns that must be refused, and the construct each is refused for.
 *
 * The first three are the positive control from #482: they were already
 * caught, by timing, before any of this was written. If they ever stop being
 * refused the guard has been gutted and nothing below means anything. The rest
 * are the ones the fixed probes could not reach.
 * ------------------------------------------------------------------ */
console.log('-- the guard refuses a catastrophic pattern, and names the construct --')
const BAD = [
  ['(a+)+$', 'already repeats without limit'],
  ['((\\w|\\s)+)+$', 'already repeats without limit'],
  ['(.*)*$', 'already repeats without limit'],
  ['^(\\s*\\w+\\s*)+ZZZ$', 'ending in the optional'],
  ['^You see (.*\\s?)+X$', 'ending in the optional'],
  ['^You rummage (\\w+\\s?)+kronars$', 'ending in the optional'],
  ['^you rummage (\\w+\\s?)+dokoras$', 'ending in the optional'],
  // Measured at 1.6ms over 40 characters and 16.4ms over 50 with a plain
  // RegExp, climbing about tenfold per ten after that. It was in
  // `highlight-test.mjs`'s list of patterns that must be allowed to load.
  ['(\\w+\\s+)+of the (\\w+\\s*)+$', 'ending in the optional'],
  ['(a|a)*$', 'same character'],
  ['^You gather (herb|herbs)+ now$', 'same character'],
]
for (const [pattern, phrase] of BAD) {
  const t0 = performance.now()
  const verdict = compilePattern('regexp', pattern)
  const ms = performance.now() - t0
  ok(
    `refused: ${pattern}`,
    !verdict.ok && verdict.why.includes(phrase),
    verdict.ok ? 'ACCEPTED' : `${ms.toFixed(1)}ms, names "${phrase}"`
  )
  // The guard itself must not pay the cost it refuses. A structural refusal is
  // free; one that took a second would mean the analyser missed it and the
  // probes were left to discover it the expensive way.
  ok(`  and answers in under 200ms: ${pattern}`, ms < 200, `${ms.toFixed(1)}ms`)
}

/* ------------------------------------------------------------------ *
 * 2. The probe reaches the quantifier.
 *
 * A property, not a timing: on a machine running six lanes a millisecond
 * threshold is a coin toss, while "the probe for this pattern starts with the
 * text the pattern demands" is either true or it is not.
 * ------------------------------------------------------------------ */
/*
 * The floor, and it is the half that matters: a guard that refuses
 * everything would pass every case above while silently disabling
 * highlighting altogether, which looks exactly like a clean run.
 *
 * The first two are why this analyser tests ambiguity rather than star
 * height. Both nest a quantifier inside a quantified group and both are
 * safe, because a mandatory part separates the repetitions and there is
 * only one way to cut the text into iterations. Measured at 0.0ms over 60
 * characters with a plain RegExp.
 */
console.log('\n-- and refuses nothing that merely looks like it --')
const GOOD = [
  '([A-Za-z]+ )+\\.',
  '(\\w+\\s+)+arrives$',
  '(say|whisper|mutter)+',
  '(\\w|\\s)+$',
  '^You (say|whisper), \\"(.*)\\"$',
  '\\bkobold\\s+guard\\b',
  '^\\d+ of \\d+',
]
/*
 * A lookaround is *not* an exemption, though an early draft of this said so
 * and this case is what corrected it. `(?=(\\w+)+)` is zero width and its
 * contents still backtrack: a lookahead that fails does the same exponential
 * work as one that is not in a lookahead at all. So the scan descends into
 * lookarounds, and only skips them when deciding whether the *enclosing*
 * group's body is ambiguous, where a zero-width part cannot make it so.
 */
{
  const inside = compilePattern('regexp', '(?=(\\w+)+)ok')
  ok('a lookaround does not exempt what is inside it', inside.ok === false, inside.ok ? 'ACCEPTED' : inside.why.slice(0, 50))
}

for (const pattern of GOOD) {
  const verdict = compilePattern('regexp', pattern)
  ok(`still accepted: ${pattern}`, verdict.ok === true, verdict.ok ? '' : verdict.why.slice(0, 70))
}

console.log('\n-- probe text is derived from the pattern, so an anchor cannot dodge it --')
const PREFIXES = [
  ['^You rummage (\\w+\\s?)+kronars$', 'You rummage '],
  ['^You see ', 'You see '],
  ['^\\d\\d:\\d\\d (\\w+)', '00:00 '],
  ['^\\[(\\w+)\\]', '['],
  // Nothing deterministic to build from: the honest answer is '' rather than a
  // guess, and the fixed probes carry the pattern instead.
  ['(\\w+) says', ''],
  ['.*arrived', ''],
]
for (const [pattern, expected] of PREFIXES) {
  const got = probePrefix(pattern)
  ok(`prefix of ${pattern}`, got === expected, `${JSON.stringify(got)} (wanted ${JSON.stringify(expected)})`)
}

/* ------------------------------------------------------------------ *
 * 3. Three states from the analyser, not two.
 *
 * `parsed: false` means the structure was not modelled. Folding that into
 * "clean" would be a check that could not run reporting a pass it did not
 * earn - and until #500 the caller did exactly that, which is what 3b is for.
 * The three states are asserted here; what the caller does with the third is
 * asserted there.
 * ------------------------------------------------------------------ */
console.log('\n-- the analyser says refused, clean, or not modelled --')
ok('refused names a construct', patternRefusal('(a+)+').why !== null)
ok('clean is null with parsed true', patternRefusal('^You say, "\\w+"').why === null && patternRefusal('^You say, "\\w+"').parsed)
{
  // A property escape is real regexp syntax this parser does not model.
  const v = patternRefusal('^\\p{Lu}+ arrives$')
  ok('not modelled is null with parsed false', v.why === null && v.parsed === false, JSON.stringify(v))
}

/* ------------------------------------------------------------------ *
 * 3b. The abstain path, which had no coverage at all.
 *
 * Issue #500. The corpus below reports `0 not modelled` over 467 real rules,
 * so every check in this file ran past the branch where the analyser gives up
 * - and that branch fell straight through to acceptance. `compilePattern` read
 * `structural.why` and discarded `structural.parsed`; `probePrefix` bailed on
 * the same parse, so `prefixProbes` returned `[]`; and an anchored pattern was
 * then timed against sixteen unanchored bodies that fail at its first
 * character. Measured through the real `resolveHighlights` + `paint`,
 * `^You see (\w+)\s(\w+\s?)+\1$` was accepted in 0.1ms and then took 6ms on a
 * 31-character line, 396ms on 37, and was still running at 41 and at 45 when a
 * 5-second ceiling killed it - 103 seconds uncapped at 45, per the issue. This
 * suite never pays that: the pattern is refused on its structure, in 0ms.
 *
 * So the denominator here is `derived` - probes built from the candidate's own
 * opening - and not `probes.length`, which never drops below the sixteen fixed
 * bodies and would stay comfortingly large over a guard that had stopped
 * looking at the candidate at all. That is the number that goes to zero when
 * the mechanism breaks, and `pattern-analyser-break-check.mjs` breaks it.
 *
 * The two lists are the two answers an unmodelled pattern may get. It may
 * never get a third: accepted with nothing derived from it and nothing read.
 * ------------------------------------------------------------------ */
console.log('\n-- a pattern the analyser cannot model is probed or refused, never waved through --')

/*
 * Unmodelled and safe. Each must be accepted, and each must have been
 * *looked at*: either probes derived from its own opening, or - for an
 * unanchored pattern - the fixed bodies, which genuinely reach it.
 *
 * The lookahead is here because #500 named it. It turns out to be modelled
 * already (`atom` parses `(?=`, `scan` descends into it), and the row says so
 * rather than being quietly dropped: a fixture that passes for a different
 * reason than the one it was written for is worth one line to record.
 */
const UNMODELLED_OK = [
  ['(\\w+) \\1', 'backreference, unanchored: the fixed bodies reach it'],
  ['^You see (\\w+) \\1$', 'backreference, anchored: probes from its own opening'],
  ['^You see (?<x>\\w+) \\k<x>$', 'named backreference, anchored'],
  ['^You see \\p{Lu}\\w+ arrive$', 'property escape, inert without the u flag'],
  ['^You see \\u0041(\\w+)\\1$', 'code point escape plus a backreference'],
  ['^You see (?=\\w)(\\w+) arrive$', 'lookahead - modelled after all, and still probed'],
]
/*
 * Unmodelled and unsafe, one per refusal branch: widened and refused on its
 * structure (the first three), unresolvable (`\9` has no group 9), and
 * anchored with nothing to derive a probe from.
 */
const UNMODELLED_BAD = [
  ['^(\\w+\\s?)+\\1$', 'ending in the optional'],
  ['^You see (\\w+)\\s(\\w+\\s?)+\\1$', 'ending in the optional'],
  ['^You see (?<x>\\w+)\\s(\\w+\\s?)+\\k<x>$', 'ending in the optional'],
  ['^(\\w+) \\9$', 'cannot check for safety'],
  ['^(\\w+)\\1$', 'no probe can be built'],
]

let unmodelledSeen = 0
for (const [pattern, note] of UNMODELLED_OK) {
  const plan = probePlan(pattern)
  const t0 = performance.now()
  const verdict = compilePattern('regexp', pattern)
  const ms = performance.now() - t0
  if (!plan.modelled) unmodelledSeen += 1
  ok(
    `accepted: ${pattern}`,
    verdict.ok === true,
    verdict.ok
      ? `${plan.derived} derived of ${plan.probes.length} probes, ${ms.toFixed(1)}ms  (${note})`
      : verdict.why.slice(0, 70)
  )
  // The assertion #500 is actually about. Zero derived probes is the state the
  // old code admitted an anchored pattern in, so it may only be reached by a
  // pattern the fixed bodies do reach - an unanchored one.
  ok(
    `  and was probed, not waved through: ${pattern}`,
    plan.derived > 0 || !pattern.startsWith('^'),
    `${plan.derived} derived, ${plan.probes.length} total`
  )
}
for (const [pattern, phrase] of UNMODELLED_BAD) {
  const t0 = performance.now()
  const verdict = compilePattern('regexp', pattern)
  const ms = performance.now() - t0
  const plan = probePlan(pattern)
  if (!plan.modelled) unmodelledSeen += 1
  ok(
    `refused by name: ${pattern}`,
    !verdict.ok && verdict.why.includes(phrase),
    verdict.ok ? 'ACCEPTED' : `${ms.toFixed(1)}ms, names "${phrase}"`
  )
  // Refusing must stay cheaper than the freeze it prevents. #500's own pattern
  // is refused on structure, so this is 0ms; a regression that pushed it into
  // the probe loop would show up here long before a player felt it.
  ok(`  and cheaply: ${pattern}`, ms < 500, `${ms.toFixed(1)}ms`)
}
/*
 * The denominator, printed and asserted. `0 not modelled` is exactly what the
 * corpus says, and it is why this section exists; a fixture list that quietly
 * became all-modelled would be the same silence one level in.
 */
console.log(
  `     ${UNMODELLED_OK.length + UNMODELLED_BAD.length} unmodelled-path fixtures, ` +
    `${unmodelledSeen} of them reached the abstain path`
)
ok(
  'the abstain path has fixtures that reach it',
  unmodelledSeen >= 10,
  `${unmodelledSeen} reached it of ${UNMODELLED_OK.length + UNMODELLED_BAD.length}`
)

/*
 * And the outcome, not the verdict: an accepted pattern must actually paint.
 * `resolveHighlights` + `paint` is the pair GamePane runs per rendered line,
 * and it is what measured 103 seconds in the issue. A wide ceiling, because
 * this is a hang detector on a machine running six lanes and not a benchmark -
 * the same call measured 0ms accepted and over 5,000ms refused.
 */
{
  const rules = UNMODELLED_OK.map(([pattern], i) => ({
    id: `u${i}`,
    enabled: true,
    type: 'regexp',
    pattern,
    colour: '#66DDFF',
  }))
  const { entries } = resolveHighlights({ highlights: rules, presets: [] })
  const line = `You see zz ${'a'.repeat(34)}`
  const t0 = performance.now()
  paint(line, entries)
  const ms = performance.now() - t0
  ok(
    'and every accepted one paints a 45-character line at once',
    entries.length === rules.length && ms < 2000,
    `${entries.length} of ${rules.length} loaded, ${ms.toFixed(1)}ms`
  )
}

/* ------------------------------------------------------------------ *
 * 4. The false-positive rate, over real configs.
 * ------------------------------------------------------------------ */
console.log('\n-- every rule a real config already holds is still accepted --')
const CORPORA = (
  process.env.DRC_PATTERN_CORPUS ||
  [
    'C:/Users/Admin/dev/dr-genie-settings/Config/highlights.cfg',
    'C:/Users/Admin/AppData/Roaming/Genie Client 4/Config/highlights.cfg',
    'C:/Users/Admin/AppData/Roaming/Genie Client 4/Config/aliases.cfg',
    'C:/Users/Admin/AppData/Roaming/Genie Client 4/Config/gags.cfg',
    'C:/Users/Admin/AppData/Roaming/Genie Client 4/Config/substitutes.cfg',
    'C:/Users/Admin/AppData/Roaming/Genie Client 4/Config/triggers.cfg',
  ].join(';')
).split(';').filter(Boolean)

/** Every pattern-shaped field a Genie config line carries. */
function rulesIn(text) {
  const out = []
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t.startsWith('#')) continue
    const groups = [...t.matchAll(/\{([^}]*)\}/g)].map((m) => m[1])
    if (t.startsWith('#highlight') && groups.length >= 3) out.push(groups[2])
    else if (t.startsWith('#alias') && groups.length >= 1) out.push(groups[0])
    else if (/^#(gag|subs|trigger)/.test(t) && groups.length >= 1) out.push(groups[0])
  }
  return out.filter(Boolean)
}

let analysed = 0
let found = 0
let refusedReal = 0
let notModelled = 0
const offenders = []
for (const path of CORPORA) {
  if (!existsSync(path)) {
    skip(`corpus ${path}`, 'no file there; its rules were not analysed')
    continue
  }
  const text = readFileSync(path, 'utf8')
  const rules = rulesIn(text)
  // Three states again, and the middle one is real: a config a player simply
  // has no entries in (Dan keeps no gags) is not the same thing as a config
  // full of entries this reader extracted nothing from, which is a broken
  // parser reporting a clean sweep.
  const directives = text.split('\n').filter((l) => l.trim().startsWith('#')).length
  if (directives === 0) {
    // Determinate, so it is a note rather than a skip. "This config holds no
    // entries" is an answer; "this config is not on this machine" is the
    // absence of one, and only the second belongs in the not-checked list. A
    // warning list that cries wolf on every run is one nobody reads on the day
    // it has something to say.
    console.log(`     - ${path} is there and holds no entries`)
    continue
  }
  found += 1
  let localRefused = 0
  for (const pattern of rules) {
    analysed += 1
    const verdict = patternRefusal(pattern)
    if (verdict.why) {
      refusedReal += 1
      localRefused += 1
      offenders.push(`${path}: ${JSON.stringify(pattern)} -> ${verdict.why}`)
    }
    if (!verdict.parsed) notModelled += 1
  }
  // Per file, and the count is half the assertion. A config that was found and
  // read as zero rules - a moved file, a changed comment character, a parser
  // that stopped understanding the format - refuses nothing for exactly the
  // reason an empty suite fails nothing, and would otherwise read as a pass.
  ok(
    `${path.split('/').pop()}: rules read and none refused`,
    rules.length > 0 && localRefused === 0,
    `${directives} directives, ${rules.length} rules, ${localRefused} refused`
  )
}
for (const o of offenders) console.log(`     ! ${o}`)
console.log(`     ${analysed} real rules analysed across ${found} configs, ${refusedReal} refused, ${notModelled} not modelled`)

/*
 * The aggregate. Named as its own check rather than left implicit in the
 * per-file lines, because this is the number #482's fix is judged on: how many
 * rules a real player already has would this analyser take away.
 *
 * A machine with none of these configs gets a skip carrying the reason, not a
 * pass - a false-positive rate of zero over zero rules establishes nothing,
 * and `run-tests.mjs` refuses to end on "all passed" over a skip.
 */
if (found === 0) {
  skip('the false-positive rate over real rules', `none of the ${CORPORA.length} configs is on this machine`)
} else {
  ok('no real rule is refused by the analyser', refusedReal === 0, `${refusedReal} of ${analysed}`)
}

console.log(`\n${checked} checked, ${failed} failed`)
if (checked < 60) {
  console.log(`FAIL only ${checked} checks ran; this suite has never had fewer than 60`)
  process.exit(1)
}
console.log(
  failed
    ? `\n${failed} failed`
    : unchecked.length
      ? `\nno failures, but ${unchecked.length} not checked: ${unchecked.join(', ')}`
      : '\nall passed'
)
process.exit(failed ? 1 : 0)
