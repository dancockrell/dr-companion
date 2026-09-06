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
import { compilePattern, patternRefusal, probePrefix } from '../src/lib/highlights.ts'

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
 * `parsed: false` means the structure was not modelled and the timing is the
 * only evidence there is. Folding that into "clean" would be a check that
 * cannot fail reporting a pass it did not earn.
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
if (checked < 34) {
  console.log(`FAIL only ${checked} checks ran; this suite has never had fewer than 34`)
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
