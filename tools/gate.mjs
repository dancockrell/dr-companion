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
 *   node tools/godot-tests.mjs the Godot test scripts, headless
 *
 * The Godot stage was the one hole this file shipped with. ci.yml had a
 * `godot` job; when Actions went away it landed nowhere, and the first version
 * of this gate named it as "not covered" on the belief that there is no engine
 * on this fleet. There is one, `tools/godot-tests.mjs` finds it, and a suite of
 * sixteen scripts that runs nowhere automated is the same defect this whole
 * file exists to prevent, one directory over. See `godotStage` for how the
 * machine rule that governs it (headless, bounded, kind to the other lanes) is
 * enforced mechanically rather than promised.
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
 *   - The summary carries the denominator: `11 of 11 stages ran`, and that eleven
 *     is asserted against `EXPECTED_STAGES` rather than against the list it
 *     came from. Both halves used to be derived from `STAGES`, so trimming the
 *     list to two printed `2 of 2 stages ran` and exited 0 — a denominator that
 *     shrinks with its numerator measures nothing.
 *   - A skip inside a stage reaches this summary. `run-tests.mjs` already
 *     refuses to say "all passed" over a suite that declined a rule, and exits
 *     0 doing it; this read only the exit status, so the honest sentence
 *     scrolled past and the gate said "all passed" anyway. See `partialNote`.
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
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
// Imported, not copied. Two lists of where a Godot binary might live would
// drift, and then the gate and the tool it runs would disagree about whether
// there is an engine — which is the worst possible thing for them to disagree
// about, because one of them decides whether the other gets to run at all.
import { findGodotDetailed, godotCandidates, godotNotFoundReason } from './godot-tests.mjs'

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
 * Git, on the same reasoning as `DRC_GATE_CARGO`, for the currency check below.
 *
 *   DRC_GATE_GIT=definitely-not-a-binary npm run gate -- --only=types
 *       -> "could not check whether origin/main moved". The third state: not a
 *          claim that this gate is current, and not a failure either.
 */
const git = process.env.DRC_GATE_GIT || 'git'

/**
 * The Godot stage's two seams, on the same reasoning as `DRC_GATE_CARGO`: both
 * of its unhappy branches decide whether an unverified merge is possible, and
 * a branch nobody can execute on purpose is a branch nobody can prove they
 * fixed. Neither is reachable by waiting — this machine has an engine, and the
 * count of running ones is somebody else's business.
 *
 *   DRC_GATE_GODOT=definitely-not-a-binary npm run gate -- --only=godot
 *       -> NOT RUN, exit 1. No engine: names what was searched and the GODOT4
 *          override.
 *   DRC_GATE_GODOT_RUNNING=9 npm run gate -- --only=godot
 *       -> NOT RUN, exit 1. Engine present, but nine already running, so this
 *          declines to add a tenth.
 *
 * They must read as different messages, because they call for opposite things
 * from whoever is standing there: install an engine, versus wait for the other
 * lanes to finish. A single "godot unavailable" would collapse them.
 */
const godotBinary = process.env.DRC_GATE_GODOT || ''
const godotRunningOverride = process.env.DRC_GATE_GODOT_RUNNING

/**
 * Dan's machine rule, 6 September 2026: Godot headless only, bounded, and kind
 * to the other threads. `godot-tests.mjs` covers headless and bounded. This
 * covers kind — several lanes run at once here, each may have an engine up, and
 * a gate that starts a sixteen-script sweep on top of three live editors is a
 * gate that costs somebody else their session. Two is the ceiling: at two the
 * gate is the third, which the machine carries; above it, wait.
 */
const MAX_GODOT_RUNNING = 2

/**
 * How many Godot processes are already up. `tasklist` rather than a wildcard
 * `Get-Process Godot*`, for the reason a zero always deserves: this must be
 * able to say "I could not tell", and a process listing that returns no rows at
 * all is a broken instrument, not an idle machine. So the row count is the
 * control, and it is asserted before the Godot count is believed.
 */
function godotProcessCount() {
  if (godotRunningOverride !== undefined) {
    const n = Number(godotRunningOverride)
    if (!Number.isFinite(n)) return { error: `DRC_GATE_GODOT_RUNNING=${godotRunningOverride} is not a number` }
    return { count: n, how: `DRC_GATE_GODOT_RUNNING=${n}` }
  }
  if (process.platform !== 'win32') {
    const r = spawnSync('ps', ['-A', '-o', 'comm='], { encoding: 'utf8' })
    if (r.status !== 0 || !r.stdout) return { error: '`ps -A` produced nothing, so the count is unknown' }
    const rows = r.stdout.split('\n').filter((l) => l.trim())
    if (rows.length < 10) return { error: `\`ps -A\` listed only ${rows.length} processes; that is the tool failing, not an idle machine` }
    return { count: rows.filter((l) => /godot/i.test(l)).length, how: `ps -A, ${rows.length} processes` }
  }
  const r = spawnSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8' })
  if (r.status !== 0 || !r.stdout) {
    return { error: `tasklist did not run (${r.error?.message ?? `exit ${r.status}`}), so the count is unknown` }
  }
  const rows = r.stdout.split('\n').filter((l) => l.trim())
  // The denominator. A machine with fewer than ten processes does not exist;
  // an empty listing means the instrument, not the world.
  if (rows.length < 10) {
    return { error: `tasklist listed only ${rows.length} processes; that is the tool failing, not an idle machine` }
  }
  return { count: rows.filter((l) => /godot/i.test(l)).length, how: `tasklist, ${rows.length} processes` }
}

/**
 * The Godot stage's precheck. Returns `{ notRun }` with a reason, or `{ env }`
 * naming the engine it found, which is handed to the child as `GODOT4` so the
 * tool does not search a second time and cannot pick a different answer.
 */
function godotStage() {
  const candidates = godotCandidates(godotBinary || process.env.GODOT4 || '')
  const detail = findGodotDetailed(candidates)
  const found = detail.found
  if (!found) {
    // Three states, not two. "Nothing ran at all" and "something ran and is not
    // the engine this project declares" call for opposite things from whoever
    // is standing here, and until #489 this sentence said "no Godot 4.3
    // binary" over a version nothing had ever looked at — a claim the gate was
    // making on the strength of an exit code. `godotNotFoundReason` writes the
    // right one of the three; the only thing added here is the gate's own seam.
    //
    // And the seam is added to the two states it answers, not to all three.
    // `detail.error` is "the project's declared Godot version is unknown" -
    // `godot/project.godot` did not read - and no value of GODOT4 makes that
    // file parse. Appending the remedy there diagnosed one thing and
    // prescribed another, which is the same defect as folding the three states
    // into one: it sends whoever is standing here to the wrong lever.
    const reason = godotNotFoundReason(detail, candidates)
    return {
      notRun: detail.error
        ? reason
        : `${reason} — set GODOT4 to one (the gate's own seam is DRC_GATE_GODOT)`,
    }
  }
  const running = godotProcessCount()
  if (running.error) return { notRun: `could not count running Godot processes: ${running.error}` }
  if (running.count > MAX_GODOT_RUNNING) {
    return {
      notRun:
        `${running.count} Godot processes are already running (ceiling ${MAX_GODOT_RUNNING}, via ${running.how}); ` +
        `declined to add another rather than crowd the other lanes — rerun when they are done`,
    }
  }
  console.log(`gate: ${found.version} at ${found.path}; ${running.count} already running (${running.how})`)
  return { env: { GODOT4: found.path } }
}

/**
 * Each stage names the command it is, so the summary quotes something a reader
 * can paste. `needs` is a binary that must resolve for the stage to mean
 * anything; when it does not, the stage is NOT RUN and the gate fails.
 */
const STAGES = [
  { name: 'types', cmd: npx, args: ['tsc', '-b', '--noEmit'] },
  { name: 'lint', cmd: npm, args: ['run', 'lint'] },
  // `env` here, not on the spawn call, because this is the only stage that has
  // anything to say about a skip and a variable set for every stage would be a
  // claim three of them cannot answer.
  { name: 'suites', cmd: npm, args: ['run', 'test:all'], env: () => ({ DRC_TESTS_PARTIAL_FILE: partialNote }) },
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
  // ---------------------------------------------------------------- the
  // negative suites. Each of these damages tracked source on purpose, runs the
  // suite that is meant to catch it, and restores the file — verified by hash
  // and, since #489, by `git status` over the paths it touched
  // (tools/break-check-tree.mjs).
  //
  // They live here rather than in `tools/test-suites.json` for the reason each
  // one's header gives: `node tools/run-tests.mjs` is run constantly and
  // concurrently, and a harness that writes to `src/` must never be one of
  // several things running at once. The gate is a single-lane, pre-merge
  // ritual, which is exactly the condition they need. Before #489 that
  // reasoning had been used to justify registering them nowhere at all, and
  // `first-screen-break-check.mjs` sat with a dead anchor from #409 to #489
  // — its abort would have fired the whole time, and nothing ever ran it.
  // A negative suite nobody runs is the same absence as no negative suite,
  // with more reassurance attached.
  //
  // `tools/needs-env.mjs` now asserts that every `tools/*-break-check.*` is
  // named here or reached by the full suite, so the next one cannot be
  // forgotten the way these were.
  {
    name: 'break-first-screen',
    shell: false,
    cmd: process.execPath,
    args: [resolve(root, 'tools', 'first-screen-break-check.mjs')],
  },
  {
    name: 'break-doc-claims',
    shell: false,
    cmd: process.execPath,
    args: [resolve(root, 'tools', 'doc-claims-break-check.mjs')],
  },
  {
    // The negative suite for the rule that no string a player reads names a
    // Tauri command, a Rust internal or a retired route (#528). In the gate
    // rather than in NOT_COVERED because it is seconds rather than minutes and
    // runs no compiler between its edits, so the window in which another
    // session could build a damaged file is the same one `break-doc-claims`
    // already accepts. It restores every file it touches and verifies the
    // restore by md5.
    name: 'break-ui-jargon',
    shell: false,
    cmd: process.execPath,
    args: [resolve(root, 'tools', 'ui-jargon-break-check.mjs')],
  },
  {
    // The same crate in the configuration that ships (#488). `rust-tests` above
    // is a debug build, so `cfg!(debug_assertions)` is true throughout it and
    // the release half of #464's two knob tests never executes: removing the
    // dry-run gate call from `lich.rs` left this whole gate green, and only
    // `cargo test --release` went red. Filtered to the two tests and asserting
    // that both of them ran, because a `--exact` filter matching nothing exits
    // 0 — see `tools/rust-release-knobs.mjs` for the cost and the reasoning.
    name: 'rust-release-knobs',
    needs: cargo,
    shell: false,
    cmd: process.execPath,
    args: [resolve(root, 'tools', 'rust-release-knobs.mjs')],
  },
  {
    // The Ruby containment's five sabotages (#486). Damages ruby/runner.rb and
    // tools/ai-script-repair-test.mjs, runs the whole suite between edits, and
    // asserts the exact set of checks each one reddens. It is here rather than
    // in tools/test-suites.json for this list's stated reason: it writes to
    // tracked source, and run-tests.mjs is run constantly while other sessions
    // build this tree. Without an interpreter it prints one NOT CHECKED and
    // exits 0, because every sabotage here reddens a Ruby check.
    name: 'break-ai-script-repair',
    shell: false,
    cmd: process.execPath,
    args: [resolve(root, 'tools', 'ai-script-repair-break-check.mjs')],
  },
  {
    name: 'godot',
    precheck: godotStage,
    // This node and this path, spawned directly. `shell: true` would hand a
    // command line with two spaced Windows paths in it to cmd.exe and lose
    // both; the other stages are `npm.cmd`/`npx.cmd`, which need the shell.
    shell: false,
    cmd: process.execPath,
    args: [resolve(root, 'tools', 'godot-tests.mjs')],
  },
  {
    name: 'break-bridge-client',
    // The same precheck as the Godot stage, and for the same two reasons: this
    // harness runs a `.gd` test through the engine, so a missing or wrong-
    // version engine must reach the summary as NOT RUN rather than as a
    // failure, and the ceiling on how many engines are already up applies to
    // it exactly as it applies to the suite. `GODOT4` is handed down so it
    // does not search again and cannot pick a different answer.
    precheck: godotStage,
    shell: false,
    cmd: process.execPath,
    args: [resolve(root, 'tools', 'bridge-client-null-target-break-check.mjs')],
  },
]

/**
 * How many stages a whole gate has.
 *
 * The header above claims the denominator catches an emptied stage list: "If a
 * stage is added and never wired, or the list is emptied by an edit, the number
 * falls and the line stops saying what it said yesterday." It did not. Both
 * halves of `N of M stages ran` were derived from the same list, so trimming
 * `STAGES` from seven to two printed `gate ok: 2 of 2 stages ran` and exited 0
 * — a denominator that shrinks with its numerator is not a denominator. Every
 * other tool here asserts a floor against a constant (`SUITE_FLOOR`,
 * `CHECK_FLOOR`, `MIN_TESTS`); this one asserted none on itself.
 *
 * A constant rather than a floor, because the stage list is short, hand-written
 * and named in this file's own header: adding a stage should require saying so
 * here, and losing one must never be quiet.
 */
const EXPECTED_STAGES = 13

/** Stages this gate knowingly does not cover, printed every run so the gap is
 * a stated fact rather than something a reader has to notice is missing. */
const NOT_COVERED = [
  ['installer', 'npm run tauri:build', 'a 217 MB build; release work only, see docs/RELEASE.md'],
  // The two negative suites that cannot live in the list above, each with the
  // reason stated rather than left to be noticed. Before #489 neither was
  // named anywhere a runner or a reader would meet it, which made them
  // indistinguishable from harnesses nobody had thought about.
  [
    'break-lane',
    'node tools/command-lane-break-check.mjs',
    'damages src-tauri/src/command_gate.rs and runs cargo six times between edits: minutes, ' +
      'and any other session building this tree during them compiles a deliberately broken file',
  ],
  [
    'break-sign-in',
    'python tools/sign-in-break-check.py',
    'drives a browser against the running app, and needs Python; run it by hand from docs/TESTING.md',
  ],
]

/**
 * Where `run-tests.mjs` leaves word that it skipped something.
 *
 * See that file's `PARTIAL_NOTE`. The suites stage runs with `stdio: 'inherit'`
 * and exits 0 over a partial run on purpose, so without this the gate could not
 * tell a complete sweep from one where a suite declined a rule, and said "all
 * passed" over both. Measured on `de57ffa6`:
 * `tools/godot-fixture-contract-test.mjs` prints one `NOT CHECKED` line today,
 * so this was live rather than hypothetical.
 *
 * Overridable so the branch can be run on purpose: point
 * `DRC_GATE_PARTIAL_FILE` at a file you have written yourself and the summary
 * must report it without any suite having skipped anything.
 *
 * Kept in the OS temp directory keyed by this checkout's path, not inside the
 * tree: several lanes run at once here and `node_modules` is a junction shared
 * between their worktrees, so a note written there would be one lane reading
 * another lane's run.
 */
const partialNote =
  process.env.DRC_GATE_PARTIAL_FILE ||
  join(tmpdir(), `drc-gate-partial-${createHash('sha1').update(root).digest('hex').slice(0, 12)}.json`)

/* ------------------------------------------------------------------ currency
 *
 * A branch's green gate is a statement about the tree it was cut from, and
 * nothing else. A check added on another branch in the meantime is invisible to
 * it — which is exactly how PR #513 reintroduced the class #512 had just fixed,
 * and how #517 merged green and left the Rust build red. With no CI, the only
 * thing between `main` and a broken tree is whether the person merging re-ran a
 * ten-minute command *after* the final rebase, and "run it again if the rebase
 * moved anything you did not write" is a judgement call made at the moment
 * somebody is most impatient.
 *
 * So the gate records the base it ran against and says, at the end, whether
 * that is still where `origin/main` is. Three states, never two:
 *
 *   current  — the base is `origin/main`. `gate ok: N of N stages ran`.
 *   stale    — `origin/main` has moved. `gate ok (base X) — origin/main is now
 *              Y, re-run after rebasing`, exit 3. Not a failure: everything
 *              that ran, passed. It is a refusal to call the result current.
 *   unknown  — git did not answer (no binary, no remote, no network). Printed
 *              as such, exit unchanged. A gate that cannot check must not
 *              claim to have checked, and must not block a merge over its own
 *              blindness either.
 *
 * The base is `git merge-base HEAD origin/main`: the commit this branch is
 * built on. On `main` itself, and on a branch cut from an unmoved `main`, that
 * *is* `origin/main` and the run is current.
 *
 * Seams, so both interesting branches can be run on purpose:
 *   DRC_GATE_BASE=<sha>   pretend the run was based on that commit -> stale
 *   DRC_GATE_GIT=<none>   git does not resolve -> unknown
 *   DRC_GATE_NO_FETCH=1   do not touch the network; compare against the ref as
 *                         it stands, which is what an offline machine has
 */
const baseNote =
  process.env.DRC_GATE_BASE_FILE ||
  join(tmpdir(), `drc-gate-base-${createHash('sha1').update(root).digest('hex').slice(0, 12)}.json`)

/** Run a git command and return its trimmed stdout, or null. Never through a
 * pipe: `cmd | tail` reports tail's status (CLAUDE.md 1). */
function gitSay(...args) {
  const r = spawnSync(git, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (r.status !== 0 || typeof r.stdout !== 'string') return null
  const out = r.stdout.trim()
  return out.length ? out : null
}

const short = (sha) => (sha ? sha.slice(0, 8) : '?')

/** The commit this branch is built on, read before any stage runs so it
 * describes the tree they are measured against. */
const head = gitSay('rev-parse', 'HEAD')
const base = process.env.DRC_GATE_BASE || gitSay('merge-base', 'HEAD', 'origin/main')

/**
 * Is a run based on `base` still a statement about `origin/main`?
 *
 * The fetch is deliberately late — at the end of a run, or the moment
 * `--currency` is asked — because what matters is where `origin/main` is *now*,
 * when somebody is about to merge, not where it was when the run began.
 */
function currency() {
  if (!base) return { state: 'unknown', why: `${git} could not name this branch's merge-base with origin/main` }
  if (!process.env.DRC_GATE_NO_FETCH) {
    const r = spawnSync(git, ['fetch', 'origin', '--quiet'], { cwd: root, stdio: 'ignore' })
    if (r.status !== 0) {
      // Not fatal. The ref on disk is still worth comparing, and an offline
      // machine must not be told its gate means nothing. But say so: "I
      // compared against a ref I could not refresh" is a weaker claim than
      // "origin/main has not moved", and collapsing the two is the whole
      // defect this file is about.
      const stale = gitSay('rev-parse', 'origin/main')
      if (!stale) return { state: 'unknown', why: `${git} fetch failed and origin/main does not resolve` }
      return { state: stale === base ? 'current' : 'stale', remote: stale, unfetched: true }
    }
  }
  const remote = gitSay('rev-parse', 'origin/main')
  if (!remote) return { state: 'unknown', why: 'origin/main does not resolve here' }
  return { state: remote === base ? 'current' : 'stale', remote }
}

// The stage list itself, asserted before anything reads or runs it — including
// `--list`, which is a claim about what this gate is and must not be able to
// print a shorter one calmly. See EXPECTED_STAGES.
if (STAGES.length !== EXPECTED_STAGES) {
  console.error(
    `gate: the stage list holds ${STAGES.length}, and this gate is ${EXPECTED_STAGES} stages: ` +
      `${STAGES.map((s) => s.name).join(', ')}.`
  )
  console.error('gate: change EXPECTED_STAGES in the same commit that changes STAGES, or this is not the gate.')
  process.exit(2)
}

const argv = process.argv.slice(2)

if (argv.includes('--list')) {
  for (const s of STAGES) console.log(`${s.name.padEnd(12)} ${s.cmd} ${s.args.join(' ')}`)
  for (const [n, c, why] of NOT_COVERED) console.log(`${n.padEnd(12)} (not covered) ${c} - ${why}`)
  process.exit(0)
}

/**
 * `--currency`: the currency verdict on its own, running no stages.
 *
 * It exists so the three branches can be exercised deliberately in a second
 * rather than by paying for a ten-minute sweep three times — a branch nobody
 * can run on purpose is a branch nobody can prove they fixed. It is also the
 * cheap question a merger actually has: *did `main` move since I gated?*
 *
 *   node tools/gate.mjs --currency                       -> current, exit 0
 *   DRC_GATE_BASE=<an old sha> node tools/gate.mjs --currency  -> stale, exit 3
 *   DRC_GATE_GIT=nope node tools/gate.mjs --currency      -> unknown, exit 0
 *
 * The exit codes are the gate's own, so the two agree by construction.
 */
if (argv.includes('--currency')) {
  const now = currency()
  if (now.state === 'unknown') {
    console.log(`gate: could not check whether origin/main moved (${now.why}).`)
    console.log('gate: this is not a claim that anything is current, and it is not a failure either.')
    process.exit(0)
  }
  if (now.state === 'stale') {
    console.log(`gate ok (base ${short(base)}) — origin/main is now ${short(now.remote)}, re-run after rebasing`)
    process.exit(3)
  }
  console.log(
    `gate: base ${short(base)} is origin/main` +
      (now.unfetched ? ', compared against a ref this run could not refresh' : '')
  )
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
// A note from a previous run is not evidence about this one. Removed before the
// suites stage rather than after, so an absent file at the end means the run
// genuinely skipped nothing.
try {
  rmSync(partialNote, { force: true })
} catch {
  // A note that cannot be cleared is read below and reported as unknown.
}

if (base) console.log(`gate: base ${short(base)}${process.env.DRC_GATE_BASE ? ' (DRC_GATE_BASE)' : ''}`)

const started = Date.now()
const results = []

for (const stage of selected) {
  if (stage.needs && !resolves(stage.needs)) {
    console.log(`\n=== ${stage.name}: NOT RUN (${stage.needs} does not resolve) ===`)
    results.push({ ...stage, state: 'not-run', why: `${stage.needs} is not installed` })
    continue
  }
  // A stage may have a condition richer than "does this binary resolve" — the
  // Godot stage will not run when the machine is already busy with engines,
  // which is a different fact from the engine being missing and has to reach
  // the reader as a different sentence.
  let extraEnv
  if (stage.precheck) {
    const pre = stage.precheck()
    if (pre.notRun) {
      console.log(`\n=== ${stage.name}: NOT RUN (${pre.notRun}) ===`)
      results.push({ ...stage, state: 'not-run', why: pre.notRun })
      continue
    }
    extraEnv = pre.env
  }
  console.log(`\n=== ${stage.name}: ${stage.cmd} ${stage.args.join(' ')} ===`)
  const t = Date.now()
  const stageEnv = { ...extraEnv, ...(stage.env ? stage.env() : {}) }
  const r = spawnSync(stage.cmd, stage.args, {
    cwd: root,
    stdio: 'inherit',
    env: Object.keys(stageEnv).length ? { ...process.env, ...stageEnv } : process.env,
    shell: stage.shell === false ? false : process.platform === 'win32',
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

/**
 * What the suites stage skipped, if it said so. See `partialNote`.
 *
 * An unreadable note is its own answer and not a clean one: "there was no note"
 * and "there was a note I could not read" are the two states this file exists
 * to keep apart.
 */
function skippedInSuites() {
  if (!existsSync(partialNote)) return null
  try {
    const note = JSON.parse(readFileSync(partialNote, 'utf8'))
    return { count: Number(note.count) || 0, suites: Array.isArray(note.suites) ? note.suites : [] }
  } catch (error) {
    return { count: 0, suites: [], unreadable: error.message }
  }
}

const skipped = selected.some((s) => s.name === 'suites') ? skippedInSuites() : null
if (skipped) {
  const what = skipped.unreadable
    ? `the note at ${partialNote} could not be read (${skipped.unreadable})`
    : `${skipped.count} thing(s) in ${skipped.suites.join(', ')}`
  console.log(`SKIPPED suites       ${what}`)
}

const total = Math.round((Date.now() - started) / 1000)
const denom = `${ran} of ${selected.length} stages ran`
const partial = selected.length !== STAGES.length

const age = currency()
const baseTail =
  age.state === 'unknown'
    ? ` — could not check whether origin/main moved (${age.why}); this gate does not claim to be current`
    : age.unfetched
      ? ` (base ${short(base)}, compared against an origin/main this run could not refresh)`
      : ` (base ${short(base)})`

// The artefact. Small on purpose: enough for a person or a later run to say
// what this gate was a statement about, and nothing that would rot.
try {
  writeFileSync(
    baseNote,
    JSON.stringify(
      {
        schemaVersion: 1,
        when: new Date().toISOString(),
        root,
        head,
        base,
        originMain: age.remote ?? null,
        currency: age.state,
        stages: { ran, of: selected.length, partial, failed: failed.map((f) => f.name), notRun: notRun.map((f) => f.name) },
      },
      null,
      2,
    ) + '\n',
  )
} catch (error) {
  console.log(`gate: could not record the base at ${baseNote} (${error.message})`)
}

if (failed.length === 0 && notRun.length === 0) {
  // A skip is not a failure, and it is not something to end on "all passed"
  // over either — the same three states `run-tests.mjs` keeps, kept here so
  // they survive the stage boundary.
  const skipTail = skipped
    ? skipped.unreadable
      ? 'whether anything was skipped is unknown'
      : `${skipped.count} thing(s) went unchecked in ${skipped.suites.join(', ')}`
    : ''
  if (partial) {
    console.log(`\ngate: ${denom} in ${total}s, no failures — but this was --only, NOT the gate.`)
    if (skipTail) console.log(`gate: and ${skipTail}.`)
    console.log(`gate: run \`npm run gate\` with no arguments before merging.`)
    process.exit(0)
  }
  // A full run that passed, over a base `origin/main` has since left behind, is
  // its own state and its own exit code. Nothing failed — every stage that ran
  // is honestly green — but the tree it was green *about* is no longer the one
  // being merged into, and printing `gate ok` over that is the sentence #517
  // was merged on.
  if (!partial && age.state === 'stale') {
    console.log(`\ngate ok (base ${short(base)}) — origin/main is now ${short(age.remote)}, re-run after rebasing`)
    if (skipTail) console.log(`gate: and ${skipTail}.`)
    console.log(`gate: ${denom} in ${total}s and nothing failed; this is not a red, it is out of date.`)
    console.log(`gate: \`git fetch origin && git rebase origin/main\`, then run the gate again.`)
    console.log(`gate: recorded at ${baseNote}`)
    process.exit(3)
  }
  if (skipTail) {
    console.log(`\ngate: ${denom} in ${total}s, no failures — but ${skipTail}.${baseTail}`)
    console.log('gate: nothing failed, so this does not block a merge; read the skip above and decide.')
    console.log(`gate: recorded at ${baseNote}`)
    process.exit(0)
  }
  console.log(`\ngate ok: ${denom} in ${total}s.${baseTail} This is the pre-merge gate; there is no CI.`)
  console.log(`gate: recorded at ${baseNote}`)
  process.exit(0)
}

console.log(`\ngate NOT PASSED: ${denom} in ${total}s${baseTail}`)
if (failed.length > 0) console.log(`  failed:  ${failed.map((f) => f.name).join(', ')}`)
if (notRun.length > 0) {
  console.log(`  not run: ${notRun.map((f) => `${f.name} (${f.why})`).join(', ')}`)
  console.log(`  a stage that could not run is not a stage that passed.`)
}
process.exit(1)
