/**
 * readJSON/writeJSON, the localStorage shape six files each hand-rolled
 * independently before this existed (persistence, profiles, useMacroChoice,
 * portraits, mapDock, layout) - none of them had a test for the exact
 * property that matters: a bad value in storage degrades to the caller's
 * fallback while every failed write becomes observable and retryable.
 */
// Minimal localStorage shim, same shape the other isolated tests use.
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const { readJSON, retryStorageWrites, storageHealth, subscribeStorageHealth, writeJSON, writeText } = await import('../src/lib/storage.ts')

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

// Simulate a full quota. The edit remains usable in memory, but cannot be
// described as durable until a real write succeeds.
const realSet = localStorage.setItem
localStorage.setItem = () => {
  throw new DOMException('quota', 'QuotaExceededError')
}
let notices = 0
const unsubscribe = subscribeStorageHealth(() => notices++)
const quota = writeJSON('k2', { b: 2 })
ok('quota failure is returned to the caller', !quota.ok && quota.kind === 'quota')
ok('quota failure makes storage unhealthy', storageHealth().failedWrites === 1)
ok('storage-health subscribers are notified', notices === 1)

const second = writeText('k3', 'three')
ok('rapid failures retain every affected key', !second.ok && storageHealth().failedWrites === 2)
retryStorageWrites()
ok('a failed retry does not falsely clear the warning', storageHealth().failedWrites === 2)
localStorage.setItem = realSet
retryStorageWrites()
ok('successful retry clears only after verified writes', storageHealth().failedWrites === 0)
ok('retried data survives a reload-style read', readJSON('k2', null)?.b === 2 && localStorage.getItem('k3') === 'three')

const circular = {}
circular.self = circular
const serialization = writeJSON('circular', circular)
ok('serialization failure is categorized', !serialization.ok && serialization.kind === 'serialization')
retryStorageWrites()
ok('Retry never writes corrupt placeholder JSON', localStorage.getItem('circular') === null)
writeJSON('circular', { recovered: true })
ok('a later valid write verifies serialization recovery', storageHealth().failedWrites === 0)

localStorage.setItem = () => { throw new DOMException('denied', 'SecurityError') }
const security = writeText('secure', 'value')
ok('security failure is categorized', !security.ok && security.kind === 'security')
localStorage.setItem = realSet
retryStorageWrites()
ok('security failure recovers through an actual write', storageHealth().failedWrites === 0)

const storageShim = globalThis.localStorage
delete globalThis.localStorage
const unavailable = writeText('missing-storage', 'value')
ok('unavailable storage is categorized', !unavailable.ok && unavailable.kind === 'unavailable')
globalThis.localStorage = storageShim
retryStorageWrites()
ok('unavailable storage recovers only after a real write', storageHealth().failedWrites === 0)
unsubscribe()

ok('enough was checked for a pass to mean something', checked >= 15)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
