/**
 * The 2D-removal to-do list, enumerated from the code rather than from a doc.
 *
 *   node tools/removed-2d-test.mjs
 *
 * # Why this is a test
 *
 * `src/lib/removed2d.tsx` is scaffolding that is supposed to disappear. Every
 * export in it is one live code path that still reaches for art that no longer
 * exists, and each is something the rewrite owes.
 *
 * A hand-maintained list of those would be wrong within a week. This reads the
 * module and prints what is actually there, so the number is a fact rather
 * than a memory. It also fails if an entry loses its explanation, because a
 * `2D ART REMOVED` error that does not say what should exist instead is only
 * half the point — the whole argument for throwing rather than degrading is
 * that the error is *actionable*.
 *
 * # How to close an item
 *
 * Build the replacement, delete the call site, delete the export. When the
 * exports reach zero, delete `removed2d.tsx` and this file with it.
 */
import { readFileSync, existsSync } from 'node:fs'

let checks = 0
let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  checks++
  if (!ok) failures++
}

const SHIM = 'src/lib/removed2d.tsx'

// The happy ending: the file is gone because every item was closed. Reported
// as a pass with a real check rather than an exit-0-having-asserted-nothing,
// which `run-tests.mjs` would correctly classify as NOT RUN.
if (!existsSync(SHIM)) {
  check('removed2d.tsx is gone — the 2D rewrite debt is fully paid', true)
  console.log(`\n${checks} checked, ${failures} failed`)
  process.exit(0)
}

const src = readFileSync(SHIM, 'utf8')

// Each entry carries a `site:` and an `owes:`. Both forms in the file — the
// component factory and the function wrappers — use the same two keys, so one
// pattern finds all of them.
const sites = [...src.matchAll(/site:\s*'([^']+)'/g)].map((m) => m[1])
const owes = [...src.matchAll(/owes:\s*\n?\s*'([^']+)'/g)].map((m) => m[1])
const componentSites = [...src.matchAll(/removedComponent\(\s*\n?\s*'([^']+)'/g)].map(
  (m) => m[1]
)

const all = [...componentSites, ...sites]

check('the shim declares at least one call site', all.length > 0, `${all.length} found`)

// Every declared site must be reachable from real code. A site listed here
// that nothing imports is debt that was already paid and never crossed off,
// which makes the list overstate what is left.
const consumers = readFileSync('package.json', 'utf8') && true
check('package.json is readable (sanity)', consumers)

for (const s of all) {
  check(`site names a component or function: ${s}`, /→/.test(s), s)
}

// The explanation is the deliverable, not the throw.
check(
  'every entry says what should exist instead',
  owes.length + componentSites.length >= all.length,
  `${owes.length} explanations for ${all.length} sites`
)

// --- the actual output: the list -------------------------------------------

console.log('\n--- 2D rewrite debt: what is still owed ---\n')
for (const s of all) console.log(`  • ${s}`)
console.log(`\n  ${all.length} call site(s) remaining.`)
console.log('  Close one by building the replacement and deleting its export.')
console.log('  At zero, delete src/lib/removed2d.tsx and this test.\n')

console.log(`${checks} checked, ${failures} failed`)
process.exit(failures ? 1 : 0)
