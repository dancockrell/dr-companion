import assert from 'node:assert/strict'
import { failedAction, failedResource, fulfilledResource, idleAction, idleResource, LatestOperation, loadingResource, pendingAction, succeededAction } from '../src/lib/asyncState.ts'

let checks = 0
function check(label: string, run: () => void) { try { run(); checks++; console.log(`OK   ${label}`) } catch (error) { console.error(`FAIL ${label}`); throw error } }
const idle = idleResource<string[]>()
check('idle differs from successful empty', () => assert.notEqual(idle.state, fulfilledResource([], (v) => v.length === 0).state))
const loading = loadingResource(idle)
check('loading differs from empty and failure', () => assert.deepEqual(loading, { state: 'loading', value: null, error: null }))
const ready = fulfilledResource(['one'], (v) => v.length === 0)
check('non-empty success becomes ready', () => assert.equal(ready.state, 'ready'))
check('empty success becomes empty', () => assert.equal(fulfilledResource([], (v) => v.length === 0).state, 'empty'))
check('first-load rejection becomes error', () => assert.equal(failedResource(loading, new Error('offline')).state, 'error'))
check('refresh rejection retains stale data', () => assert.deepEqual(failedResource(ready, new Error('offline')), { state: 'stale', value: ['one'], error: 'offline' }))
check('actions have explicit idle, pending, success, and failure transitions', () => {
  assert.equal(idleAction().state, 'idle')
  assert.equal(pendingAction(12).state, 'pending')
  assert.equal(succeededAction(12).state, 'succeeded')
  assert.deepEqual(failedAction(12, new Error('refused')), { state: 'failed', operationId: 12, error: 'refused' })
})
const latest = new LatestOperation<string>()
const first = latest.begin('map'); const retry = latest.begin('map')
check('retry supersedes earlier operation', () => assert.equal(latest.isCurrent('map', first), false))
check('late completion cannot finish retry', () => assert.equal(latest.finish('map', first), false))
check('latest completion finishes once', () => { assert.equal(latest.finish('map', retry), true); assert.equal(latest.finish('map', retry), false) })
console.log(`async state: ${checks} checks passed`)
