import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { JSDOM } from 'jsdom'
const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost' })
globalThis.window = dom.window; globalThis.document = dom.window.document
globalThis.localStorage = dom.window.localStorage; globalThis.HTMLElement = dom.window.HTMLElement
globalThis.IS_REACT_ACT_ENVIRONMENT = true
// Real checked-in DR graph; status changes below are explicit unit observations,
// not a claim of captured combat or a player-session replay.
const map = JSON.parse(readFileSync(new URL('../src/data/map/1.json', import.meta.url), 'utf8'))
const zone = { ok: true, zone: '1', name: map.name, here: 14, rooms: map.rooms.map((r) => ({
  id: r.id, title: r.name, x: r.x, y: r.y, z: r.z,
  moves: r.exits.map((e) => e.move), links: r.exits.map((e) => ({ to: e.to, kind: 'walk' })), to: r.exits.map((e) => e.to),
})) }
const initial = () => ({ mapZone: zone, mapHere: { id: 14 }, character: { location: { roomId: '14' }, situation: [] },
  characterAt: 100, inventory: null, bridgeConnected: true, bridgeMode: 'live', bridgeStaleSince: 0,
  bridgeSourceGeneration: 1, characterSourceGeneration: 1 })
let state = initial(), stream, log = [], blockContent = null, nativeEnabled = true, eventSequence = 0
const indicators = (at, stunned) => ({ indicators: { from: 'stream', at, value: { stunned } } })
stream = indicators(1, 'off')
const useAppStore = (select) => select(state); useAppStore.getState = () => state
mock.module('../src/store/useAppStore.ts', { namedExports: { useAppStore } })
mock.module('../src/lib/gameLink.ts', { namedExports: { subscribeGame: () => () => {}, streamCharacterState: () => stream } })
mock.module('../src/lib/worldContent.ts', { namedExports: { loadWorldContent: async () => { if (blockContent) await blockContent; return null } } })
mock.module('../src/lib/tauri.ts', { namedExports: { invokeTauri: async (command, payload) => {
  if (!nativeEnabled) return undefined
  if (command === 'publish_world_snapshot') { log.push({ type: 'snapshot', value: payload.snapshot }); return null }
  if (command === 'publish_presentation_event') { log.push({ type: 'event', value: payload.event }); return ++eventSequence }
  throw new Error(command)
} } })
const { usePresentationBridgePublisher } = await import('../src/lib/usePresentationBridgePublisher.ts')
const { resetPresentationBridgePublishState } = await import('../src/lib/presentationBridge.ts')
const { render, cleanup, act, waitFor } = await import('@testing-library/react')
function Harness({ enabled = true }) { usePresentationBridgePublisher(enabled); return null }
let checks = 0
function check(label, test) { test(); checks++; console.log(`OK   ${label}`) }
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 10)) }) }
async function fresh() { cleanup(); await flush(); resetPresentationBridgePublishState(); state = initial(); stream = indicators(1, 'off'); log = []; blockContent = null; nativeEnabled = true }
try {
  let view = render(createElement(Harness))
  await waitFor(() => assert.equal(log.filter((x) => x.type === 'snapshot').length, 1))
  check('first capture observation is a baseline, not an event', () => assert.equal(log.filter((x) => x.type === 'event').length, 0))
  stream = indicators(2, 'on'); view.rerender(createElement(Harness)); await flush()
  check('actual DR string room ID matches numeric map identity', () => assert.equal(log.filter((x) => x.type === 'event').length, 1))
  check('indicator-only change survives snapshot deduplication', () => assert.equal(log.filter((x) => x.type === 'snapshot').length, 1))
  check('confirmed snapshot is delivered before its normalized event', () => assert.deepEqual(log.map((x) => x.type), ['snapshot', 'event']))
  check('normalized event retains indicator provenance', () => assert.equal(log[1].value.authoritativeText, 'DragonRealms indicator stunned: active'))

  await fresh(); let release; blockContent = new Promise((r) => { release = r })
  view = render(createElement(Harness)); await flush()
  stream = indicators(2, 'on'); view.rerender(createElement(Harness)); await flush()
  state = { ...state, mapHere: { id: 13 }, character: { ...state.character, location: { roomId: '13' } } }
  stream = indicators(3, 'off'); view.rerender(createElement(Harness)); blockContent = null
  await act(async () => release()); await flush()
  check('navigation during content loading never publishes the old room', () => assert.ok(log.some((x) => x.type === 'snapshot') && log.every((x) => x.value.currentRoomId === '1-13')))
  check('old-room queued transition cannot animate a new room', () => assert.equal(log.filter((x) => x.type === 'event').length, 0))

  await fresh(); blockContent = new Promise((r) => { release = r })
  state = { ...state, bridgeMode: 'mock' }; view = render(createElement(Harness)); await flush()
  state = { ...state, bridgeMode: 'live', bridgeSourceGeneration: 2, characterSourceGeneration: 2 }; view.rerender(createElement(Harness))
  blockContent = null; await act(async () => release()); await flush()
  check('queued demo cannot overwrite a new live session', () => assert.ok(log.length > 0 && log.every((x) => x.value.source.kind === 'live')))

  await fresh(); blockContent = new Promise((r) => { release = r })
  view = render(createElement(Harness)); await flush()
  state = { ...state, bridgeConnected: false, bridgeStaleSince: 200 }; view.rerender(createElement(Harness))
  blockContent = null; await act(async () => release()); await flush()
  check('disconnect during content loading never republishes connected live state', () => assert.ok(log.length > 0 && log.every((x) => x.value.source.connected === false)))

  await fresh(); blockContent = new Promise((r) => { release = r })
  view = render(createElement(Harness)); await flush(); view.unmount(); blockContent = null
  await act(async () => release()); await flush()
  check('unmounted publisher cannot finish a late publication', () => assert.equal(log.length, 0))
} finally { cleanup(); dom.window.close(); mock.restoreAll() }
console.log(`presentation publisher: ${checks} checks passed`)
