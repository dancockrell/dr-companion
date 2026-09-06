/**
 * One port, in one place — checked, rather than claimed.
 *
 * `src-tauri/src/lich.rs` has said "one number in one place" about
 * `DETACHABLE_PORT` since it was written, and it has never been true: the
 * frontend retyped `11024` in several components, and a mismatch there would
 * have the app dial a port the Lich it just launched is not holding. Nothing
 * catches that at build time, and at runtime it looks like Lich failing to
 * start.
 *
 * This is the check that makes the claim answerable. It reads the source and
 * reports three populations rather than one, because two of them are not
 * defects and folding them together would produce a check that either cries
 * wolf or has to be silenced:
 *
 *   1. **The definition.** Exactly one `11024` may exist as a value in Rust,
 *      and it must be `DETACHABLE_PORT`.
 *   2. **A different number that happens to be 11024.** `src/data/instances.ts`
 *      carries `port: 11024` for DragonRealms Prime, which is the *game
 *      server's* port at `dr.simutronics.net` — a genuine coincidence, not a
 *      copy of this constant. Deleting it would delete the game connection.
 *      Named individually here so the coincidence is recorded once rather than
 *      rediscovered by each person who greps.
 *   3. **Retyped copies of the detachable port**, which are the defect. These
 *      are listed with the increment that retires them, and the list is
 *      asserted **exactly** — a new copy fails, and so does removing one
 *      without updating this file, so the list cannot quietly rot into an
 *      allowlist nobody maintains.
 *
 * The coincidence is not rare. `src-tauri/src/eaccess.rs`'s captured `L` reply
 * carries `GAMEPORT=11024` because that is what Simutronics sends, and
 * `src-tauri/src/sal.rs` was nearly a fourth population and is deliberately
 * not one: its fixture had `GAMEPORT=11024`, the game server's port, which
 * reads identically to a retyped constant. It was changed to DR Platinum's
 * real 11124 instead, because a fixture that cannot be told apart from the bug
 * is worse than one that is merely realistic.
 *
 * Prose is excluded on purpose: a comment or a docstring saying `11024` is
 * documentation, not a second source of truth, and forbidding it would push
 * people to explain the number less.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PORT = '11024'

/** Files that carry a retyped copy of the detachable port, and who retires it. */
const KNOWN_COPIES = [
  ['src/components/game/GameConnectionBar.tsx', 'N6 — replaced by the port lich_login_launch returns'],
  ['src/components/dashboard/Dashboard.tsx', 'N6 — inside a Genie #config example that N6 deletes'],
  ['src/components/shared/WaitingForCharacter.tsx', 'N5 — inside a Genie instruction block that N5 deletes'],
  ['src/components/shared/LichLauncher.tsx', 'N5 — inside a Genie instruction block that N5 deletes'],
]

/**
 * A different number that happens to read the same. Not a copy.
 *
 * DR Prime's game port at `dr.simutronics.net` is 11024, and so is this app's
 * detachable-client port. They are unrelated, and both are real: one is
 * Simutronics', one is ours. Every entry here is a site where the number means
 * the *game server's* port.
 *
 * This list is asserted in both directions, like the copies list: an entry
 * whose file no longer carries the number fails, so it cannot rot into a
 * blanket exemption.
 */
const COINCIDENCES = [
  ['src/data/instances.ts', "dr.simutronics.net's own game port for DR Prime"],
  ['src-tauri/src/eaccess.rs', "GAMEPORT= inside the captured `L` reply fixture - what the server sends"],
]

let checked = 0
let fails = 0
const fail = (msg) => {
  fails++
  console.log(`FAIL ${msg}`)
}
const pass = (msg) => console.log(`OK   ${msg}`)

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'target' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(rs|ts|tsx)$/.test(p)) out.push(p.replace(/\\/g, '/'))
  }
  return out
}

/**
 * Lines that carry the number as a *value* rather than as prose.
 *
 * A line inside a `//`, `///`, `//!`, ` *` or `/*` comment is documentation.
 * This is deliberately crude and deliberately said so: it is a tripwire for a
 * retyped constant, not a parser, and the exact-list assertion below is what
 * actually holds the line.
 *
 * **`#` is not in that list, and the first draft of this file had it there.**
 * It is a comment marker nearly everywhere, and it is not one in either
 * language this scans — but three of the lines this exists to find are Genie
 * `#config lichport 11024` instructions inside JSX, where `#` begins a
 * *command*. Adding it silently dropped exactly the population being counted
 * and the check went green having examined one file instead of four. Same
 * inversion as `CLAUDE.md` §1's script runner, in a different domain.
 */
function valueLines(file) {
  const out = []
  const text = readFileSync(file, 'utf8')
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.includes(PORT)) return
    const t = line.trim()
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
    out.push([i + 1, t])
  })
  return out
}

const files = [...walk('src'), ...walk('src-tauri/src')]

// The denominator, asserted before anything is concluded from it. A walk that
// returned nothing would make every check below pass for the wrong reason.
checked++
if (files.length < 100) fail(`only ${files.length} source files were scanned; the walk is broken`)
else pass(`scanned ${files.length} source files under src/ and src-tauri/src/`)

const hits = new Map()
for (const f of files) {
  const lines = valueLines(f)
  if (lines.length) hits.set(f, lines)
}

// 1. The definition, and only one of it.
const coincidenceFilesAll = COINCIDENCES.map(([f]) => f)
const rustHits = [...hits].filter(([f]) => f.endsWith('.rs') && !coincidenceFilesAll.includes(f))
checked++
if (rustHits.length !== 1) {
  fail(`${PORT} appears as a value in ${rustHits.length} Rust files, expected 1: ${rustHits.map(([f]) => f).join(', ')}`)
} else {
  const [file, lines] = rustHits[0]
  const isTheConstant =
    file === 'src-tauri/src/lich.rs' &&
    lines.length === 1 &&
    /pub const DETACHABLE_PORT: u16 = 11024;/.test(lines[0][1])
  if (isTheConstant) pass(`the Rust side defines it once: ${file}:${lines[0][0]}`)
  else fail(`the single Rust hit is not the DETACHABLE_PORT definition: ${file} -> ${JSON.stringify(lines)}`)
}

// 2 and 3. Everything on the TS side, split into coincidence and copy, with
// the copy list asserted exactly in both directions.
const tsFiles = [...hits.keys()].filter((f) => !f.endsWith('.rs')).sort()
const coincidenceFiles = COINCIDENCES.filter(([f]) => !f.endsWith('.rs')).map(([f]) => f).sort()
const copyFiles = KNOWN_COPIES.map(([f]) => f).sort()
const expected = [...coincidenceFiles, ...copyFiles].sort()

checked++
const unexpected = tsFiles.filter((f) => !expected.includes(f))
if (unexpected.length) {
  fail(
    `${PORT} was retyped somewhere new: ${unexpected.join(', ')}. ` +
      `Use the port lich_login_launch returns, or add it here with the increment that retires it.`,
  )
} else pass(`no new copy of ${PORT} on the TypeScript side`)

checked++
const vanished = expected.filter((f) => !tsFiles.includes(f))
if (vanished.length) {
  fail(
    `${vanished.join(', ')} no longer contains ${PORT}, so this file is stale. ` +
      `Delete the entry — a list nobody prunes stops being read.`,
  )
} else pass(`every file this test still expects to carry ${PORT} does`)

// The copies, listed rather than merely counted, so the report says what is
// left and who owns it rather than "4 known issues".
for (const [file, owner] of KNOWN_COPIES) {
  checked++
  const lines = hits.get(file)
  if (!lines) fail(`${file} is listed as carrying ${PORT} and does not`)
  else console.log(`OK   still retyped in ${file}:${lines.map(([n]) => n).join(',')} — ${owner}`)
}

for (const [file, why] of COINCIDENCES) {
  checked++
  const lines = hits.get(file)
  if (!lines) fail(`${file} is listed as a coincidence and no longer carries ${PORT}`)
  else console.log(`OK   coincidence, not a copy: ${file}:${lines.map(([n]) => n).join(',')} — ${why}`)
}

console.log('')
const MIN_EXPECTED = 5
if (checked < MIN_EXPECTED) {
  console.error(`FAILED: only ${checked} checks ran, expected at least ${MIN_EXPECTED}`)
  process.exit(1)
}
console.log(`${checked} checked, ${fails} failed`)
if (fails) {
  console.error('FAILED')
  process.exit(1)
}
console.log('all passed')
process.exit(0)
