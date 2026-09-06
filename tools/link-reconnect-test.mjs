/**
 * The three states a dropped link can be in, and what each of them does.
 *
 *   node --experimental-test-module-mocks tools/link-reconnect-test.mjs
 *
 * # What this is about (issue #479)
 *
 * Both of this app's transports could drop, and neither said anything useful
 * about it. The game socket did not reconnect at all - the reader thread hit
 * EOF, emitted one state and stopped. The bridge reconnected forever, capped
 * at thirty seconds and with no bound, so a bridge that had gone and one
 * fifteen seconds into a Lich restart produced the identical permanent
 * spinner. Both reported through a boolean, so "reconnecting" and "gave up"
 * were the same value with the real answer in a free-text detail string that
 * nothing parsed.
 *
 * # What is asserted
 *
 * Properties a player can see, not the mechanisms behind them. The Rust half
 * of the reconnect - the backoff schedule, the bound, the lane's refusal - is
 * asserted in `src-tauri/src/game_link.rs`'s own tests, where the schedule can
 * be read rather than timed. This is the half that reaches a screen:
 *
 *   - `linkPhase` reports exactly one of four states, and the two that used to
 *     be folded together are separate
 *   - a link state from an OLDER Rust binary, with no `reconnecting` field,
 *     degrades to the two-state reading rather than to a wrong claim
 *   - a chunk arriving clears a stale reconnecting state, because a chunk
 *     cannot come from a socket still being dialled
 *   - the bridge's reconnect is BOUNDED: it stops, and the state it stops in
 *     names the attempt count
 *   - the bridge publishes `reconnecting` with a rising attempt count first
 *   - a deliberate reconnect after a give-up gets a fresh budget
 *   - `send` while down is refused and reported, never silently swallowed
 *   - the reconnect edge asks the bridge for the state Lich will not replay
 *   - the transport-status → store-status mapping is TOTAL, so a new status
 *     cannot be added to the transport and quietly land nowhere
 *
 * # The one that earns its keep
 *
 * The bound. Without it the give-up case is unreachable, the test below spins
 * until the harness kills it, and `SafetyFooter`'s "Bridge gave up" branch is
 * dead code that nobody could ever have proved works. It is also the sabotage:
 * raise `MAX_RECONNECT_ATTEMPTS` past the loop guard here and this file goes
 * red naming the count it reached.
 */
import { mock } from 'node:test'

let checks = 0
let failures = 0

// `OK` / `FAIL` at column 0, because tools/run-tests.mjs counts those to
// establish this suite's denominator. A passing check printed as silence makes
// the whole file read as NOT RUN.
function ok(cond, what) {
  checks++
  if (cond) console.log(`OK   ${what}`)
  else {
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

globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0)

// --------------------------------------------------------------- tauri stub

/** Handlers gameLink installs, so this file can play the part of Rust. */
const handlers = new Map()

const tauriStub = {
  isTauri: () => true,
  listenTauri: (name, fn) => {
    handlers.set(name, fn)
    return () => handlers.delete(name)
  },
  invokeTauri: async (cmd) => {
    if (cmd === 'game_backlog') return { lines: [], dropped: 0 }
    if (cmd === 'read_bridge_token') return 'token-abc'
    return undefined
  },
  setAlwaysOnTop: async () => {},
  getBridgeDefaultUrl: async () => '',
}

// node:test renamed this option between releases: `namedExports` on 22,
// `exports` on 24. Passing the wrong one is not a warning - the replacement
// module ends up with no named exports and the failure is a link error naming
// neither this file nor the option. Chosen by version so neither runtime
// prints a deprecation warning into the output.
const nodeMajor = Number(process.versions.node.split('.')[0])
const asMock = (exports) => (nodeMajor >= 24 ? { exports } : { namedExports: exports })
mock.module('../src/lib/tauri.ts', asMock(tauriStub))

// ------------------------------------------------------------ fake WebSocket

/**
 * A WebSocket that opens, closes and fails on command.
 *
 * `RealBridge` is written against the browser global, so a fake global is the
 * only way to drive it outside a browser. That is not a compromise here, it is
 * the point: the behaviour under test is what the class does *between* sockets,
 * and a real socket would make the interesting cases - a close at the moment
 * the bound is reached - a matter of timing rather than of instruction.
 */
const sockets = []
class FakeSocket {
  static OPEN = 1
  constructor(url) {
    this.url = url
    this.readyState = 0
    this.sent = []
    this.onopen = null
    this.onmessage = null
    this.onerror = null
    this.onclose = null
    sockets.push(this)
  }
  send(data) {
    this.sent.push(JSON.parse(data))
  }
  close() {
    this.readyState = 3
    this.onclose?.()
  }
  /** The server accepted. */
  open() {
    this.readyState = FakeSocket.OPEN
    this.onopen?.()
  }
  /** The server went away, or never answered. */
  drop() {
    this.readyState = 3
    this.onclose?.()
  }
}
globalThis.WebSocket = FakeSocket

/**
 * Run every pending timer immediately, in order, until none are left.
 *
 * The bridge's backoff is real `setTimeout` and its schedule reaches thirty
 * seconds, so a test that waited would take minutes. Replacing the clock keeps
 * the *sequence* - which is what is being asserted - and removes the waiting.
 * The delays each call asked for are recorded, so the schedule itself is still
 * checked rather than skipped.
 */
const scheduled = []
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms) => {
  // Zero-delay timers are the settle() helper and gameLink's frame shim, not
  // the backoff; leave those on the real clock or nothing ever resolves.
  if (!ms) return realSetTimeout(fn, ms)
  const t = { fn, ms, cancelled: false }
  scheduled.push(t)
  return t
}
globalThis.clearTimeout = (t) => {
  if (t && typeof t === 'object') t.cancelled = true
  else clearTimeout(t)
}
/** Fire the next scheduled backoff, returning the delay it had asked for. */
function fireNextTimer() {
  const t = scheduled.shift()
  if (!t) return null
  if (t.cancelled) return fireNextTimer()
  t.fn()
  return t.ms
}

const settle = () => new Promise((r) => realSetTimeout(r, 5))

// ------------------------------------------------------------------- imports

const { RealBridge, MAX_RECONNECT_ATTEMPTS } = await import('../src/bridge/realBridge.ts')
const { storeBridgeStatus } = await import('../src/store/bridgeStatus.ts')

let caseNo = 0
const freshLink = () => import(`../src/lib/gameLink.ts?case=${++caseNo}`)

// ================================================================= link phase

{
  const L = await freshLink()
  const base = { connected: false, host: '127.0.0.1', port: 11024, lines: 0, note: '' }

  eq(L.linkPhase({ ...base, connected: true }), 'connected', 'a live socket reads as connected')
  eq(
    L.linkPhase({ ...base, reconnecting: true, attempt: 2, maxAttempts: 6 }),
    'reconnecting',
    'a re-dial in flight reads as reconnecting, not as down'
  )
  eq(
    L.linkPhase({ ...base, reconnecting: false, attempt: 6, maxAttempts: 6 }),
    'gave-up',
    'a spent attempt count with no dial in flight reads as gave-up'
  )
  eq(L.linkPhase(base), 'idle', 'never attached reads as idle, not as a failure')

  // The chooser, tested where the wrong answers are available: each of the
  // four must be reachable and distinct, or `linkPhase` could be a constant
  // and every assertion above would still pass on one of them.
  const all = new Set([
    L.linkPhase({ ...base, connected: true }),
    L.linkPhase({ ...base, reconnecting: true, attempt: 1 }),
    L.linkPhase({ ...base, attempt: 3 }),
    L.linkPhase(base),
  ])
  eq(all.size, 4, 'the four phases are four distinct answers')

  // The label carries the count. A badge that says "Reconnecting" without a
  // number is the spinner this issue was opened about.
  eq(
    L.linkPhaseLabel({ ...base, reconnecting: true, attempt: 3, maxAttempts: 6 }),
    'Reconnecting 3/6',
    'the reconnecting label names the attempt and the bound'
  )
  eq(
    L.linkPhaseLabel({ ...base, attempt: 6, maxAttempts: 6 }),
    'Link lost after 6 attempts',
    'the give-up label names how many attempts were spent'
  )
  eq(L.linkPhaseLabel({ ...base, connected: true }), null, 'a healthy link gets no badge')
  eq(L.linkPhaseLabel(base), null, 'an idle link gets no badge')

  /*
   * The compatibility case, and it is the one that would rot silently.
   *
   * A hot-reloaded frontend can outrun the Rust binary it is talking to, and a
   * release that ships the webview ahead of the native side reaches the same
   * state honestly. With `reconnecting` absent this must degrade to the
   * behaviour that predates the field - connected or idle - and never to
   * "gave-up", which would put a failure badge on a link that is merely idle.
   */
  const old = { connected: false, host: 'h', port: 1, lines: 0, note: 'Not attached.' }
  eq(L.linkPhase(old), 'idle', 'a state from an older Rust binary reads as idle')
  eq(L.linkPhase({ ...old, connected: true }), 'connected', 'and as connected when it is')
  eq(L.linkPhaseLabel(old), null, 'and shows no badge it has no evidence for')
}

// ---------------------------------------- a chunk clears a stale reconnecting

{
  const L = await freshLink()
  L.subscribeGame(() => {})
  await settle()

  const state = handlers.get('game:state')
  ok(typeof state === 'function', 'gameLink subscribed to game:state')
  state({
    connected: false,
    host: '127.0.0.1',
    port: 11024,
    reconnecting: true,
    attempt: 4,
    maxAttempts: 6,
    lines: 12,
    note: 'Reconnecting',
  })
  await settle()
  eq(L.linkPhase(L.gameState()), 'reconnecting', 'the published reconnect reaches the module')

  // A chunk cannot arrive from a socket that is still being dialled, so one
  // arriving is proof the link is back - the same reading that makes
  // `connected` self-healing. Without this a dropped state event leaves the
  // bar counting attempts over a pane filling with live text.
  const line = handlers.get('game:line')
  line({ seq: 1, receivedAtMs: 1_700_000_000_000, text: 'You are here.' + String.fromCharCode(10) })
  await settle()
  eq(
    L.linkPhase(L.gameState()),
    'connected',
    'live text clears a stale reconnecting state rather than being shown under it'
  )
}

// ------------------------------------------- the reconnect edge asks for more

{
  const L = await freshLink()
  L.subscribeGame(() => {})
  await settle()

  let reconnects = 0
  const off = L.onGameReconnect(() => {
    reconnects++
  })
  await settle()

  const fired = handlers.get('game:reconnected')
  ok(typeof fired === 'function', 'gameLink subscribed to game:reconnected')
  fired(3)
  await settle()
  eq(reconnects, 1, 'the reconnect edge reaches its subscriber')

  // An edge, not a level: a later state event must not re-fire it.
  handlers.get('game:state')({
    connected: true,
    host: 'h',
    port: 1,
    reconnecting: false,
    attempt: 0,
    maxAttempts: 6,
    lines: 1,
    note: '',
  })
  await settle()
  eq(reconnects, 1, 'a later state event does not re-fire the reconnect edge')

  off()
  fired(4)
  await settle()
  eq(reconnects, 1, 'unsubscribing stops it')
}

// ================================================================ bridge bound

/** A bridge wired to a fresh socket list, with its status transitions recorded. */
function newBridge() {
  sockets.length = 0
  scheduled.length = 0
  const b = new RealBridge('ws://127.0.0.1:7415/companion')
  const seen = []
  b.onStatus((s, detail) => seen.push({ s, detail }))
  return { b, seen }
}

{
  const { b, seen } = newBridge()
  b.connect()
  await settle()
  ok(sockets.length === 1, 'connect opens exactly one socket')

  sockets[0].open()
  eq(b.getStatus(), 'connected', 'an accepted socket reads as connected')

  /*
   * The bridge's own replay, which is the half Lich cannot be asked for.
   *
   * Lich has no verb that re-triggers `detachable_client_send_init` - the
   * detachable read loop understands `SET_FRONTEND_PID` and an exit command
   * and treats everything else as player input (global_defs.rb:2363-2379) - so
   * a reconnect gets Lich's replay only because a fresh accept runs it, and
   * that replay carries no room, occupants, roundtime or scripts. This does.
   */
  const kinds = sockets[0].sent.map((m) => m.type)
  ok(kinds.includes('auth'), 'the token goes first')
  ok(kinds.includes('subscribe'), 'the subscription is re-sent on every open')
  ok(
    kinds.includes('get_status'),
    'a fresh status is requested on every open, which is the bridge half of the replay'
  )
  eq(kinds[0], 'auth', 'nothing overtakes the token')

  // Now drop it, and count the whole run.
  let attempts = 0
  let guard = 0
  sockets[0].drop()
  for (;;) {
    // The loop guard is the denominator. With the bound removed this never
    // terminates, and a test that hung would be killed with no message; this
    // fails naming the count it reached.
    if (++guard > MAX_RECONNECT_ATTEMPTS * 4) {
      ok(false, `the bridge is still dialling after ${guard} closes: the attempt bound is gone`)
      break
    }
    if (b.getStatus() === 'gave-up') break
    const delay = fireNextTimer()
    if (delay === null) {
      ok(false, `no retry was scheduled at attempt ${attempts}, and it has not given up`)
      break
    }
    attempts++
    await settle()
    // Each retry opens a socket that never answers, then closes.
    sockets[sockets.length - 1].drop()
  }

  eq(b.getStatus(), 'gave-up', 'the reconnect run is bounded and stops')
  eq(attempts, MAX_RECONNECT_ATTEMPTS, 'it spent exactly the bound, no more and no fewer')

  const gaveUp = seen.filter((x) => x.s === 'gave-up')
  eq(gaveUp.length, 1, 'it gives up once, not on every later close')
  /*
   * `?? ''` rather than indexing into `gaveUp[0]` directly.
   *
   * With the give-up branch removed there is no such element, and reading
   * `.detail` off it threw - which ended the whole file at that line, so the
   * ten checks after it never ran and the sabotage harness saw four failures
   * where there should have been eleven. A suite that crashes reports fewer
   * failures than it had, which is the same shape as a suite that never ran.
   * Found by the sabotage in tools/link-reconnect-break-check.mjs.
   */
  const gaveUpDetail = gaveUp[0]?.detail ?? ''
  ok(
    gaveUpDetail.includes(`after ${MAX_RECONNECT_ATTEMPTS} attempts`),
    `the give-up reason names the attempt count: ${JSON.stringify(gaveUpDetail)}`
  )
  ok(
    gaveUpDetail.includes('7415'),
    `the give-up reason names what it gave up on: ${JSON.stringify(gaveUpDetail)}`
  )

  // The states before it are `reconnecting` with a rising count, not
  // `disconnected` - which is what they used to be, and which is why there was
  // no way to show a reconnect in progress at all.
  const reconnecting = seen.filter((x) => x.s === 'reconnecting')
  eq(
    reconnecting.length,
    MAX_RECONNECT_ATTEMPTS,
    'every retry published a reconnecting state'
  )
  /*
   * The length is part of the assertion, not a separate check above it.
   *
   * `[].every(...)` is true, so with the reconnecting state removed entirely
   * this passed - a check that could not fail in the one case it exists for.
   * Counting the fragile thing: the number that goes to zero when the
   * mechanism breaks is how many reconnecting states were published, so that
   * is what the assertion is anchored on. Found by the sabotage in
   * tools/link-reconnect-break-check.mjs.
   */
  ok(
    reconnecting.length === MAX_RECONNECT_ATTEMPTS &&
      reconnecting.every((x, i) =>
        x.detail?.includes(`attempt ${i + 1} of ${MAX_RECONNECT_ATTEMPTS}`)
      ),
    `each reconnecting state names its own attempt and the bound (${reconnecting.length} seen)`
  )
  eq(
    seen.filter((x) => x.s === 'disconnected').length,
    0,
    'a reconnect is never reported as a plain disconnect'
  )

  // Nothing can be sent while it is down, and the refusal is reported rather
  // than swallowed. A transport that accepted a send here would look to its
  // caller exactly like one that delivered it.
  const errors = []
  b.onMessage((m) => {
    if (m.type === 'error') errors.push(m.message)
  })
  b.send({ type: 'get_status' })
  eq(errors.length, 1, 'a send to a bridge that gave up is refused, not swallowed')
  ok(errors[0].includes('Not connected'), `and says so: ${errors[0]}`)
}

// ------------------------------------------ a deliberate retry gets a budget

{
  const { b } = newBridge()
  b.connect()
  await settle()
  sockets[0].open()
  sockets[0].drop()
  let guard = 0
  while (b.getStatus() !== 'gave-up' && ++guard < MAX_RECONNECT_ATTEMPTS * 4) {
    if (fireNextTimer() === null) break
    await settle()
    sockets[sockets.length - 1].drop()
  }
  eq(b.getStatus(), 'gave-up', 'the run gave up, so there is something to retry from')

  /*
   * The bound stops an *automatic* run going on forever. It must not make the
   * app refuse to try again when a person asks: without the counter reset, one
   * click would open a socket whose first close gave up again with no backoff
   * and no second attempt, which is a button that appears to do nothing.
   */
  const before = sockets.length
  b.connect()
  await settle()
  eq(sockets.length, before + 1, 'a deliberate reconnect opens a socket')
  eq(b.getAttempt(), 0, 'and starts from a fresh budget rather than at the bound')
  sockets[sockets.length - 1].open()
  eq(b.getStatus(), 'connected', 'and can connect again')
  eq(b.getMaxAttempts(), MAX_RECONNECT_ATTEMPTS, 'the bound is published for the UI to show')
}

// ============================================ the store mapping is exhaustive

{
  /*
   * Every transport status must land somewhere in the store, and the two that
   * matter must NOT read as connected.
   *
   * The list is written out rather than derived, on purpose: deriving it from
   * the same table the code uses would make this test agree with the code by
   * construction and assert nothing. This is a second, independent statement
   * of what the set is, and `tsc` holds the first one exhaustive.
   */
  const ALL = ['disconnected', 'connecting', 'reconnecting', 'connected', 'gave-up', 'error']
  for (const s of ALL) {
    const got = storeBridgeStatus(s)
    eq(got.bridgeStatus, s, `${s} maps to a store status`)
    eq(
      got.bridgeConnected,
      s === 'connected',
      `${s} is ${s === 'connected' ? '' : 'not '}treated as live`
    )
  }
  ok(
    !storeBridgeStatus('reconnecting').bridgeConnected,
    'a reconnecting bridge is not treated as one that can be sent to'
  )
  ok(
    !storeBridgeStatus('connecting').bridgeConnected,
    'a connecting bridge is not treated as one that can be sent to'
  )
  // A status from a transport newer than this build degrades to `error`, which
  // is not-connected. Never to `connected`: guessing generously about a state
  // nobody has described is how a command reaches a socket that is not there.
  eq(
    storeBridgeStatus('a-status-from-the-future').bridgeStatus,
    'error',
    'an unknown status degrades to error'
  )
  ok(
    !storeBridgeStatus('a-status-from-the-future').bridgeConnected,
    'and never to connected'
  )
}

// --------------------------------------------------------------------- floor

/*
 * The denominator. Set well below the real count so it never needs touching
 * and still catches a file that parsed to nothing, an import that failed
 * silently, or a mock that swallowed every case.
 */
const FLOOR = 40
if (checks < FLOOR) {
  console.log(`FAIL only ${checks} checks ran, floor is ${FLOOR}: this suite did not do its work`)
  failures++
}

console.log(
  failures === 0
    ? `all passed: ${checks}/${checks}`
    : `${failures} of ${checks} failed`
)
process.exit(failures === 0 ? 0 : 1)
