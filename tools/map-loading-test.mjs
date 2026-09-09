import { readFileSync } from 'node:fs'
import { createLatestRequestGate, createRetryableCache } from '../src/lib/recoverableLoad.ts'

let checked = 0
let failed = 0
const check = (name, condition, detail = '') => {
  checked++
  if (!condition) failed++
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${name.padEnd(62)}${detail}`)
}

console.log('-- rejected resource loads can recover in the same session --')
let attempts = 0
const cache = createRetryableCache(async () => {
  attempts++
  if (attempts === 1) throw new Error('transient chunk failure')
  return []
})

let rejected = false
try {
  await cache.load()
} catch {
  rejected = true
}
const recovered = await cache.load()
const cached = await cache.load()
check('the initial rejection reaches the caller', rejected)
check('Retry starts a fresh request and accepts an empty result', attempts === 2 && recovered.length === 0)
check('a successful empty result is cached rather than refetched', cached === recovered && attempts === 2)

console.log('\n-- concurrent and out-of-order loads have one visible owner --')
let release
let sharedAttempts = 0
const concurrent = createRetryableCache(() => {
  sharedAttempts++
  return new Promise((resolve) => {
    release = resolve
  })
})
const first = concurrent.load()
const second = concurrent.load()
check('concurrent callers share one in-flight request', first === second && sharedAttempts === 1)
release(['ready'])
await first

const gate = createLatestRequestGate()
const visible = []
const older = gate.next()
const newer = gate.next()
if (gate.isCurrent(newer)) visible.push('newer')
if (gate.isCurrent(older)) visible.push('older')
check('a late older zone cannot replace the newer request', visible.join(',') === 'newer')

console.log('\n-- the surviving place search still tells the truth about loading --')
/*
 * The map surfaces this section used to check are gone (docs/NO-3D.md), and
 * with them `useZoneBrowsing`, `ZoneLoadNotice`, `MapPanel` and `MapWindow`.
 * `PlaceSearch` is not: `ScenePanel` renders it, so the loading and error
 * states it was given still reach a player and are still worth asserting.
 *
 * The checks naming a deleted file were deleted rather than loosened. A
 * source check against a file that no longer exists cannot fail for the
 * right reason - it throws before it asserts anything, which reads as a
 * broken suite rather than as a missing feature.
 */
const placeIndex = readFileSync('src/lib/placeIndex.ts', 'utf8')
const placeSearch = readFileSync('src/components/shared/PlaceSearch.tsx', 'utf8')

check('a missing place index is a failure, not a valid empty world', /if \(!load\) throw new Error/.test(placeIndex))
check('place search distinguishes loading, ready, and error states', /'idle' \| 'loading' \| 'ready' \| 'error'/.test(placeSearch))
check('place search failure keeps the query and offers Retry', /Couldn’t load map data/.test(placeSearch) && />\s*Retry\s*</.test(placeSearch))

console.log('')
// Far below the real count on purpose: a tripwire for a truncated or
// half-loaded run, not a regression test on the number of cases.
const MIN_EXPECTED = 8
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
