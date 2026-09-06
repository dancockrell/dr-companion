/**
 * The #464 debug-only knobs, in the configuration that ships.
 *
 * # Why this exists
 *
 * `[profile.release]` in `src-tauri/Cargo.toml` sets no `debug-assertions`, so
 * `cfg!(debug_assertions)` is false in a `tauri build` and true in `tauri dev`.
 * Issue #464 put two environment overrides behind that flag — the eaccess
 * endpoint (`credentials.rs`) and the dry-run sign-in (`lich.rs`) — and wrote a
 * test for each that is meaningful in *both* configurations: under `cargo test`
 * it proves the knob is read at all, under `cargo test --release` it proves a
 * shipped binary cannot be told from its environment to fake a sign-in.
 *
 * Only one of those two runs was ever automated. `tools/gate.mjs`'s `rust-tests`
 * stage is a debug `cargo test`, and issue #488 measured what that misses:
 * deleting the dry-run gate call from `lich.rs` left the whole gate green — full
 * debug `cargo test` 226 passed, `npm run test:privacy` 8 checked 0 failed — and
 * only `cargo test --release` caught it. A test whose load-bearing configuration
 * nothing runs is a test that is not in the gate.
 *
 * # Why a script and not a raw cargo line in the stage list
 *
 * Because the stage is a *filtered* run, and a filter is a chooser: `cargo test
 * -- --exact <name>` that matches nothing prints `0 passed; 0 failed` and exits
 * **0**. Renaming one of the two tests — which has already happened once in this
 * area, see the stale ignore reason #488 §5 found — would silently reduce this
 * stage to checking nothing while the gate went on saying it ran. So the count
 * is asserted against {@link KNOBS}, and a run that did not execute both named
 * tests is a failure naming the one that did not appear.
 *
 * # Cost
 *
 * Measured on this machine in a clean worktree: 2m13s cold (the release profile
 * has to build the crate and its dependencies once), about 68s after a Rust
 * source file changes, 0.4s when nothing has. The two tests themselves take
 * 0.00s — the whole cost is the release build, which is why this filters rather
 * than running the full release suite: the extra coverage would be free, but a
 * stage that can redden for an unrelated reason no longer says what it means
 * when it goes red.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = resolve(root, 'src-tauri', 'Cargo.toml')

/**
 * The tests this stage is. Fully qualified, so `--exact` can be used and a
 * partial name cannot quietly match a different test.
 *
 * Overridable so the empty-filter branch above can be run on purpose rather
 * than promised: `DRC_RELEASE_KNOB_TESTS=nonesuch::tests::nothing node
 * tools/rust-release-knobs.mjs` must exit non-zero naming that name. A branch
 * nobody can execute is a branch nobody can prove they fixed.
 */
const KNOBS = (process.env.DRC_RELEASE_KNOB_TESTS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
if (KNOBS.length === 0) {
  KNOBS.push('credentials::tests::the_endpoint_overrides_are_debug_only', 'lich::tests::the_dry_run_knob_is_debug_only')
}

if (!existsSync(manifest)) {
  console.error(`rust-release-knobs: ${manifest} is missing; this is not a dr-companion checkout.`)
  process.exit(2)
}

const args = ['test', '--release', '--lib', '--manifest-path', manifest, '--', '--exact', ...KNOBS]
console.log(`rust-release-knobs: cargo ${args.join(' ')}`)
// No `shell: true`: `cargo` resolves as an executable, the arguments include a
// Windows path with spaces in it, and handing that to cmd.exe unescaped is both
// a quoting bug waiting to happen and Node's DEP0190.
const run = spawnSync('cargo', args, { encoding: 'utf8' })

// Read the status directly, never through a pipe, and treat a null status (the
// process was killed, or cargo is not installed) as a failure rather than a zero.
if (run.status === null) {
  console.error(`rust-release-knobs: cargo did not run to completion (${run.error?.message ?? 'killed'}).`)
  process.exit(2)
}
const out = `${run.stdout ?? ''}${run.stderr ?? ''}`
process.stdout.write(out)

// The denominator. Each named test must appear in the output with a verdict of
// its own; the summary line's count is not enough, because a filter that
// matched one of the two would print `1 passed` and exit 0.
const missing = KNOBS.filter((name) => !new RegExp(`^test ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\.\\.\\.`, 'm').test(out))
if (missing.length > 0) {
  console.error(
    `rust-release-knobs: ${missing.length} of ${KNOBS.length} named tests did not run: ${missing.join(', ')}.`
  )
  console.error('rust-release-knobs: a filter that matches nothing exits 0, so this is a failure and not a skip.')
  process.exit(1)
}

if (run.status !== 0) {
  console.error(`rust-release-knobs: cargo exited ${run.status}.`)
  process.exit(run.status)
}

console.log(`rust-release-knobs ok: ${KNOBS.length} of ${KNOBS.length} release-mode knob tests ran and passed.`)
