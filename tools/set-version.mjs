/**
 * One version, four files.
 *
 *     node tools/set-version.mjs 0.2.0     set it everywhere
 *     node tools/set-version.mjs --check   fail if the files disagree
 *
 * The app's version is declared in `package.json`, `src-tauri/tauri.conf.json`
 * and `src-tauri/Cargo.toml`, and echoed in `src-tauri/Cargo.lock`. Nothing
 * derives any of them from the others, so a release bump done by hand is three
 * edits that must agree and one that will be rewritten by the next Rust build
 * whether or not anybody remembered it.
 *
 * They can disagree silently. The installer takes its name and its version
 * from tauri.conf.json, the About screen and the bug bundle read package.json,
 * and the crate reports Cargo.toml's - so a half-done bump ships an installer
 * called 0.2.0 containing a binary that says 0.1.1, and the first person to
 * report a bug reports the wrong version.
 *
 * Cargo.lock is included because leaving it out is worse than not touching it
 * at all: the next `cargo build` rewrites the entry to match Cargo.toml, so
 * the bump commit is followed by a stray lockfile diff nobody asked for, in
 * whichever worktree happens to build first.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const PACKAGE = 'package.json'
const TAURI_CONF = 'src-tauri/tauri.conf.json'
const CARGO_TOML = 'src-tauri/Cargo.toml'
const CARGO_LOCK = 'src-tauri/Cargo.lock'

/** The crate whose version in Cargo.lock is this app's own. */
const CRATE = 'dr-companion'

/** `1.2.3`, optionally with a pre-release tag: `1.0.0-beta.1`. */
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

/**
 * Each file's version, read the way that file actually stores it.
 *
 * Read with a parser where there is one and a narrow anchored pattern where
 * there is not. `version = "..."` appears once per package in Cargo.lock, so
 * the lock reader is anchored to this crate's own `[[package]]` block rather
 * than to the first match - which would report some dependency's version and
 * be right about nothing.
 */
function readVersions() {
  const json = (path) => {
    const value = JSON.parse(readFileSync(path, 'utf8')).version
    return typeof value === 'string' ? value : null
  }

  const cargoToml = readFileSync(CARGO_TOML, 'utf8')
  const tomlMatch = /^\[package\][\s\S]*?^version = "([^"]+)"/m.exec(cargoToml)

  const cargoLock = readFileSync(CARGO_LOCK, 'utf8')
  const lockMatch = new RegExp(`^name = "${CRATE}"\\r?\\n(?:.*\\r?\\n)*?^version = "([^"]+)"`, 'm').exec(cargoLock)

  return {
    [PACKAGE]: json(PACKAGE),
    [TAURI_CONF]: json(TAURI_CONF),
    [CARGO_TOML]: tomlMatch ? tomlMatch[1] : null,
    [CARGO_LOCK]: lockMatch ? lockMatch[1] : null,
  }
}

/**
 * Replace one occurrence, or refuse.
 *
 * A string edit that finds no anchor and writes the file unchanged reports
 * success and does nothing, which is the whole failure mode this script
 * exists to prevent - so an anchor that does not match, or matches twice,
 * is an error naming the file rather than a quiet no-op.
 */
function replaceOnce(text, pattern, replacement, what) {
  const matches = [...text.matchAll(pattern)]
  if (matches.length !== 1) {
    throw new Error(`${what}: expected exactly one match, found ${matches.length}. Refusing to write.`)
  }
  const m = matches[0]
  const before = m[0]
  const after = before.replace(m[1], replacement)
  return text.slice(0, m.index) + after + text.slice(m.index + before.length)
}

function writeVersion(version) {
  for (const path of [PACKAGE, TAURI_CONF]) {
    const text = readFileSync(path, 'utf8')
    // Edited as text rather than re-serialised: JSON.stringify would reorder
    // nothing but would reformat everything, turning a one-line version bump
    // into a whole-file diff.
    writeFileSync(path, replaceOnce(text, /"version": "([^"]+)"/g, version, path))
  }

  const toml = readFileSync(CARGO_TOML, 'utf8')
  writeFileSync(
    CARGO_TOML,
    replaceOnce(toml, /^\[package\][\s\S]*?^version = "([^"]+)"/gm, version, CARGO_TOML)
  )

  const lock = readFileSync(CARGO_LOCK, 'utf8')
  writeFileSync(
    CARGO_LOCK,
    replaceOnce(
      lock,
      new RegExp(`^name = "${CRATE}"\\r?\\n(?:.*\\r?\\n)*?^version = "([^"]+)"`, 'gm'),
      version,
      CARGO_LOCK
    )
  )
}

const arg = process.argv[2]

if (arg === '--check' || arg === undefined) {
  const versions = readVersions()
  const files = Object.keys(versions)

  // The denominator. A reader that stopped matching returns null, and four
  // nulls agree with each other perfectly - which would report a repository
  // whose version cannot be read anywhere as a repository in agreement.
  const unreadable = files.filter((f) => versions[f] === null)
  for (const file of files) {
    console.log(`${versions[file] === null ? 'FAIL' : 'OK  '} ${file.padEnd(26)} ${versions[file] ?? '(could not read a version)'}`)
  }
  if (unreadable.length) {
    console.error(`FAIL could not read a version from: ${unreadable.join(', ')}`)
    process.exit(1)
  }

  const distinct = [...new Set(files.map((f) => versions[f]))]
  if (distinct.length !== 1) {
    // Named, because "they disagree" sends somebody to open four files. The
    // majority is the likely intent, so the odd one out is the one to name.
    const counts = new Map()
    for (const f of files) counts.set(versions[f], (counts.get(versions[f]) ?? 0) + 1)
    const [expected] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
    const wrong = files.filter((f) => versions[f] !== expected)
    console.error(
      `FAIL the version disagrees. ${wrong.map((f) => `${f} says ${versions[f]}`).join('; ')}, ` +
        `where the others say ${expected}.`
    )
    console.error(`Run: node tools/set-version.mjs ${expected}`)
    process.exit(1)
  }

  if (!SEMVER.test(distinct[0])) {
    console.error(`FAIL ${distinct[0]} is not a version this can set: expected 1.2.3 or 1.0.0-beta.1`)
    process.exit(1)
  }

  console.log(`OK   all ${files.length} files declare ${distinct[0]}`)
  process.exit(0)
}

if (!SEMVER.test(arg)) {
  console.error(`Not a version: ${arg}. Expected 1.2.3, or 1.0.0-beta.1 for a pre-release.`)
  process.exit(1)
}

writeVersion(arg)

// Read it back rather than trusting the write. Four files were edited by
// string surgery; the only thing that establishes it worked is asking them.
const after = readVersions()
const wrong = Object.keys(after).filter((f) => after[f] !== arg)
if (wrong.length) {
  console.error(`FAIL wrote ${arg} but ${wrong.map((f) => `${f} reads ${after[f]}`).join('; ')}`)
  process.exit(1)
}
for (const file of Object.keys(after)) console.log(`OK   ${file.padEnd(26)} ${after[file]}`)
console.log(`\nall four files now declare ${arg}`)
