import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const dir = mkdtempSync(join(tmpdir(), 'splitter-range-'))
const out = join(dir, 'splitter-range.mjs')
writeFileSync(out, ts.transpileModule(readFileSync('src/lib/splitterRange.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText)
const m = await import(pathToFileURL(out).href)

let checked = 0
let failed = 0
const check = (name, got, want) => {
  checked++
  const pass = JSON.stringify(got) === JSON.stringify(want)
  if (!pass) failed++
  console.log(`${pass ? 'OK  ' : 'FAIL'} ${name}${pass ? '' : ` got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

check('normal bounds remain ordered', m.splitterRange(0.2, 0.8), { min: 0.2, max: 0.8 })
check('equal bounds remain a stable point', m.splitterRange(0.5, 0.5), { min: 0.5, max: 0.5 })
check('reversed bounds cannot create an impossible range', m.splitterRange(0.7, 0.3), { min: 0.3, max: 0.7 })
check('values clamp to the normalized minimum', m.clampSplitterValue(-2, { min: 0.3, max: 0.7 }), 0.3)
check('values clamp to the normalized maximum', m.clampSplitterValue(2, { min: 0.3, max: 0.7 }), 0.7)

const splitterSource = readFileSync('src/components/layout/Splitter.tsx', 'utf8')
const appSource = readFileSync('src/App.tsx', 'utf8')
const labels = [...appSource.matchAll(/<Splitter[\s\S]*?label="([^"]+)"/g)].map((match) => match[1])
check(
  'separator exposes its complete range and value text',
  /aria-valuemin/.test(splitterSource) && /aria-valuemax/.test(splitterSource) && /aria-valuetext/.test(splitterSource),
  true
)
// One, not two, not three. The third was 'Resize the map and the battle
// picture', the board slot's horizontal divider, which went with the map
// (docs/NO-3D.md); the second was the divider between the character rail and
// the board slot, and it went with the play-first frame (9 Sep 2026), whose
// workspace is the text and one rail with a single divider between them.
//
// Both numbers are asserted rather than only the distinctness, so a separator
// that silently stopped being rendered fails here instead of quietly shrinking
// the population this check runs against - which is the whole reason the count
// is written down and updated deliberately each time rather than derived.
check('every app separator has a distinct contextual name', [labels.length, new Set(labels).size], [1, 1])
check(
  'keyboard contract handles both limits without page scrolling',
  /'Home', 'End'/.test(splitterSource) && /e\.preventDefault\(\)/.test(splitterSource),
  true
)

console.log('')
// Far below the real count on purpose: a tripwire for a truncated or
// half-loaded run, not a regression test on the number of cases.
const MIN_EXPECTED = 5
if (checked < MIN_EXPECTED) {
  console.error(`FAILED: only ${checked} checks ran, expected at least ${MIN_EXPECTED}`)
  process.exit(1)
}
// `checked`, not a pass count: the denominator has to be the number of
// checks that ran, or it shrinks by one per failure and reports a smaller
// suite on exactly the run where you need to know the size did not change.
console.log(`${checked} checked, ${failed} failed`)
if (failed) {
  console.error('FAILED')
  process.exit(1)
}
console.log('all passed')
process.exit(0)
