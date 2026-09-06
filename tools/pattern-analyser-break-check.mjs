/**
 * Sabotage the pattern guard and prove `tools/pattern-analyser-test.mjs`
 * notices, one break at a time.
 *
 *   node tools/pattern-analyser-break-check.mjs
 *
 * # What this is for beyond the usual
 *
 * The ordinary reason first: "I broke it and the test caught it" is a claim
 * and this is the command, and a check that quietly stops working stays green
 * until the day it was needed. Same four rules as
 * `player-config-transfer-break-check.mjs`, whose shape this follows: a
 * sabotage that changes nothing aborts naming the reason, a red count of zero
 * is a failure of the sabotage rather than a success of the test, the named
 * checks must actually appear, and the file is restored and its md5 compared.
 *
 * The reason particular to #482 is the first case below. The fix has two
 * halves - a structural analyser and probes derived from the pattern's own
 * opening - and the analyser runs first, so on an unsabotaged tree the probes
 * never get to answer for a nested quantifier and their contribution is
 * invisible. `the analyser is switched off` is the only way to ask whether the
 * second half is a live net or decoration: with `patternRefusal` returning
 * "clean" for everything, `^You rummage (\w+\s?)+kronars$` must still be
 * refused, by timing, and the suite must stay green. That is the check that
 * the belt works after cutting the braces.
 *
 * It is also why the case list is not all "expect red". A sabotage whose
 * correct outcome is that nothing changes has to say so, or the next reader
 * deletes the half of the fix it is protecting.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const SUITE = 'tools/pattern-analyser-test.mjs'
const CR = String.fromCharCode(13)

const md5 = (path) => createHash('md5').update(readFileSync(path)).digest('hex')

function run() {
  const r = spawnSync(process.execPath, [SUITE], { encoding: 'utf8' })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const reds = out
    .split('\n')
    .filter((l) => l.startsWith('FAIL'))
    .map((l) => l.slice(4).trim())
  // From `status` directly: a null status is a killed or unstartable process,
  // which is not a zero.
  return { code: r.status === null ? -1 : r.status, reds, out }
}

const FILE = 'src/lib/highlights.ts'

const CASES = [
  {
    label: 'the analyser is switched off, leaving only the probes',
    file: FILE,
    find: '  const structural = patternRefusal(pattern)',
    replace: "  const structural = { why: null, parsed: true } as ReturnType<typeof patternRefusal>",
    /*
     * Measured rather than predicted, and the prediction was wrong, which is
     * the reason this case is written the way it is.
     *
     * The first version asserted that the suite would stay green with the
     * analyser gone - that the probes alone would hold the line. Run, it went
     * red on `(.*)*$` and `^You gather (herb|herbs)+ now$`, which the probes
     * accept outright, and `^You see (.*\s?)+X$` was refused only after the
     * probe loop itself spent **76.3 seconds** inside one `exec`. So:
     *
     *   - the prefix-derived probes are a real net, and they catch #482's own
     *     pattern (42.9ms) that the old fixed probes measured at 0ms;
     *   - and they are not a substitute for the analyser, in both directions:
     *     they miss patterns it catches, and reaching the ones they do catch
     *     can cost more than the freeze being prevented.
     *
     * That is the argument for structure-first, and it is now a command
     * rather than a paragraph. The suite is deliberately NOT run under this
     * mutation - a 76-second stage in the gate would be paid by every lane
     * forever - so the claim is made with targeted probes instead, each in its
     * own process, each fast.
     */
    targeted: [
      ['^You rummage (\\w+\\s?)+kronars$', false, 'the probes still refuse #482 with the analyser gone'],
      ['(.*)*$', true, 'and the probes alone accept (.*)*$ - the analyser is not optional'],
      ['^You gather (herb|herbs)+ now$', true, 'and accept an overlapping alternation too'],
    ],
  },
  {
    label: 'the probes go back to the fixed 22-character set',
    file: FILE,
    find: '  const derived = prefixProbes(source)',
    replace: '  const derived = []',
    /*
     * This case used to be `expectGreen`, and the note said so: nothing
     * reddened, because the analyser caught every pattern in the suite before
     * the probes were consulted, and recording that was how the suite said
     * which half of the fix was holding.
     *
     * #500 changed what is true, not what is asserted, so the prediction is
     * rewritten rather than the code. For a pattern the analyser *cannot*
     * model, the derived probes are no longer a second opinion - they are the
     * only measurement there is, and a refusal is what the absence of one now
     * means. So gutting them stops being invisible: every unmodelled-and-
     * anchored fixture in section 3b is refused for having nothing to be
     * timed against, and the suite says which.
     *
     * The old fact is still recorded, one case up: with `patternRefusal`
     * switched off the probes alone accept `(.*)*$`. They are a net under the
     * analyser, not a replacement for it.
     */
    expect: [
      'accepted: ^You see (\\w+) \\1$',
      'accepted: ^You see \\p{Lu}\\w+ arrive$',
      'and every accepted one paints',
    ],
  },
  {
    /*
     * #500. The defect was not a wrong answer, it was a *third* answer read as
     * the second: `patternRefusal` says "not modelled", and the caller took the
     * same branch it takes for "read and found clean". Forcing that branch back
     * on is exactly the old code, and what it costs is visible in the count -
     * an anchored unmodelled pattern derives no probes from itself, so it is
     * timed against sixteen unanchored bodies that fail at its first character
     * and admitted in 0.1ms. The suite must name the fixtures that happens to.
     */
    label: 'abstaining falls through to acceptance again',
    file: FILE,
    find: '  if (structural.parsed) {',
    replace: '  if (true) {',
    expect: [
      'and was probed, not waved through: ^You see (\\w+) \\1$',
      'refused by name: ^You see (\\w+)\\s(\\w+\\s?)+\\1$',
      'refused by name: ^(\\w+)\\1$',
    ],
  },
  {
    /*
     * And the half of the fix that is not the branch: with the widening gone,
     * a backreference cannot be rewritten into anything this parser reads, so
     * every unmodelled pattern is refused - including the safe ones. A guard
     * that refuses everything passes every "must be refused" case in the suite
     * while taking highlighting away, so the fixtures that must be *accepted*
     * are the ones that catch it.
     */
    label: 'the widening stops rewriting what it cannot model',
    file: FILE,
    find: '    const step = rewriteUnmodelled(source, flags)',
    replace: '    const step = round >= 0 ? null : rewriteUnmodelled(source, flags)',
    expect: ['accepted: ^You see (\\w+) \\1$', 'accepted: (\\w+) \\1'],
  },
  {
    label: 'ambiguous repetitions stop being refused',
    file: FILE,
    find: '      const ambiguous = ambiguousRepeat(n.alts)',
    replace: '      const ambiguous = null && ambiguousRepeat(n.alts)',
    expect: ['refused: (a+)+$', 'refused: ^You see', 'refused: (\\w+\\s+)+of the'],
  },
  {
    label: 'overlapping alternatives stop being refused',
    file: FILE,
    find: '      if (n.alts.length > 1) {',
    replace: '      if (false && n.alts.length > 1) {',
    expect: ['refused: (a|a)*$', 'refused: ^You gather'],
  },
  {
    label: 'the prefix synthesiser stops reading the pattern',
    file: FILE,
    find: '  const nodes = parsePattern(pattern)\n  if (!nodes) return \'\'',
    replace: "  const nodes = parsePattern(pattern)\n  if (nodes) return ''\n  if (!nodes) return ''",
    expect: ['prefix of ^You rummage', 'prefix of ^You see'],
  },
  {
    label: 'the analyser claims to have parsed what it could not',
    file: FILE,
    find: '  if (!nodes) return { why: null, parsed: false }',
    replace: '  if (!nodes) return { why: null, parsed: true }',
    expect: ['not modelled'],
  },
]

let bad = 0
let checked = 0
const note = (s) => console.log(s)
const ok = (name, cond, detail = '') => {
  checked += 1
  if (!cond) bad += 1
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(64)}${detail}`)
}

{
  const { code, reds, out } = run()
  if (code !== 0 || reds.length > 0) console.log(out.slice(-2000))
  ok('the suite is green before any sabotage', code === 0 && reds.length === 0, `exit ${code}, ${reds.length} red`)
  if (code !== 0 || reds.length > 0) process.exit(1)
}

for (const c of CASES) {
  const before = md5(c.file)
  const original = readFileSync(c.file, 'utf8')
  // Line endings normalised before matching: this repo checks out CRLF, so an
  // anchor written with plain newlines matches a file a session just wrote and
  // stops matching the moment git has touched it.
  const lf = original.split(CR).join('')
  const hits = lf.split(c.find).length - 1
  note(`\n== ${c.label} (${c.file})`)
  ok(`  its anchor is in ${c.file} exactly once`, hits === 1, `${hits} match(es); nothing was changed`)
  if (hits !== 1) continue
  const mutated = lf.split(c.find).join(c.replace)
  const restore = () => writeFileSync(c.file, original)
  writeFileSync(c.file, original.includes(CR) ? mutated.split('\n').join(`${CR}\n`) : mutated)

  let result = null
  const answers = []
  try {
    if (c.targeted) {
      // Asked of the sabotaged tree, each in its own process because the
      // module is already cached in this one, and one at a time so a pattern
      // that hangs names itself instead of taking the batch down with it.
      for (const [pattern] of c.targeted) {
        const probe = spawnSync(
          process.execPath,
          [
            '--input-type=module',
            '-e',
            `const { compilePattern } = await import('./src/lib/highlights.ts');` +
              `console.log(JSON.stringify(compilePattern('regexp', ${JSON.stringify(pattern)}).ok));`,
          ],
          { encoding: 'utf8', timeout: 60000 }
        )
        answers.push(`${probe.stdout ?? ''}`.trim().split('\n').pop())
      }
    } else {
      result = run()
    }
  } finally {
    restore()
  }
  const after = md5(c.file)
  ok('  the file is restored byte for byte', before === after, `md5 ${before} before, ${after} after`)

  if (c.targeted) {
    c.targeted.forEach(([, accepted, why], i) => {
      // `undefined` here means the probe never answered - a hang or a crash -
      // and that is neither an accept nor a refusal. Compared against the
      // string, so it cannot pass by being falsy.
      ok(`  ${why}`, answers[i] === JSON.stringify(accepted), `compilePattern ok: ${answers[i]}`)
    })
    continue
  }

  for (const r of result.reds) note(`     - ${r.slice(0, 96)}`)

  if (c.expectGreen) {
    // A sabotage whose correct outcome is "nothing changed" is still an
    // assertion, and it is the one that says which half of the fix is holding.
    ok('  the suite stays green, as this case predicts', result.code === 0 && result.reds.length === 0, `exit ${result.code}, ${result.reds.length} red`)
    continue
  }

  ok('  the suite went red rather than merely crashing', result.reds.length > 0, `exit ${result.code}, ${result.reds.length} reddened`)
  if (result.reds.length === 0) continue
  const joined = result.reds.join(' | ').toLowerCase()
  const missing = c.expect.filter((w) => !joined.includes(w.toLowerCase()))
  ok('  and it reddened the checks that name the property', missing.length === 0, missing.length ? `did not name: ${missing.join(', ')}` : `${result.reds.length} red`)
}

console.log('')
{
  const { code, reds } = run()
  ok('every file is back and the suite is green again', code === 0 && reds.length === 0, `exit ${code}, ${reds.length} red`)
}

console.log(`\n${CASES.length} sabotages, ${checked} checked, ${bad} failed`)
if (CASES.length < 8 || checked < 24) {
  console.log(`FAIL ${CASES.length} sabotages and ${checked} checks; this file has never had fewer than 8 and 24`)
  process.exit(1)
}
process.exit(bad ? 1 : 0)
