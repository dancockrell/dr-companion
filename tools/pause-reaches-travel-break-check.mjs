/**
 * Break the bridge's Pause latch on purpose and watch the checks catch it.
 *
 * `tools/pause-reaches-travel-test.mjs` and `lich-scripts/test/pause_test.rb`
 * both print green today. A suite that never ran, a suite whose assertions
 * cannot fail, and a suite that is right print identically, and the only way to
 * tell them apart is to make the thing they watch actually wrong.
 *
 * Three sabotages, each aimed at one link of the chain #462 exposed:
 *
 *   1. `map_walk` stops consulting the latch  - a tile click walks while paused
 *   2. `pause_all` stops setting it           - nothing is ever latched
 *   3. `resume_all` stops clearing it         - Pause becomes a one-way door
 *
 * # What this file is careful about
 *
 * **A green run first.** The unmodified file must pass both suites, or a red
 * result later could be this harness mangling the file rather than the
 * sabotage landing.
 *
 * **A sabotage that changes nothing must abort, not pass.** A fragment that
 * stops matching - a rename, a reflow - would rewrite the file unchanged, the
 * suites would pass, and the output would read exactly like proof. So every
 * fragment must be present exactly once before anything is written, and the
 * damaged bytes must differ from the original.
 *
 * **Each case names what should go red, and what should not.** A sabotage that
 * reddens more than it should means the checks are entangled and each is saying
 * less than it appears to.
 *
 * **Restoration is verified by hash.** This edits a real tracked file that is
 * installed into a live Lich; leaving it damaged is the only outcome worse than
 * having no negative test.
 *
 * Run: node tools/pause-reaches-travel-break-check.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { findRuby, notCheckedMessage } from './find-ruby.mjs'

const TARGET = 'lich-scripts/companion_bridge.lic'
const original = readFileSync(TARGET)
const originalHash = createHash('sha256').update(original).digest('hex')
const text = original.toString('utf8')
const NL = text.includes('\r\n') ? '\r\n' : '\n'

let checks = 0
let failures = 0
let notChecked = 0

function ok(pass, what, detail = '') {
  checks++
  console.log(`${pass ? 'OK  ' : 'FAIL'} ${what}${!pass && detail ? ` — ${detail}` : ''}`)
  if (!pass) failures++
}

function restore() {
  writeFileSync(TARGET, original)
}

process.on('exit', () => {
  const now = createHash('sha256').update(readFileSync(TARGET)).digest('hex')
  if (now !== originalHash) {
    console.log(`FAIL the file was left damaged — restoring ${TARGET}`)
    restore()
    process.exitCode = 1
  }
})

const ruby = findRuby()

/** The class check. Returns `{ ok, out }`. */
function runClassCheck() {
  try {
    const out = execFileSync(
      process.execPath,
      ['--experimental-test-module-mocks', 'tools/pause-reaches-travel-test.mjs'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    )
    return { ok: true, out }
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

/** The bridge's own behavioural suite. Returns `{ ok, out }` or null if no Ruby. */
function runRubySuite() {
  if (!ruby) return null
  try {
    const out = execFileSync(ruby, ['lich-scripts/test/pause_test.rb', TARGET], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, out }
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

/* ---------------------------------------------------------------- green -- */

console.log('-- the undamaged file passes both suites, or nothing below means anything --')
{
  const cls = runClassCheck()
  ok(cls.ok, 'tools/pause-reaches-travel-test.mjs passes on the unmodified bridge', cls.out.slice(-800))
  if (!cls.ok) {
    console.log('\naborting: the baseline is not green, so a red sabotage would prove nothing')
    process.exitCode = 1
    process.exit()
  }
  const rb = runRubySuite()
  if (rb === null) {
    // Three states. A missing interpreter is not a pass and not a failure.
    notChecked++
    console.log(`NOT CHECKED  ${notCheckedMessage('the Ruby half of this break-check')}`)
  } else {
    ok(rb.ok, 'lich-scripts/test/pause_test.rb passes on the unmodified bridge', rb.out.slice(-800))
  }
}

/* ------------------------------------------------------------ sabotages -- */

/**
 * Each case: the exact fragment to remove or replace, what must go red, and
 * what must stay green.
 */
const CASES = [
  {
    name: 'map_walk stops consulting the pause latch',
    from: [
      "      if (held = pause_refusal('map_walk'))",
      '        return held',
      '      end',
      '',
      '      return no_map unless MapInfo.available?',
    ].join(NL),
    to: '      return no_map unless MapInfo.available?',
    // The class check must name the intent, not merely fail somewhere.
    classMustSay: ['map_walk consults the latch by name'],
    rubyMustSay: ['map_walk refused while paused'],
  },
  {
    name: 'pause_all stops setting the latch',
    from: `      request_pause!${NL}${NL}      paused = []`,
    to: '      paused = []',
    classMustSay: ['pause_all latches'],
    rubyMustSay: ['pause_all latched'],
  },
  {
    name: 'resume_all stops clearing it, so Pause becomes a one-way door',
    from: `      clear_pause!${NL}`,
    to: '',
    classMustSay: ['resume_all clears the latch'],
    rubyMustSay: ['the latch cleared'],
  },
]

for (const c of CASES) {
  console.log(`\n-- sabotage: ${c.name} --`)
  const count = text.split(c.from).length - 1
  ok(count === 1, `the fragment is present exactly once (found ${count})`)
  if (count !== 1) continue

  const damaged = text.replace(c.from, c.to)
  ok(damaged !== text, 'and the sabotage actually changes the file')
  writeFileSync(TARGET, damaged, 'utf8')

  try {
    const cls = runClassCheck()
    ok(!cls.ok, 'the class check goes red')
    for (const line of c.classMustSay) {
      ok(
        cls.out.includes(`FAIL ${line}`),
        `and it names the failure: "${line}"`,
        cls.out.slice(-600)
      )
    }

    const rb = runRubySuite()
    if (rb === null) {
      notChecked++
      console.log('NOT CHECKED  the Ruby half (no interpreter found)')
    } else {
      ok(!rb.ok, 'the bridge suite goes red too')
      for (const line of c.rubyMustSay) {
        ok(rb.out.includes(`FAIL ${line}`), `and it names the behaviour: "${line}"`, rb.out.slice(-600))
      }
    }
  } finally {
    restore()
  }

  // Restored, and verified as restored, before the next case runs rather than
  // only at exit: a case that starts from a damaged file is measuring the
  // previous sabotage.
  const back = createHash('sha256').update(readFileSync(TARGET)).digest('hex')
  ok(back === originalHash, 'the file is restored, verified by hash')
}

console.log(
  `${notChecked ? `\nno failures, but ${notChecked} not checked` : ''}` +
    (failures ? `\n${failures} of ${checks} failed` : `\nall ${checks} break-check assertions passed`)
)
process.exitCode = failures ? 1 : 0
