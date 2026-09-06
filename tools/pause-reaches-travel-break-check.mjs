/**
 * Break the bridge's Pause latch on purpose and watch the checks catch it.
 *
 * `tools/pause-reaches-travel-test.mjs` and `lich-scripts/test/pause_test.rb`
 * both print green today. A suite that never ran, a suite whose assertions
 * cannot fail, and a suite that is right print identically, and the only way to
 * tell them apart is to make the thing they watch actually wrong.
 *
 * Five sabotages, each aimed at one link of the chain #462 and #487 exposed:
 *
 *   1. `map_walk` stops consulting the latch  - a tile click walks while paused
 *   2. `pause_all` stops setting it           - nothing is ever latched
 *   3. `resume_all` stops clearing it         - Pause becomes a one-way door
 *   4. `pause_requested?` stops reconciling   - a `;unpause go2` in Lich walks
 *                                               the character under "Paused,
 *                                               bridge confirmed" (#487)
 *   5. the relay stops adopting the latch     - an app restarted while the
 *                                               bridge is holding reads
 *                                               "Running" (#487)
 *
 * 4 and 5 are the two halves of one contract - the bridge owns "paused" and
 * the app mirrors it - and 5 is in TypeScript, which is why this file damages
 * more than one target.
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
/**
 * The app half of Pause is sabotaged too, since #487.
 *
 * The bridge is the owner of "paused" and the app mirrors it, so half of this
 * contract now lives in TypeScript: a relay that stops adopting
 * `status.pauseLatched` puts the app back to reading "Running" while the
 * bridge refuses travel, and nothing in the `.lic` would have changed. A
 * negative suite that can only damage one side of a two-sided contract is
 * asserting less than it looks like it is.
 */
const RELAY = 'src/lib/bridgePauseRelay.ts'

/**
 * Per-file bytes, hash and line ending.
 *
 * Per-target rather than one constant because the `.lic` is LF and the `.ts`
 * files are CRLF (measured). A fragment joined with the wrong one matches
 * nothing, which - without the exactly-once guard below - would rewrite the
 * file unchanged, leave both suites green, and read exactly like proof.
 */
const TARGETS = {}
for (const path of [TARGET, RELAY]) {
  const original = readFileSync(path)
  const text = original.toString('utf8')
  TARGETS[path] = {
    original,
    text,
    hash: createHash('sha256').update(original).digest('hex'),
    NL: text.includes('\r\n') ? '\r\n' : '\n',
  }
}
const text = TARGETS[TARGET].text
const NL = TARGETS[TARGET].NL

let checks = 0
let failures = 0
let notChecked = 0

function ok(pass, what, detail = '') {
  checks++
  console.log(`${pass ? 'OK  ' : 'FAIL'} ${what}${!pass && detail ? ` — ${detail}` : ''}`)
  if (!pass) failures++
}

function restore(path) {
  writeFileSync(path, TARGETS[path].original)
}

process.on('exit', () => {
  for (const [path, t] of Object.entries(TARGETS)) {
    const now = createHash('sha256').update(readFileSync(path)).digest('hex')
    if (now !== t.hash) {
      console.log(`FAIL the file was left damaged — restoring ${path}`)
      restore(path)
      process.exitCode = 1
    }
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
    // Anchored on the line after it: since #487 `clear_pause!` is called from
    // `reconcile_pause!` as well, and a bare fragment matches twice. Caught by
    // the exactly-once guard, which is what it is there for - it printed
    // "found 2" rather than damaging the wrong call site or, worse, rewriting
    // the file unchanged and reading as a pass.
    from: `      clear_pause!${NL}      reset_macro_flight!`,
    to: '      reset_macro_flight!',
    classMustSay: ['resume_all clears the latch'],
    // Not "the latch cleared", which stopped being able to fail the moment the
    // #487 reconcile existed: that case has a walker, and unpausing it lowers
    // the latch through `reconcile_pause!` whether or not `resume_all` cleared
    // anything. This case has nothing running, so nothing can reconcile and
    // only the explicit clear can produce it. Measured, not reasoned - the
    // sabotage went green on the Ruby side until this line changed.
    rubyMustSay: ['Resume clears the latch with nothing to unpause'],
  },
  {
    // #487, finding 2. The latch used to be a flag: `pause_all` set it and
    // only `resume_all` cleared it, so `;unpause go2` typed at the Lich prompt
    // walked the character while the bridge kept reporting pauseLatched=true
    // and the app rendered "Paused, bridge confirmed" over it.
    name: 'the bridge stops watching its scripts, so a Lich-side unpause is invisible',
    from: `      reconcile_pause!${NL}      @pause_requested`,
    to: '      @pause_requested',
    classMustSay: [
      'the one method every reader goes through reconciles first, so no caller has to remember to',
    ],
    rubyMustSay: ['a Lich-side unpause lowers the latch'],
  },
  {
    // #487, finding 1. Sabotaged in the app rather than the bridge: this is
    // the half that makes the bridge the owner instead of an opinion, and
    // nothing in the `.lic` moves when it breaks.
    target: RELAY,
    name: 'the app ignores pauseLatched on connect, so a restart reads "Running"',
    // One line, no newline in the fragment: the relay is CRLF and a `\n`
    // written here would match nothing at all.
    from: 'if (!latched) return',
    to: 'if (true) return',
    classMustSay: ['a status carrying the bridge latch pauses this app - the restart case'],
    // The bridge is untouched, so its own suite must stay green. See
    // `rubyMustStayGreen` below: a sabotage that reddens more than it should
    // means the two suites are entangled and each says less than it appears to.
    rubyMustSay: [],
    rubyMustStayGreen: true,
  },
]

for (const c of CASES) {
  const path = c.target ?? TARGET
  const t = TARGETS[path]
  console.log(`\n-- sabotage: ${c.name} --`)
  console.log(`   (in ${path})`)
  const count = t.text.split(c.from).length - 1
  ok(count === 1, `the fragment is present exactly once (found ${count})`)
  if (count !== 1) continue

  const damaged = t.text.replace(c.from, c.to)
  ok(damaged !== t.text, 'and the sabotage actually changes the file')
  writeFileSync(path, damaged, 'utf8')

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
    } else if (c.rubyMustStayGreen) {
      // Which checks go red matters as much as that something did. This
      // sabotage is in the app; the bridge is byte-identical, so its own
      // suite going red would mean the two are entangled and neither is
      // saying what it claims.
      ok(rb.ok, 'and the bridge suite stays green - the damage is confined to the app half',
        rb.out.slice(-600))
    } else {
      ok(!rb.ok, 'the bridge suite goes red too')
      for (const line of c.rubyMustSay) {
        ok(rb.out.includes(`FAIL ${line}`), `and it names the behaviour: "${line}"`, rb.out.slice(-600))
      }
    }
  } finally {
    restore(path)
  }

  // Restored, and verified as restored, before the next case runs rather than
  // only at exit: a case that starts from a damaged file is measuring the
  // previous sabotage.
  const back = createHash('sha256').update(readFileSync(path)).digest('hex')
  ok(back === t.hash, `${path} is restored, verified by hash`)
}

console.log(
  `${notChecked ? `\nno failures, but ${notChecked} not checked` : ''}` +
    (failures ? `\n${failures} of ${checks} failed` : `\nall ${checks} break-check assertions passed`)
)
process.exitCode = failures ? 1 : 0
