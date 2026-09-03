/**
 * The stale watch: does it recover, and does it stay quiet while stalled?
 *
 *   node tools/stale-watch-test.mjs
 *
 * `live-bridge-test.mjs` proves the client and the Ruby bridge agree on the
 * protocol. This proves something the protocol cannot: that the client's
 * *judgement about the link* is reversible.
 *
 * # The bug this exists to hold down
 *
 * An open socket says nothing about whether the game is alive, so RealBridge
 * watches whether the in-game clock advances. The original watch recorded its
 * verdict by calling `setStatus('error')` and nothing else — the judgement and
 * the report were the same variable. Two consequences, both live in shipped
 * code:
 *
 *   1. The watch's guard was `status !== 'connected'`, so firing once
 *      disqualified every later tick. It could latch, and could not unlatch.
 *   2. The only route back to 'connected' was a socket close and a fresh
 *      open. So a character standing still for two minutes — a bank, a shop,
 *      reading a book, going to make tea — put the panel into a permanent
 *      "the game may have hung" until the link actually dropped.
 *
 * That is the mirror image of the failure the watch was written to prevent.
 * Stale data claims a dead link is alive; this claimed a live link was dead,
 * and kept claiming it. Both are the panel asserting something false about the
 * connection, which for a combat panel is the whole ballgame.
 *
 * # Why a real socket rather than a stub
 *
 * The recovery path deliberately checks `readyState === OPEN` before restoring
 * 'connected', so that a clock tick arriving after the link dropped cannot
 * overwrite a truthful disconnect. A stubbed socket with a hand-set
 * `readyState` would let that check pass or fail by fiat and prove nothing.
 * A real `ws` server makes the state real.
 *
 * Timings are injected (120ms stale, 40ms tick) because the shipping values
 * are 90s and 15s. A test that waits ninety seconds is a test nobody runs,
 * and an unrun test is how this bug survived in the first place.
 *
 * # Why the Tauri mock is load-bearing, and not just convenience
 *
 * `realBridge.ts` imports `../lib/tauri` with no extension, which Node's ESM
 * resolver cannot follow. `mock.module` registering the `.ts` path is what
 * makes the specifier resolvable at all — the same trick `backlog-test.mjs`
 * uses for `gameLink.ts`. Worth stating plainly: until something did this,
 * this module was not importable by the test runner *at any price*, which is
 * the mechanical reason the transport went unexercised while carrying a bug.
 *
 * Run: node --experimental-test-module-mocks tools/stale-watch-test.mjs
 */
import { mock } from 'node:test'
import { WebSocketServer } from 'ws'

let fails = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  if (!ok) fails++
}

if (typeof WebSocket === 'undefined') {
  console.log('SKIP this Node has no global WebSocket (needs 22+)')
  process.exit(0)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// --- a server that only ever answers `get_status`, with a clock we control ---

const PORT = 7896
const wss = new WebSocketServer({ port: PORT })

/** The game clock we hand out. Frozen by the test to simulate a hung game. */
let gameTime = 1000
let socket = null

wss.on('connection', (ws) => {
  socket = ws
  ws.on('message', () => {})
})

const sendStatus = () => {
  if (socket && socket.readyState === 1) {
    socket.send(JSON.stringify({ type: 'status', payload: { gameTime } }))
  }
}

// --- drive the app's own RealBridge -----------------------------------------

// No Tauri here, so the token read returns nothing and the bridge connects
// without one — which is the browser/dev path the class already supports.
const stub = { invokeTauri: async () => '' }
// node:test renamed this option between releases: `namedExports` on 22,
// `exports` on 24. Same reasoning as backlog-test.mjs, same version check.
const nodeMajor = Number(process.versions.node.split('.')[0])
mock.module(
  '../src/lib/tauri.ts',
  nodeMajor >= 24 ? { exports: stub } : { namedExports: stub }
)

const { RealBridge } = await import('../src/bridge/realBridge.ts')

const seen = []
const bridge = new RealBridge(`ws://127.0.0.1:${PORT}/companion`, {
  staleAfterMs: 120,
  staleTickMs: 40,
})
bridge.onStatus((s, detail) => seen.push({ s, detail }))
bridge.connect()

// Let it connect and take a first clock reading.
await sleep(200)
gameTime += 1
sendStatus()
await sleep(60)
check(
  'connects and reports connected',
  bridge.getStatus() === 'connected',
  bridge.getStatus()
)

// --- stall the clock --------------------------------------------------------
// Keep sending status, but never advance gameTime. This is precisely the case
// the watch is for: the bridge is talking, the game is not moving.

for (let i = 0; i < 8; i++) {
  sendStatus()
  await sleep(40)
}

check(
  'a frozen clock is reported as an error',
  bridge.getStatus() === 'error',
  bridge.getStatus()
)

const staleReports = seen.filter((e) => e.s === 'error').length
check(
  'the stall is announced once, not once per tick',
  staleReports === 1,
  `${staleReports} error statuses`
)

// --- the clock moves again --------------------------------------------------
// This is the assertion that would have failed before the fix: nothing in the
// old code could take this path back to 'connected'.

gameTime += 1
sendStatus()
await sleep(80)

check(
  'recovers to connected when the clock moves again',
  bridge.getStatus() === 'connected',
  bridge.getStatus()
)

// --- and can report a second, later stall -----------------------------------
// Recovery must not be one-shot either. A watch that unlatches once and then
// goes quiet is the same defect wearing a different hat.

for (let i = 0; i < 8; i++) {
  sendStatus()
  await sleep(40)
}

check(
  'a second stall is reported after a recovery',
  bridge.getStatus() === 'error',
  bridge.getStatus()
)

bridge.disconnect()
wss.close()
await sleep(50)

console.log(fails ? `\n${fails} failure(s)` : '\nall good')
process.exit(fails ? 1 : 0)
