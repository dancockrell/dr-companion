/**
 * readJSON/writeJSON, the localStorage shape six files each hand-rolled
 * independently before this existed (persistence, profiles, useMacroChoice,
 * portraits, mapDock, layout) - none of them had a test for the exact
 * property that matters: a bad value in storage degrades to the caller's
 * fallback rather than throwing, and a failing write (quota, private mode)
 * is swallowed rather than crashing whatever was in the middle of saving.
 */
// Minimal localStorage shim, same shape the other isolated tests use.
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const { readJSON, writeJSON } = await import('../src/lib/storage.ts')

let failed = 0
let checked = 0
const ok = (name, cond) => {
  checked++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}`)
  if (!cond) failed++
}

ok('absent key returns the fallback', readJSON('nope', 'fallback') === 'fallback')
writeJSON('k1', { a: 1 })
ok('round-trips an object', JSON.stringify(readJSON('k1', null)) === JSON.stringify({ a: 1 }))

store.set('junk', '{not json')
ok('malformed JSON returns the fallback, not a throw', readJSON('junk', 'safe') === 'safe')

// Simulate a full quota / private-mode write.
const realSet = localStorage.setItem
localStorage.setItem = () => {
  throw new DOMException('quota', 'QuotaExceededError')
}
let threw = false
try {
  writeJSON('k2', { b: 2 })
} catch {
  threw = true
}
ok('a failing write is swallowed, not thrown', !threw)
localStorage.setItem = realSet

ok('enough was checked for a pass to mean something', checked >= 4)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
