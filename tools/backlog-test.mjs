#!/usr/bin/env node
/**
 * The game pane must survive a remount without losing the session.
 *
 * # The bug this exists to stop coming back
 *
 * `game:line` is a Tauri event, and an event fires once. Rust begins reading
 * the socket the instant `game_attach` returns, so every chunk delivered
 * before this module subscribed was gone outright - while `game:state` kept
 * carrying the running total, so the header counted lines the pane could not
 * show.
 *
 * Measured against a live DragonRealms session on 28 Aug 2026: the header read
 * `245 lines` directly above a pane rendering its "Nothing yet. Start Lich
 * with --detachable-client=..." empty state. Both were telling the truth about
 * different things, which is why it survived - it reads as "not attached yet"
 * rather than as a defect.
 *
 * Every dev-mode HMR remount that reloads this module reaches that state, and
 * so does every window reload in a release build. The text most often lost is
 * the worst text to lose: Lich replays the room description, the vitals and
 * the character's state on attach, which is exactly what arrives before a
 * freshly-mounted pane is listening.
 *
 * # What is asserted
 *
 * Properties, not mechanism. A test that asserted "game_backlog was called"
 * would pass against an implementation that threw the reply away.
 *
 *   - text that arrived before subscribing reaches the buffer
 *   - a chunk present in BOTH the backlog and the live stream renders once
 *   - a chunk newer than the backlog is not lost to the merge
 *   - chunks Rust could not retain are counted, not silently skipped
 *   - a backlog request that FAILS still delivers the live text
 *
 * That last one is the one worth having. Stranding live chunks in the queue
 * would turn a recoverable display bug into a pane that never renders again,
 * which is strictly worse than the bug being fixed.
 *
 * # Why a fresh module per case
 *
 * `wire()` runs once per module lifetime, and that is correct: `wired` and the
 * buffer share that lifetime, so a remount that reloads the module backfills,
 * and one that does not still has its buffer. Re-subscribing to a live module
 * therefore must NOT re-backfill, and a test that called `subscribeGame` twice
 * against one instance would be asserting the opposite. Each case imports its
 * own instance instead.
 *
 * Run: node --experimental-test-module-mocks tools/backlog-test.mjs
 */
import { mock } from 'node:test'
import { readFileSync } from 'node:fs'

let checks = 0
let failures = 0

// Reported as `OK` / `FAIL` at column 0, because tools/run-tests.mjs counts
// those to establish a suite's denominator. Printing a passing check only as a
// silent absence made this whole file read as NOT RUN - "exited 0 but
// performed no checks" - which is the runner correctly refusing to call a
// suite that asserted nothing a pass.
function ok(cond, what) {
  checks++
  if (cond) {
    console.log(`OK   ${what}`)
  } else {
    failures++
    console.log(`FAIL ${what}`)
  }
}

function eq(actual, expected, what) {
  ok(
    actual === expected,
    actual === expected
      ? what
      : `${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  )
}

// notify() coalesces on a frame. There are no frames here, so run the callback
// on a macrotask, which keeps the "one update per burst" behaviour intact.
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0)

/** Handlers gameLink installs, so this test can play the part of Rust. */
const handlers = new Map()

let backlogReply = { lines: [], dropped: 0 }
let backlogThrows = false

const stub = {
  isTauri: () => true,
  listenTauri: (name, fn) => {
    handlers.set(name, fn)
    return () => handlers.delete(name)
  },
  invokeTauri: async (cmd) => {
    if (cmd === 'game_backlog') {
      if (backlogThrows) throw new Error('backend unreachable')
      return backlogReply
    }
    if (cmd === 'game_attach' || cmd === 'game_detach' || cmd === 'game_status') {
      return { connected: cmd === 'game_attach', host: '', port: 0, lines: 0, note: '' }
    }
    return undefined
  },
  setAlwaysOnTop: async () => {},
  getBridgeDefaultUrl: async () => '',
}

/*
 * node:test renamed this option between releases: `namedExports` on Node 22,
 * `exports` on 24, where the old name is deprecated.
 *
 * Passing the wrong one is not a warning. The replacement module ends up with
 * no named exports at all, so the failure is a link error thrown by the module
 * loader at import time, naming neither this file nor the option - CI reported
 * only "the test file does not parse". It cost a full CI round trip to place.
 *
 * Chosen by version rather than passing both, so neither runtime prints a
 * deprecation warning into the suite output.
 */
const nodeMajor = Number(process.versions.node.split('.')[0])
mock.module('../src/lib/tauri.ts', nodeMajor >= 24 ? { exports: stub } : { namedExports: stub })

let caseNo = 0
async function freshLink() {
  caseNo++
  return await import(`../src/lib/gameLink.ts?case=${caseNo}`)
}

const NL = String.fromCharCode(10)
const chunk = (seq, text, receivedAtMs = 1_700_000_000_000 + seq) => ({ seq, receivedAtMs, text: text + NL })
const settle = () => new Promise((r) => setTimeout(r, 30))
const texts = (L) => L.gameLines().map((l) => l.text)

/** Play Rust: deliver a chunk the way the event plugin would. */
function deliver(c) {
  const fn = handlers.get('game:line')
  if (!fn) throw new Error('gameLink never subscribed to game:line')
  fn(c)
}

console.log('backlog backfill')

// --------------------------------------------------------- positive control
//
// Before reading any "0 lines" below as a fact about the code, prove this rig
// can carry a line at all. Without this, a broken harness and a broken
// backfill produce identical output.
{
  backlogReply = { lines: [chunk(1, 'you are standing in a garden.')], dropped: 0 }
  const L = await freshLink()
  L.subscribeGame(() => {})
  await settle()
  eq(texts(L).length, 1, 'control: the rig can deliver a line at all')
  eq(texts(L)[0], 'you are standing in a garden.', 'control: the text arrives intact')
}

// ------------------------------------------------- text from before subscribe
{
  backlogReply = {
    lines: [chunk(1, 'a rusty gate.'), chunk(2, 'obvious exits: north.')],
    dropped: 0,
  }
  const L = await freshLink()
  L.subscribeGame(() => {})
  await settle()
  eq(texts(L).length, 2, 'chunks emitted before subscribing are recovered')
  ok(texts(L).includes('a rusty gate.'), 'the recovered text is the real text')
  eq(L.gameLines()[0].receivedAtMs, 1_700_000_000_001, 'the first recovered line keeps its native receive time')
  eq(L.gameLines()[1].receivedAtMs, 1_700_000_000_002, 'distinct backfill times remain distinct')
}

// One native chunk can produce several display lines and stream tags can
// change classification inside it. Every derived line keeps the one honest
// receive time; seq remains their identity and order.
{
  const at = 1_700_123_456_789
  backlogReply = { lines: [chunk(1, "<pushStream id='thoughts'/>First thought.\nSecond thought.<popStream/>", at)], dropped: 0 }
  const L = await freshLink()
  L.subscribeGame(() => {})
  await settle()
  const thoughts = L.gameLines().filter((line) => line.stream === 'thoughts')
  eq(thoughts.length, 2, 'timestamp capture survives parser channel classification')
  ok(thoughts.every((line) => line.receivedAtMs === at), 'display lines inherit their native chunk receive time')
  ok(thoughts[0].seq < thoughts[1].seq, 'sequence remains the display ordering authority')
}

// ------------------------------------------------------------ no double-apply
//
// The race the queue exists for: a chunk arrives live while the backlog
// request is still in flight, and the backlog also contains it.
{
  backlogReply = { lines: [chunk(1, 'the gate creaks.')], dropped: 0 }
  const L = await freshLink()
  L.subscribeGame(() => {})
  deliver(chunk(1, 'the gate creaks.'))
  await settle()
  eq(texts(L).length, 1, 'a chunk in both the backlog and the live stream renders once')
}

// -------------------------------------------------------- newer than backlog
{
  backlogReply = { lines: [chunk(1, 'first.')], dropped: 0 }
  const L = await freshLink()
  L.subscribeGame(() => {})
  deliver(chunk(2, 'second.'))
  await settle()
  eq(texts(L).length, 2, 'a chunk newer than the backlog survives the merge')
  eq(texts(L)[1], 'second.', 'and keeps its order')
}

// ----------------------------------------------------------- dropped counted
{
  backlogReply = { lines: [chunk(500, 'late in the session.')], dropped: 87 }
  const L = await freshLink()
  L.subscribeGame(() => {})
  await settle()
  eq(L.gameDropped(), 87, 'chunks Rust could not retain are counted, not hidden')
}

// ------------------------------------------- full long-session recovery depth
// Substantially beyond the old 2,000-chunk native cap. A fresh module is the
// frontend-reload boundary: nothing from an earlier JS buffer can help it.
{
  const count = 12_000
  backlogReply = {
    lines: Array.from({ length: count }, (_, i) => chunk(i + 1, `A realistic room line ${i + 1}: the copper lantern throws a long shadow across the cobblestones.`)),
    dropped: 0,
  }
  const payloadBytes = Buffer.byteLength(JSON.stringify(backlogReply))
  const L = await freshLink()
  L.subscribeGame(() => {})
  await settle()
  eq(texts(L).length, count, 'a fresh frontend recovers substantially more than the old 2,000-chunk cap')
  eq(L.gameDropped(), 0, 'full retained recovery does not invent dropped history')
  ok(payloadBytes < 4 * 1024 * 1024, `12,000 realistic recovery chunks serialize below 4 MiB (${(payloadBytes / 1024 / 1024).toFixed(2)} MiB measured)`)
}

// The two caps are deliberately different units, but the native raw-chunk
// recovery budget may never be smaller than the display-line promise.
{
  const rust = readFileSync('src-tauri/src/game_link.rs', 'utf8')
  const frontend = readFileSync('src/lib/gameLink.ts', 'utf8')
  const nativeCap = Number(rust.match(/const BACKLOG_MAX: usize = ([\d_]+);/)?.[1].replaceAll('_', ''))
  const displayCap = Number(frontend.match(/const MAX_LINES = ([\d_]+)/)?.[1].replaceAll('_', ''))
  ok(nativeCap >= displayCap, `native recovery budget ${nativeCap} covers display budget ${displayCap}`)
}

// -------------------------------------------- a failed backlog must not strand
//
// The one that matters most. If the request throws and the queue is never
// drained, every live chunk is stranded and the pane never renders again -
// a worse failure than the one this feature fixes.
{
  backlogThrows = true
  const L = await freshLink()
  L.subscribeGame(() => {})
  deliver(chunk(1, 'the game keeps talking.'))
  await settle()
  eq(texts(L).length, 1, 'a failed backlog still delivers live text')
  eq(texts(L)[0], 'the game keeps talking.', 'and delivers it intact')
  backlogThrows = false
}

// ------------------------------------ stream state must not survive a reattach
//
// The bug: `parser` used to live for the whole module's lifetime, so a detach
// followed by an attach to a DIFFERENT character kept the previous
// character's last-known vitals and status icons on screen. `vitals.ts` and
// `situation.ts` both prefer the stream's answer whenever it has one at all,
// so this was not a blank field, it was someone else's health bar shown with
// full confidence.
{
  backlogReply = { lines: [], dropped: 0 }
  const L = await freshLink()
  L.subscribeGame(() => {})
  deliver(chunk(1, "<progressBar id='health' value='0' text='health 40/100'/>" +
    "<indicator id='IconPOISONED' visible='y'/>"))
  await settle()
  eq(
    L.streamCharacterState().vitals.value.health?.current,
    40,
    'control: a live progressBar is actually reaching the parser'
  )
  eq(
    L.streamCharacterState().indicators.value.poisoned,
    'on',
    'control: a live indicator is actually reaching the parser'
  )

  await L.attachGame(4455)
  ok(
    L.streamCharacterState().vitals.value.health === undefined,
    'a fresh attach must not keep the previous character’s health'
  )
  ok(
    L.streamCharacterState().indicators.value.poisoned === undefined ||
      L.streamCharacterState().indicators.value.poisoned === 'unknown',
    'a fresh attach must not keep the previous character’s status icons'
  )
}

// detach alone (no reattach yet) must clear it too - the next thing to
// attach might not send a fresh progressBar/indicator dump for a while.
{
  backlogReply = { lines: [], dropped: 0 }
  const L = await freshLink()
  L.subscribeGame(() => {})
  deliver(chunk(1, "<progressBar id='health' value='0' text='health 15/100'/>"))
  await settle()
  eq(L.streamCharacterState().vitals.value.health?.current, 15, 'control: health set before detaching')

  await L.detachGame()
  ok(
    L.streamCharacterState().vitals.value.health === undefined,
    'detaching clears the stream-derived vitals immediately, not just on the next attach'
  )
}

// ---------------------------------------------------------------- denominator
//
// A run that asserted nothing prints the same "no failures" as a run that
// asserted everything.
const FLOOR = 24
if (checks < FLOOR) {
  console.log(
    `${NL}FAIL only ${checks} checks ran, expected at least ${FLOOR} - the suite did not execute`
  )
  process.exit(1)
}

console.log(`${NL}${checks} checks, ${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
