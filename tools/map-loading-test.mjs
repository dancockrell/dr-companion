import { readFileSync } from 'node:fs'
import { createLatestRequestGate, createRetryableCache } from '../src/lib/recoverableLoad.ts'

let failed = 0
const check = (name, condition, detail = '') => {
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

console.log('\n-- both map surfaces expose truthful loading states --')
const placeIndex = readFileSync('src/lib/placeIndex.ts', 'utf8')
const placeSearch = readFileSync('src/components/shared/PlaceSearch.tsx', 'utf8')
const browsing = readFileSync('src/lib/useZoneBrowsing.ts', 'utf8')
const notice = readFileSync('src/components/shared/ZoneLoadNotice.tsx', 'utf8')
const panel = readFileSync('src/components/shared/MapPanel.tsx', 'utf8')
const window = readFileSync('src/components/MapWindow.tsx', 'utf8')

check('a missing place index is a failure, not a valid empty world', /if \(!load\) throw new Error/.test(placeIndex))
check('place search distinguishes loading, ready, and error states', /'idle' \| 'loading' \| 'ready' \| 'error'/.test(placeSearch))
check('place search failure keeps the query and offers Retry', /Couldn’t load map data/.test(placeSearch) && />\s*Retry\s*</.test(placeSearch))
check('zone loads cover open, browse, Back, and Reset', ["'open'", "'browse'", "'back'", "'reset'"].every((operation) => browsing.includes(operation)))
check('failed transitions retain an actionable retry descriptor', browsing.includes('retryLoad.current = { ...status, apply }'))
check('zone failures identify the requested map without blanking the old one', notice.includes('Couldn’t load {error.name}') && notice.includes('current map is still here'))
check('docked and popped-out maps render the shared status', panel.includes('<ZoneLoadNotice') && window.includes('<ZoneLoadNotice'))
check('Retry is a named, keyboard-reachable button', notice.includes('type="button"') && notice.includes('aria-label={`Retry loading ${error.name}`}'))

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
