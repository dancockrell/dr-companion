import assert from 'node:assert/strict'
import { newStreamState, feed, characterState } from '../src/lib/gameStream.ts'
import { normalizeIndicatorEvents } from '../src/lib/presentationEvents.ts'
const parser = newStreamState()
// Same captured/cross-checked protocol shape as stream-state-test.mjs;
// these are controlled transitions, not a claimed recorded combat replay.
feed(parser, "<indicator id='IconSTUNNED' visible='n'/>\r\n")
const input = { roomId: '1-14', generation: 1, ready: true, indicators: { ...characterState(parser).indicators, at: 1 } }
let result = normalizeIndicatorEvents(null, input)
assert.equal(result.events.length, 0)
console.log('OK   presentation event transition 1')
feed(parser, "<indicator id='IconSTUNNED' visible='y'/>\r\n")
result = normalizeIndicatorEvents(result.cursor, { ...input, indicators: { ...characterState(parser).indicators, at: 2 } })
assert.deepEqual(result.events, [{ roomId: '1-14', kind: 'status-change', authoritativeText: 'DragonRealms indicator stunned: active' }])
console.log('OK   presentation event transition 2')
const active = result.cursor
assert.equal(normalizeIndicatorEvents(active, { ...input, indicators: { from: 'stream', at: 3, value: { stunned: 'unknown' } } }).events.length, 0)
console.log('OK   presentation event transition 3')
assert.equal(normalizeIndicatorEvents(active, { ...input, generation: 2, indicators: { from: 'stream', at: 3, value: { stunned: 'off' } } }).events.length, 0)
console.log('OK   presentation event transition 4')
assert.equal(normalizeIndicatorEvents(active, { ...input, roomId: '1-13', indicators: { from: 'stream', at: 3, value: { stunned: 'off' } } }).events.length, 0)
console.log('OK   presentation event transition 5')
assert.equal(normalizeIndicatorEvents(active, { ...input, ready: false }).cursor, null)
console.log('OK   presentation event transition 6')
assert.equal(normalizeIndicatorEvents(active, { ...input, indicators: { from: 'bridge', at: 3, value: { stunned: 'off' } } }).events.length, 0)
console.log('OK   presentation event transition 7')
assert.equal(normalizeIndicatorEvents(active, { ...input, indicators: { from: 'stream', at: 1, value: { stunned: 'off' } } }).events.length, 0)
console.log('OK   presentation event transition 8')
assert.equal(normalizeIndicatorEvents(active, { ...input, indicators: { from: 'stream', at: 3, value: { stunned: 'off' } } }).events[0].authoritativeText, 'DragonRealms indicator stunned: cleared')
console.log('OK   presentation event transition 9')
const unknown = normalizeIndicatorEvents(active, { ...input, indicators: { from: 'stream', at: 3, value: { stunned: 'unknown' } } }).cursor
assert.equal(normalizeIndicatorEvents(unknown, { ...input, indicators: { from: 'stream', at: 4, value: { stunned: 'off' } } }).events.length, 0)
console.log('OK   presentation event transition 10')
assert.equal(normalizeIndicatorEvents(active, { ...input, indicators: { from: 'stream', at: 2, value: { stunned: 'off' } } }).events.length, 1)
console.log('OK   presentation event transition 11')
console.log('presentation events: 11 checks passed')
