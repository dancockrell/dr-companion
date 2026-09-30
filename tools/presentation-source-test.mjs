import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { presentationSourceForState } from '../src/lib/presentationSource.ts'
let checks = 0
function check(label, value) { assert.ok(value, label); checks++; console.log(`OK   ${label}`) }
const live = { mode: 'live', connected: true, hasCharacter: true, staleSince: 0, bridgeGeneration: 1, characterGeneration: 1 }
check('fresh same-session character permits a live source', presentationSourceForState(live).connected)
check('disconnect immediately removes live readiness', !presentationSourceForState({ ...live, connected: false }).connected)
check('new socket cannot revive previous-session character', !presentationSourceForState({ ...live, bridgeGeneration: 2 }).connected)
check('script-list freshness cannot revive previous-session character', !presentationSourceForState({ ...live, bridgeGeneration: 2, staleSince: 0 }).connected)
check('fresh character in current connection restores readiness', presentationSourceForState({ ...live, bridgeGeneration: 2, characterGeneration: 2 }).connected)
check('stale badge keeps source unavailable', !presentationSourceForState({ ...live, staleSince: 135 }).connected)
check('empty character never claims readiness', !presentationSourceForState({ ...live, hasCharacter: false }).connected)
check('demo identity remains explicit', presentationSourceForState({ ...live, mode: 'mock' }).kind === 'demo')
check('initial socket without payload is unavailable', !presentationSourceForState({ ...live, bridgeGeneration: 0, characterGeneration: -1, hasCharacter: false }).connected)
mock.module('../src/bridge/index.ts', { namedExports: { bridge: {
  getLiveAttempt: () => 0, getLiveMaxAttempts: () => 8, getLiveEverConnected: () => true,
} } })
const { applyLiveStatus } = await import('../src/store/bridgeLifecycle.ts')
let state = { bridgeConnected: true, bridgeSourceGeneration: 1, characterSourceGeneration: 1, character: {}, scriptStates: [], bridgeStaleSince: 0 }
const set = (patch) => { state = { ...state, ...patch } }
const get = () => state
applyLiveStatus('disconnected', set, get, 100)
applyLiveStatus('connected', set, get, 101)
// Simulate scripts arriving before status, and an observer seeing only the final batched state.
state.bridgeStaleSince = 0
check('store advances epoch even if observer misses disconnect render', state.bridgeSourceGeneration === 2)
check('batched reconnect plus scripts cannot authorize old character', !presentationSourceForState({ ...live, bridgeGeneration: state.bridgeSourceGeneration, characterGeneration: state.characterSourceGeneration, staleSince: state.bridgeStaleSince }).connected)
mock.restoreAll()
console.log(`presentation source: ${checks} checks passed`)
