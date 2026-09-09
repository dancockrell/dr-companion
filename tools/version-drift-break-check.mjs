/**
 * Prove that `tools/set-version.mjs --check` can actually fail.
 *
 * # Why this is a suite and not a `sabotage:` line in the plan
 *
 * F2 recorded a hand sabotage ("bump one file by hand → exit 1 naming it") and
 * it was true when it was written. It was also the only thing standing between
 * this repository and a version check that had quietly stopped reading a file:
 * `readVersions` finds each version with an anchored pattern, and a pattern
 * that stops matching returns `null` — at which point the file drops out of the
 * comparison and the remaining files agree with each other perfectly.
 *
 * The script guards that with an `unreadable` list, which is the right guard.
 * Nothing had ever executed it. And on 9 September 2026 a fifth file was added
 * to the check (`src/lib/versions.ts`, whose `APP_VERSION` had been wrong by
 * two releases with nobody noticing), which is exactly the moment a
 * hand-verified sabotage note goes stale.
 *
 * # The tree is never touched
 *
 * Each case builds a complete replica of the five files in a temp directory
 * and runs the real `set-version.mjs` with that directory as its working
 * directory — the script addresses its files by relative path, so this needs
 * no seam and no environment variable. Six sessions edit this repository at
 * once; a break check that damages a tracked file and restores it afterwards
 * is one crash away from leaving somebody else's checkout broken.
 *
 *     node tools/version-drift-break-check.mjs
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const SCRIPT = join(root, 'tools', 'set-version.mjs')

/** Every file the check reads, in the same relative shape the script expects. */
const FILES = [
  'package.json',
  'src-tauri/tauri.conf.json',
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
  'src/lib/versions.ts',
]

function replica() {
  const dir = mkdtempSync(join(tmpdir(), 'drc-ver-'))
  for (const rel of FILES) {
    const dest = join(dir, rel)
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(join(root, rel), dest)
  }
  return dir
}

function check(dir) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, '--check'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: 'pipe',
    })
    return { code: 0, out: stdout }
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

let pass = 0
let fail = 0
const failures = []
function ok(label, condition, detail) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`)
  if (detail && !condition) console.log(`     ${detail}`)
  if (condition) pass++
  else {
    fail++
    failures.push(label)
  }
}

// ── The positive control ────────────────────────────────────────────────────
//
// An untouched replica must pass, and must report reading all five files. A
// check that had become impossible to pass would score every case below as a
// success, which is the failure this whole file is written against.
let currentVersion = null
{
  const dir = replica()
  const { code, out } = check(dir)
  const named = FILES.filter((f) => out.includes(f))
  const declared = /all (\d+) files declare (\S+)/.exec(out)
  currentVersion = declared ? declared[2] : null
  ok('the control: an untouched replica passes', code === 0, out.trim())
  ok(
    `the control: the check reports reading all ${FILES.length} files (${named.length} named)`,
    named.length === FILES.length,
    `missing from output: ${FILES.filter((f) => !out.includes(f)).join(', ')}`
  )
  ok('the control: the pass line carries the denominator and the version', declared !== null && Number(declared[1]) === FILES.length, out.trim())
  rmSync(dir, { recursive: true, force: true })
}

// ── One file bumped: the disagreement is caught and the odd one out is named ─
//
// The bump is made by `set-version.mjs`'s own writer, not by a string replace
// in this file, and that is the fix for a bug this check had on its first run.
// A plain `text.replace('0.1.1', '999.0.0')` hits the *first* occurrence, which
// in `Cargo.lock` is some dependency's version and in `versions.ts` is a
// version number quoted in a doc comment. Both sabotages landed, changed the
// file, and never reached the line the reader reads — so the check went green
// and reported that a bumped file is not caught. Writing through the script
// guarantees the damage is at the anchor the check looks at, and exercises the
// writer as a side effect.
for (const rel of FILES) {
  const dir = replica()
  const pristine = new Map(FILES.map((f) => [f, readFileSync(join(dir, f), 'utf8')]))
  execFileSync(process.execPath, [SCRIPT, '999.0.0'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' })
  // Put every file but this one back, leaving exactly one disagreeing.
  for (const other of FILES) {
    if (other !== rel) writeFileSync(join(dir, other), pristine.get(other))
  }
  if (readFileSync(join(dir, rel), 'utf8') === pristine.get(rel)) {
    console.error(`ABORT: writing 999.0.0 left ${rel} unchanged. The sabotage did not land.`)
    process.exit(1)
  }
  const { code, out } = check(dir)
  ok(
    `a bumped ${rel} fails the check and is named as the odd one out`,
    code === 1 && out.includes(rel) && out.includes('999.0.0'),
    `exit ${code}: ${out.trim()}`
  )
  rmSync(dir, { recursive: true, force: true })
}

// ── A reader that stopped matching must fail, not agree ─────────────────────
//
// The case the hand sabotage could never reach, and the one with teeth. Four
// readable files that agree, and a fifth the pattern can no longer find,
// looks exactly like five files in agreement unless the script counts what it
// read. `APP_VERSION` is renamed rather than deleted so the file still parses
// and nothing else notices.
{
  const dir = replica()
  const path = join(dir, 'src/lib/versions.ts')
  const text = readFileSync(path, 'utf8')
  const damaged = text.replace(
    /^export const APP_VERSION = '/m,
    "export const APP_VERSION_RENAMED = '"
  )
  if (damaged === text) {
    console.error('ABORT: the APP_VERSION declaration no longer matches this sabotage.')
    process.exit(1)
  }
  writeFileSync(path, damaged)
  const { code, out } = check(dir)
  ok(
    'a version the check can no longer read is a failure naming the file, not a silent agreement',
    code === 1 && out.includes('could not read a version') && out.includes('src/lib/versions.ts'),
    `exit ${code}: ${out.trim()}`
  )
  rmSync(dir, { recursive: true, force: true })
}

// ── A version that is not a version ─────────────────────────────────────────
{
  const dir = replica()
  for (const rel of FILES) {
    const path = join(dir, rel)
    writeFileSync(path, readFileSync(path, 'utf8').replaceAll(currentVersion, '0.1'))
  }
  const { code, out } = check(dir)
  ok(
    'five files agreeing on something that is not a semver still fails',
    code === 1 && out.includes('is not a version'),
    `exit ${code}: ${out.trim()}`
  )
  rmSync(dir, { recursive: true, force: true })
}

console.log('')
const total = pass + fail
// Below the real count (10) so a truncated run is caught without an edit each
// time a file joins the check.
const MIN_EXPECTED = 8
if (total < MIN_EXPECTED) {
  console.error(`FAILED: only ${total} checks ran, expected at least ${MIN_EXPECTED}`)
  process.exit(1)
}
console.log(`${total} checked, ${fail} failed`)
if (fail > 0) {
  console.error(`FAILED: ${failures.join(' | ')}`)
  process.exit(1)
}
console.log('all passed')
