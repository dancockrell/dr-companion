/**
 * The pre-merge gate. One command, because a ritual with five lines in it is a
 * ritual somebody runs four of.
 *
 *   npm run gate
 *
 * # Why this exists
 *
 * Until 6 September 2026 the gate was `.github/workflows/ci.yml` and the lane
 * protocol's pre-merge step was `gh pr checks <n> --watch`. Actions is now
 * disabled for this repository (`gh api
 * repos/dancockrell/dr-companion/actions/permissions` -> `enabled: false`) and
 * every workflow is deleted, so nothing off this machine verifies anything.
 * That moves the whole burden onto the person merging, and the way that fails
 * is not defiance, it is a five-command list of which somebody runs three.
 *
 * So the list lives here instead. What this runs is what ci.yml's `checks` and
 * `tauri` jobs ran, in the same order:
 *
 *   npx tsc -b --noEmit        types
 *   npm run lint               oxlint
 *   npm run test:all           every suite, through the runner
 *   cargo fmt --check          Rust format
 *   cargo clippy -D warnings   Rust lint
 *   cargo test                 Rust tests
 *
 * ci.yml's `godot` job is deliberately not here: `npm run test:godot` needs an
 * engine, and the machine rule on this fleet is no Godot. It reports NOT RUN
 * rather than passing, and is named in the summary below as a stage this gate
 * does not cover, which is the honest third state rather than a silent gap.
 *
 * # What makes this a gate rather than a script
 *
 * Three things, all of which are the same rule from a different angle: a run
 * that did not check something must never be able to read as one that passed.
 *
 *   - Every stage's exit status is read directly from spawnSync's `status`,
 *     never through a pipe, and a null status (the process was killed, or the
 *     binary does not exist) is a failure and not a zero.
 *   - A missing toolchain is NOT RUN, not a skip. `cargo` absent means the
 *     Rust half was not checked, and this exits non-zero saying so. Merging on
 *     "the parts I have installed passed" is exactly what a CI runner used to
 *     make impossible.
 *   - The summary carries the denominator: `6 of 6 stages ran`. If a stage is
 *     added and never wired, or the list is emptied by an edit, the number
 *     falls and the line stops saying what it said yesterday.
 *
 * # Options
 *
 *   --list        print the stages and exit 0, running nothing
 *   --only=NAME   run one stage (comma-separated for several). Refuses an
 *                 unknown name rather than running nothing and reporting a
 *                 clean sweep, and its summary says plainly that a partial run
 *                 is not the gate.
 *
 * `--only` exists so a stage can be re-run on its own after a fix without
 * paying for the whole sweep, and so the failure path of this file can be
 * exercised deliberately: `--only=nonesuch` must exit non-zero naming the
 * name, which is the sabotage that proves the refusal branch is reachable.
 *
 * DRC_TEST_PORT is passed through untouched: the suites that bind a port read
 * it, and on a machine running several lanes at once each needs its own.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const cargoManifest = resolve(root, 'src-tauri', 'Cargo.toml')

/**
 * The Rust toolchain's name, overridable so this file's own unhappy paths can
 * be run on purpose rather than waited for.
 *
 *   DRC_GATE_CARGO=definitely-not-a-binary npm run gate -- --only=clippy
 *       -> NOT RUN, exit 1. The branch that refuses to call a missing
 *          toolchain a pass.
 *   DRC_GATE_CARGO=node npm run gate -- --only=clippy
 *       -> FAIL, exit 1. A binary that resolves and then does not do the job,
 *          which is the branch a real clippy failure takes.
 *
 * A branch nobody can execute deliberately is a branch nobody can prove they
 * fixed, and both of these are the ones that decide whether an unverified
 * merge is possible.
 */
const cargo = process.env.DRC_GATE_CARGO || 'cargo'

/**
 * Each stage names the command it is, so the summary quotes something a reader
 * can paste. `needs` is a binary that must resolve for the stage to mean
 * anything; when it does not, the stage is NOT RUN and the gate fails.
 */
const STAGES = [
  { name: 'types', cmd: npx, args: ['tsc', '-b', '--noEmit'] },
  { name: 'lint', cmd: npm, args: ['run', 'lint'] },
  { name: 'suites', cmd: npm, args: ['run', 'test:all'] },
  {
    name: 'rust-fmt',
    needs: cargo,
    cmd: cargo,
    args: ['fmt', '--manifest-path', cargoManifest, '--check'],
  },
  {
    name: 'clippy',
    needs: cargo,
    cmd: cargo,
    args: ['clippy', '--manifest-path', cargoManifest, '--all-targets', '--', '-D', 'warnings'],
  },
  {
    name: 'rust-tests',
    needs: cargo,
    cmd: cargo,
    args: ['test', '--manifest-path', cargoManifest],
  },
]

/** Stages this gate knowingly does not cover, printed every run so the gap is
 * a stated fact rather than something a reader has to notice is missing. */
const NOT_COVERED = [
  ['godot', 'npm run test:godot', 'needs a Godot 4.3 binary; no Godot on this fleet'],
  ['installer', 'npm run tauri:build', 'a 217 MB build; release work only, see docs/RELEASE.md'],
]

const argv = process.argv.slice(2)

if (argv.includes('--list')) {
  for (const s of STAGES) console.log(`${s.name.padEnd(12)} ${s.cmd} ${s.args.join(' ')}`)
  for (const [n, c, why] of NOT_COVERED) console.log(`${n.padEnd(12)} (not covered) ${c} - ${why}`)
  process.exit(0)
}

let selected = STAGES
const only = argv.find((a) => a.startsWith('--only='))
if (only) {
  const names = only.slice('--only='.length).split(',').filter(Boolean)
  const unknown = names.filter((n) => !STAGES.some((s) => s.name === n))
  if (unknown.length > 0 || names.length === 0) {
    console.error(`gate: no such stage: ${unknown.join(', ') || '(none named)'}`)
    console.error(`gate: stages are ${STAGES.map((s) => s.name).join(', ')}`)
    // A filter that empties its input is an error, never a quiet clean sweep.
    process.exit(2)
  }
  selected = STAGES.filter((s) => names.includes(s.name))
}

/** Does this binary resolve? `--version` rather than a PATH search, because a
 * binary on PATH that cannot execute is the same absence with more steps. */
function resolves(bin) {
  const r = spawnSync(bin, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' })
  return r.status === 0
}

// A control on the harness itself. If spawning cannot work at all, every stage
// below would report NOT RUN and the failure would read as a missing
// toolchain rather than a broken runner.
if (!resolves(npm)) {
  console.error('gate: npm does not run here, so nothing below would have meant anything.')
  console.error('gate: on this machine node/npm live in "C:\\Program Files\\nodejs".')
  process.exit(2)
}
if (!existsSync(cargoManifest)) {
  console.error(`gate: ${cargoManifest} is missing; this is not a dr-companion checkout.`)
  process.exit(2)
}

const started = Date.now()
const results = []

for (const stage of selected) {
  if (stage.needs && !resolves(stage.needs)) {
    console.log(`\n=== ${stage.name}: NOT RUN (${stage.needs} does not resolve) ===`)
    results.push({ ...stage, state: 'not-run', why: `${stage.needs} is not installed` })
    continue
  }
  console.log(`\n=== ${stage.name}: ${stage.cmd} ${stage.args.join(' ')} ===`)
  const t = Date.now()
  const r = spawnSync(stage.cmd, stage.args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  })
  const secs = Math.round((Date.now() - t) / 1000)
  // `status` is null when the process was killed or never started. Neither is
  // a pass, and neither is a zero.
  const state = r.status === 0 ? 'pass' : 'fail'
  const why = r.status === null ? `did not run to completion (${r.error?.message ?? 'signal'})` : `exit ${r.status}`
  results.push({ ...stage, state, why, secs })
}

const ran = results.filter((r) => r.state !== 'not-run').length
const failed = results.filter((r) => r.state === 'fail')
const notRun = results.filter((r) => r.state === 'not-run')

console.log('\n──────────────────────────────────────────────')
for (const r of results) {
  const mark = r.state === 'pass' ? 'PASS   ' : r.state === 'fail' ? 'FAIL   ' : 'NOT RUN'
  console.log(`${mark} ${r.name.padEnd(12)} ${r.state === 'pass' ? `${r.secs}s` : r.why}`)
}
for (const [n, c, why] of NOT_COVERED) console.log(`—       ${n.padEnd(12)} not covered: ${why} (${c})`)

const total = Math.round((Date.now() - started) / 1000)
const denom = `${ran} of ${selected.length} stages ran`
const partial = selected.length !== STAGES.length

if (failed.length === 0 && notRun.length === 0) {
  if (partial) {
    console.log(`\ngate: ${denom} in ${total}s, all passed — but this was --only, NOT the gate.`)
    console.log(`gate: run \`npm run gate\` with no arguments before merging.`)
    process.exit(0)
  }
  console.log(`\ngate ok: ${denom} in ${total}s. This is the pre-merge gate; there is no CI.`)
  process.exit(0)
}

console.log(`\ngate NOT PASSED: ${denom} in ${total}s`)
if (failed.length > 0) console.log(`  failed:  ${failed.map((f) => f.name).join(', ')}`)
if (notRun.length > 0) {
  console.log(`  not run: ${notRun.map((f) => `${f.name} (${f.why})`).join(', ')}`)
  console.log(`  a stage that could not run is not a stage that passed.`)
}
process.exit(1)
