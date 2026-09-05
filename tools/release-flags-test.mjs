/**
 * The release scripts' guard flags must fail on a typo, not pass in silence.
 *
 * # Why this suite exists
 *
 * `.github/workflows/release.yml` decides whether a build carries the world
 * viewer once, and every later step reads that decision:
 *
 *     npm run release:config -- ${{ ... && '--require-viewer' || '' }}
 *     npm run release:verify -- ${{ ... && '--expect-viewer' || '' }}
 *
 * Both flags used to be read with `process.argv.includes(...)`, which cannot
 * tell "not passed" from "misspelled". A `--requre-viewer` in that expression
 * would have been read as *no viewer required*: the release would ship the
 * smaller installer, `release:verify` would not look for the viewer, and every
 * step would be green - the exact outcome both flags exist to prevent.
 *
 * That is not a hypothetical waiting for someone to be careless. Issue #344
 * establishes that the repository has no `SHARED_ASSETS_TOKEN`
 * (`gh api repos/dancockrell/dr-companion/actions/secrets` -> `total_count: 0`),
 * so the branch that passes either flag has never executed once. A typo there
 * would sit unnoticed until the first viewer-carrying release quietly failed
 * to carry a viewer.
 *
 * # What it checks, and the control that makes the checks mean something
 *
 * The scripts are run as real child processes, not the parser in isolation:
 * what has to be true is that *these commands* refuse, not that a helper
 * function can. Each refusal is paired with a control - the correctly spelled
 * flag, run the same way, reaching its own branch and saying so. Without the
 * control, a script that refused every argument would score identically to one
 * that refuses only the wrong ones.
 *
 *     node tools/release-flags-test.mjs
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const CONFIG = 'tools/build-release-config.mjs'
const VERIFY = 'tools/verify-release-bundle.mjs'

let checks = 0
let fails = 0
const ok = (label, condition) => {
  checks += 1
  if (!condition) fails += 1
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`)
}

/** A path that cannot exist, so `--require-viewer`'s refusal branch is reached
 * on a machine that has built a viewer as well as on one that has not. The
 * script announces the override, which is itself part of what is asserted. */
const NO_VIEWER = join(tmpdir(), 'drc-no-such-viewer-a1b2c3.exe')

function run(script, args, env = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, DRC_VIEWER_EXE: NO_VIEWER, ...env },
  })
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

const rejected = (r) => r.code === 1 && /unknown flag|unexpected argument|needs a value|takes no value/.test(r.out)

// ---------------------------------------------------------------------------
// 1. build-release-config: the flag the release workflow passes.

const typo = run(CONFIG, ['--requre-viewer'])
ok('a misspelled --require-viewer exits non-zero', typo.code === 1)
ok('...and names the token it did not understand', typo.out.includes('--requre-viewer'))
ok('...and calls it an unknown flag', /unknown flag/.test(typo.out))
ok('...and lists what it does accept', typo.out.includes('--require-viewer'))

// The control. Same command, correct spelling, reaching the branch the flag is
// for - so the refusal above is about the spelling and not about the argument
// list being rejected wholesale.
const real = run(CONFIG, ['--require-viewer'])
ok('the correctly spelled flag is not rejected as unknown', !/unknown flag/.test(real.out))
ok(
  'the correctly spelled flag reaches its own refusal instead',
  real.code === 1 && real.out.includes('--require-viewer was given but')
)

// ---------------------------------------------------------------------------
// 2. build-release-config: the other flags, and the value-taking one.

ok('an unknown flag is rejected even beside a valid one', rejected(run(CONFIG, ['--check', '--nope'])))
ok('a stray positional argument is rejected', rejected(run(CONFIG, ['release'])))
ok('a value on a boolean flag is rejected', rejected(run(CONFIG, ['--check=yes'])))
ok('--out with no value is rejected', rejected(run(CONFIG, ['--out'])))

const checkOnly = run(CONFIG, ['--check'])
ok('--check alone still runs', checkOnly.code === 0 && !/unknown flag/.test(checkOnly.out))

// `--out PATH` must survive: its value is not a flag and must not be read as
// one. tools/bundle-test.mjs depends on this exact form.
const dir = mkdtempSync(join(tmpdir(), 'release-flags-'))
const outPath = join(dir, 'tauri.release.conf.json')
const wrote = run(CONFIG, ['--out', outPath])
ok('--out PATH is accepted and its value is not read as a flag', wrote.code === 0)
ok('--out PATH actually wrote the config where it was told', existsSync(outPath))
rmSync(dir, { recursive: true, force: true })

// ---------------------------------------------------------------------------
// 3. verify-release-bundle: the same flag from the other side.

const vTypo = run(VERIFY, ['--expct-viewer'])
ok('a misspelled --expect-viewer exits non-zero', vTypo.code === 1)
ok('...and says which token was wrong', vTypo.out.includes('--expct-viewer'))
ok('...and calls it an unknown flag', /unknown flag/.test(vTypo.out))

// The control here matters more than usual: this script exits 1 for a missing
// release build too, so exit status alone cannot tell a rejected flag from an
// accepted one. The message is what separates them.
const vReal = run(VERIFY, ['--expect-viewer'])
ok('the correctly spelled flag is not rejected as unknown', !/unknown flag/.test(vReal.out))
const vNone = run(VERIFY, [])
ok('no flags at all is not rejected as unknown', !/unknown flag/.test(vNone.out))

// The floor. Well below what this file contains, so it never needs touching,
// and high enough that a truncated or half-executed run reports itself rather
// than passing for free.
if (checks < 15) {
  console.log(`\nFAIL only ${checks} checks ran; this file has more than that`)
  process.exit(1)
}

console.log(fails === 0 ? `\n${checks} checks, all passed` : `\n${fails} of ${checks} FAILED`)
process.exit(fails === 0 ? 0 : 1)
