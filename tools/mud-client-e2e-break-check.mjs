#!/usr/bin/env node
/**
 * Prove that `tools/mud-client-e2e.mjs` can go red, and go red where it aimed.
 *
 *   npm run test:mud-client-e2e-break
 *
 * A green end-to-end run is worth nothing on its own. It is indistinguishable
 * from a harness that connected to nothing, asserted over an empty buffer and
 * reported a clean sweep, which is the exact failure that tree's whole test
 * doctrine is built to refuse. So each of the three claims that run makes
 * about the world has a seam that breaks it, and this file runs all three and
 * checks that each reddened *its own step and no other*.
 *
 * The last clause is the one that earns this file. A sabotage that reddens
 * more than it aimed at means the checks are entangled and the suite is saying
 * less than it appears to; a sabotage that reddens less means the seam missed.
 * Asserting "something failed" would catch neither.
 *
 * # Why these are seams and not damage to tracked source
 *
 * The other break-checks here (`command-lane-break-check.mjs`,
 * `link-reconnect-break-check.mjs`) edit `src/` and `src-tauri/` on purpose and
 * restore by hash. Each is kept out of `npm run test:all` and named in
 * `tools/gate.mjs` for one reason, stated in that file's own list: several
 * sessions build this tree at once, and a harness that writes a deliberately
 * broken file into it makes somebody else's `cargo build` fail with no clue
 * why.
 *
 * The three seams here are environment variables read by the harness itself.
 * They damage nothing, they finish in seconds, and they can therefore live in
 * the ordinary suite run where they will actually be executed - which is worth
 * more than the extra fidelity of source damage nobody dares run.
 *
 * What that buys and what it does not:
 *
 *   - it buys: proof that each of the three checks is wired to the thing it
 *     names, and that a change which quietly disconnects one of them turns
 *     this red rather than leaving a check that cannot fail;
 *   - it does not buy: proof that the *app* fails when the app is wrong. The
 *     outbound lane's ordering is `src-tauri/src/command_gate.rs`, and
 *     `tools/command-lane-break-check.mjs` is the harness that damages it.
 *     That is said here rather than left for a reader to assume the wrong one.
 *
 * # The gate before the sabotage
 *
 * The unsabotaged run has to be green before any sabotage result is read. A
 * fix or a refactor that breaks the harness outright would otherwise make
 * every sabotage "fail as expected", and this file would certify a suite that
 * no longer runs.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const harness = join(root, 'tools', 'mud-client-e2e.mjs')

/**
 * Each seam, and the exact set of step names it must redden.
 *
 * Written out rather than derived, because a derived expectation is one the
 * harness could satisfy by renaming a step. These strings are the contract:
 * if a step is renamed, this file must be edited in the same commit, which is
 * the point.
 */
const SEAMS = [
  {
    env: 'bypass-lane',
    what: 'a caller writes to the socket without entering the outbound path',
    expect: ['and each one entered the outbound path, in order'],
  },
  {
    env: 'early-drop',
    what: 'the stand-in Lich is never stopped, so no drop happens to notice',
    expect: [
      'the client notices the socket closing',
      'and reads the link as reconnecting, not as connected',
      'the placeholder says so instead of inviting a command',
    ],
  },
  {
    env: 'no-godot-lie',
    what: "the play chain's viewer-closure check is inverted, so a client that cannot reach the viewer fails it",
    expect: ['nothing the client needs to play can reach the viewer'],
  },
]

let fails = 0
let checks = 0
const ok = (label, condition, detail = '') => {
  checks += 1
  if (!condition) fails += 1
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label.padEnd(58)} ${detail}`)
}

/** Run the harness and read back which steps it reddened. */
function run(sabotage) {
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--experimental-test-module-mocks', harness],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, DRC_E2E_SABOTAGE: sabotage ?? '' },
    }
  )
  // `status` read directly, never through a pipe, and a null status - killed,
  // or never started - is a failure and not a zero.
  if (r.status === null) {
    return { status: null, failed: [], skipped: 0, why: r.error?.message ?? 'signal' }
  }
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const failed = [...out.matchAll(/^FAIL (.+?)\s{2,}/gm)].map((m) => m[1].trim())
  const skipped = [...out.matchAll(/^NOT CHECKED /gm)].length
  const ran = [...out.matchAll(/^(?:OK {2}|FAIL) /gm)].length
  return { status: r.status, failed, skipped, ran, out }
}

// ------------------------------------------------------- the gate, first

console.log('-- the harness must be green before any sabotage result means anything --')
const clean = run(null)
ok('the unsabotaged run passes', clean.status === 0, clean.why ?? `exit ${clean.status}`)
ok(
  'and it ran a whole suite rather than dying early',
  (clean.ran ?? 0) >= 45,
  `${clean.ran ?? 0} checks executed`
)
if (clean.status !== 0 || (clean.ran ?? 0) < 45) {
  console.log('\nFAIL the harness itself is broken; no sabotage below would mean anything.')
  console.log(clean.out ?? '')
  process.exit(1)
}
// The denominator the sabotage results are read against. If the harness stops
// reporting skips, the "no other step changed" comparisons below silently get
// easier, so it is asserted rather than assumed.
const baseSkips = clean.skipped
ok('the clean run reports its own skips', baseSkips > 0, `${baseSkips} skipped`)

// ------------------------------------------------------------ the sabotages

console.log('\n-- each seam must redden its own step, and no other --')
for (const seam of SEAMS) {
  const r = run(seam.env)
  const got = [...new Set(r.failed)].sort()
  const want = [...new Set(seam.expect)].sort()
  ok(`${seam.env}: the run fails`, r.status === 1, `exit ${r.status} - ${seam.what}`)
  ok(
    `${seam.env}: exactly the expected steps go red`,
    got.length === want.length && got.every((g, i) => g === want[i]),
    `got [${got.join(' | ')}] wanted [${want.join(' | ')}]`
  )
  ok(
    `${seam.env}: the rest of the suite still ran`,
    (r.ran ?? 0) === clean.ran,
    `${r.ran} checks vs ${clean.ran} clean`
  )
  ok(
    `${seam.env}: nothing turned into a skip instead of a failure`,
    r.skipped === baseSkips,
    `${r.skipped} skipped vs ${baseSkips} clean`
  )
}

// A control on this file's own reader. If the FAIL-line regexp above stopped
// matching, every `got` would be empty, every comparison against a non-empty
// `want` would fail loudly - but the `no-godot-lie` case wants exactly one, so
// a reader that matched *everything* would also be caught. Asserting that the
// clean run produced no matches is the third state: the parser works and found
// nothing, rather than the parser finding nothing because it is broken.
ok('the clean run reddened nothing', clean.failed.length === 0, clean.failed.join(' | '))

const FLOOR = 3 + SEAMS.length * 4
console.log('\n──────────────────────────────────────────────')
if (checks < FLOOR) {
  console.log(`FAIL only ${checks} checks ran; this file has at least ${FLOOR}`)
  process.exit(1)
}
console.log(fails === 0 ? `${checks} checks, all passed` : `${fails} of ${checks} FAILED`)
process.exit(fails === 0 ? 0 : 1)
