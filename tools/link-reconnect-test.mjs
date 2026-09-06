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

// ========================================= the command bar's words (issue #501)

/*
 * The third place the link's state reaches a player, and the one they are
 * looking at when they press Enter. It tested `link.connected` inline, so
 * during a reconnect it said "Not attached" under a footer reading
 * "Reconnecting 3/6" - and its own pre-check threw before `game_send` was
 * called, which is why `closed_reason()` in game_link.rs could never reach the
 * box it was written for.
 *
 * Properties, not mechanisms. What is asserted is what a player can read and
 * what is allowed to leave the app, never which branch produced it.
 */
{
  const L = await freshLink()
  const base = { connected: false, host: '127.0.0.1', port: 11024, lines: 0, note: '' }
  const live = { ...base, connected: true }
  const redialling = { ...base, reconnecting: true, attempt: 3, maxAttempts: 6 }
  const spent = { ...base, attempt: 6, maxAttempts: 6 }

  eq(L.linkPhasePlaceholder(live), 'Command, then Enter', 'a live link invites a command')

  // The defect itself, stated as the property it broke: the box and the bars
  // must not be able to disagree about one socket. Both read the same phase,
  // so this asserts they say something *about* the reconnect rather than
  // asserting they say the same words - the two have different room.
  ok(
    /reconnect/i.test(L.linkPhasePlaceholder(redialling)),
    'a reconnecting link says so in the command box, not "Not attached"'
  )
  ok(
    L.linkPhasePlaceholder(redialling).includes('3') &&
      L.linkPhasePlaceholder(redialling).includes('6'),
    'and carries the same attempt count the footer badge carries'
  )
  ok(
    !/not attached/i.test(L.linkPhasePlaceholder(redialling)),
    'and never tells the player to attach while a dial is already running'
  )
  ok(
    /not attached/i.test(L.linkPhasePlaceholder(base)),
    'a link that was never attached still says so'
  )
  ok(
    !/reconnect/i.test(L.linkPhasePlaceholder(spent)),
    'a spent run does not promise a reconnect that has stopped'
  )

  // The hold. Exactly one phase refuses locally, and every other refusal is
  // left to the lane so `closed_reason()`'s words are reachable.
  eq(L.linkHold(live), null, 'a live link holds nothing')
  eq(L.linkHold(base), null, 'an idle link is left to the lane to refuse, with its words')
  eq(L.linkHold(spent), null, 'and so is a spent one, which is the only place closed_reason can be read')
  ok(L.linkHold(redialling) !== null, 'a reconnecting link holds the command here')
  ok(
    L.linkHold(redialling).includes('3') && L.linkHold(redialling).includes('6'),
    'the hold names which attempt of how many'
  )
  ok(
    /press enter again/i.test(L.linkHold(redialling)),
    'and says what to do with it, because it is not queued and will not send itself'
  )
  ok(
    !/queue|will send automatically|sent when/i.test(L.linkHold(redialling)),
    'and never claims it will go out on its own: a command typed against a stale room is dangerous'
  )
}

// ============================== one reader of the link state (issue #501)

/*
 * A source census, and the reason it exists rather than a promise to be
 * careful: nothing asserted that a component rendering the link's state went
 * through `linkPhase`. `GameCommandBar` did not, for four months, while the
 * two files either side of it did - and no test could have noticed, because
 * every one of them was passing about its own file.
 *
 * The denominator is the count of consumers *found*, not a hardcoded three: a
 * fourth component subscribing to the link tomorrow is measured without
 * anybody remembering this file, and a parse that finds nothing reports itself
 * rather than passing vacuously.
 */
{
  const { readdirSync, readFileSync, statSync } = await import('node:fs')
  const { join } = await import('node:path')

  /** Every .tsx under src/components, walked rather than listed. */
  const walk = (dir) =>
    readdirSync(dir).flatMap((entry) => {
      const p = join(dir, entry)
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.tsx') ? [p] : []
    })

  /**
   * Comments and JSX comment blocks removed before anything is matched.
   *
   * This file's own subject is heavily commented, and several of those
   * comments quote the very expression being banned - including the one in
   * `GameCommandBar` explaining why it is gone. A grep over raw text would
   * read those as violations and the honest fix would be to delete the
   * explanation, which is exactly backwards.
   */
  const stripComments = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

  const files = walk('src/components').map((path) => ({
    path,
    code: stripComments(readFileSync(path, 'utf8')),
  }))

  ok(files.length > 40, `the component tree was walked (${files.length} .tsx files)`)

  // A consumer is a file that subscribes to the game link's state. That is the
  // population; anything narrower would be choosing the answer before looking.
  const consumers = files.filter((f) => f.code.includes('subscribeGame'))
  ok(consumers.length >= 3, `link-state consumers found: ${consumers.length}`)

  // Of those, the ones that actually branch on the connection. `GameSignals`
  // subscribes purely to re-render and reads no field, so it is deliberately
  // not required to import a selector it has no use for - and it is named
  // here rather than filtered silently, so a future reader can disagree.
  const INLINE = /\blink\.connected\b|\blinkState\.connected\b/
  const branching = consumers.filter((f) => f.code.includes('linkPhase') || INLINE.test(f.code))
  ok(
    branching.length >= 3,
    `and of those, ${branching.length} of ${consumers.length} branch on the connection`
  )

  let inline = 0
  for (const f of branching) {
    const uses = f.code.includes('linkPhase')
    ok(uses, `${f.path} reads the link through linkPhase`)
    const bad = INLINE.test(f.code)
    if (bad) inline++
    ok(!bad, `${f.path} has no inline connected test left`)
  }
  eq(inline, 0, `no inline link.connected test survives in any of the ${branching.length} consumers`)

  /*
   * The positive control, and it is two-sided on purpose.
   *
   * A census that found nothing and a census whose matcher is broken print the
   * same zero. So the matcher must be shown to fire on an inline test that IS
   * there (injected here, in memory), and the comment stripper must be shown
   * NOT to fire on the same expression inside a comment - which is the case
   * the subject files actually contain.
   */
  ok(INLINE.test('if (link.connected) return null'), 'control: the matcher sees an inline test')
  ok(
    !INLINE.test(stripComments('// it used to say link.connected here\nconst x = 1')),
    'control: and does not see one quoted in a comment'
  )
  ok(
    !INLINE.test(stripComments('/* link.connected */ const x = 1')),
    'control: nor one inside a block comment'
  )
  ok(
    INLINE.test(stripComments('const x = link.connected // a real one beside a comment')),
    'control: and still sees a real one on a commented line'
  )
}

// ==================================== stale is marked stale (issue #506)

/*
 * An unexpected drop left `character`, its vitals and `scriptStates` in the
 * store verbatim and every consumer drew them as current, while a deliberate
 * disconnect cleared them. The value is worth keeping - the health you had
 * eight seconds ago is the best answer available while the socket is down -
 * so it is marked rather than cleared or trusted.
 *
 * A fake clock throughout. The window that matters is measured in seconds and
 * a test that waited them out would be a test nobody runs.
 */
{
  const S = await import('../src/store/staleMark.ts')
  const T0 = 1_700_000_000_000

  eq(S.FRESH, 0, 'no mark is zero, not null, so the store field is never nullable')

  // A drop, with something on screen to be stale.
  const dropped = S.nextStaleSince({
    status: 'reconnecting',
    hasData: true,
    staleSince: S.FRESH,
    now: T0,
  })
  eq(dropped, T0, 'an unexpected drop marks the data, with the time it stopped arriving')
  ok(S.isStale(dropped), 'and the mark reads as stale')

  // Every non-feeding status marks, not only `reconnecting`. `gave-up` and
  // `error` are the two that used to fall through `onLiveStatus` unnoticed.
  for (const status of ['reconnecting', 'gave-up', 'error', 'disconnected', 'connecting']) {
    eq(
      S.nextStaleSince({ status, hasData: true, staleSince: S.FRESH, now: T0 }),
      T0,
      `a bridge in '${status}' is not feeding, so the numbers are marked`
    )
  }

  // The mark does not move. Six reconnect attempts would otherwise reset the
  // age six times and draw a forty-second-old reading as four seconds old,
  // which is worse than not marking it at all.
  eq(
    S.nextStaleSince({ status: 'gave-up', hasData: true, staleSince: T0, now: T0 + 40_000 }),
    T0,
    'a later attempt does not reset the age: the mark is when the data stopped'
  )

  // Nothing on screen, nothing to qualify.
  eq(
    S.nextStaleSince({ status: 'error', hasData: false, staleSince: S.FRESH, now: T0 }),
    S.FRESH,
    'a drop before anything ever arrived marks nothing'
  )

  /*
   * The ten seconds this is really about.
   *
   * `game:reconnected` calls `resetStream()`, so `vitals.ts` falls back to the
   * bridge's copy for every pool the stream has not re-reported, and Lich's
   * own replay is up to ten seconds late in DragonRealms (`global_defs.rb:2307`,
   * an indicator DR never sets). So the socket coming back is NOT the moment
   * the numbers become current, and clearing the mark on `connected` would put
   * full contrast back over pre-drop readings for that whole window.
   */
  const reconnected = S.nextStaleSince({
    status: 'connected',
    hasData: true,
    staleSince: T0,
    now: T0 + 1_000,
  })
  eq(reconnected, T0, 'the socket coming back does not clear the mark on its own')
  eq(
    S.staleAgeSeconds(reconnected, T0 + 10_000),
    10,
    'so ten seconds into the replay window the reading is still marked, and its real age is shown'
  )
  eq(
    S.staleNote(reconnected, T0 + 10_000),
    'last known, 10s ago',
    'and the words say how old, not merely that something is wrong'
  )

  // What does clear it: a payload landing.
  eq(S.clearedByFreshData(), S.FRESH, 'a fresh payload is what ends the mark')
  eq(S.staleNote(S.clearedByFreshData(), T0 + 99_000), null, 'and then nothing is rendered at all')
  eq(S.staleAgeSeconds(S.FRESH, T0 + 99_000), 0, 'an unmarked store has no age to report')

  // The mock has no socket to drop, so its data is as current as it gets.
  eq(
    S.nextStaleSince({ status: 'mock', hasData: true, staleSince: S.FRESH, now: T0 }),
    S.FRESH,
    'the mock bridge is never stale: it has no transport to lose'
  )

  // A clock that moves backwards must not produce "last known, -3s ago".
  eq(S.staleAgeSeconds(T0, T0 - 3_000), 0, 'a backwards clock floors at zero rather than lying')
}

// ================== the two disconnect paths agree (issue #506, store level)

/*
 * The pure module above says what the rule is. This says the store actually
 * applies it, through the real `bridgeLifecycle` functions rather than a
 * restatement of them - the defect was never in a rule, it was that one of the
 * two doors out did not go through it.
 *
 * The bridge facade is mocked because importing it reaches the mock bridge,
 * the map data and eventually `import.meta.glob`, which is not loadable
 * outside Vite. Only the facade: `bridgeLifecycle` itself is the subject and
 * is imported for real.
 */
{
  let liveStatus = () => {}
  const fakeBridge = {
    disconnect() {},
    setMode() {},
    getMode: () => 'live',
    connect() {},
    onMessage: () => () => {},
    onLiveStatus: (fn) => {
      liveStatus = fn
      return () => {}
    },
    getLiveStatus: () => 'connected',
    getLiveAttempt: () => 3,
    getLiveMaxAttempts: () => 6,
  }
  mock.module('../src/bridge/index.ts', asMock({ bridge: fakeBridge }))

  const { applyLiveStatus, disconnectBridge } = await import('../src/store/bridgeLifecycle.ts')

  const T0 = 1_700_000_000_000
  let state = {
    character: { name: 'Phemius', vitals: { health: 41, healthMax: 100 } },
    characterAt: T0 - 2_000,
    scriptStates: [{ name: 'bigshot', status: 'running' }],
    runningScripts: ['bigshot'],
    bridgeStaleSince: 0,
  }
  const set = (patch) => {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
  }
  const get = () => state

  applyLiveStatus('reconnecting', set, get, T0)
  eq(state.bridgeStaleSince, T0, 'an unexpected drop marks the store')
  ok(state.character !== null, 'and keeps the character, because the last reading is worth having')
  eq(state.scriptStates.length, 1, 'and keeps the script list for the same reason')
  eq(state.character.vitals.health, 41, 'the numbers are not blanked, they are qualified')
  eq(state.bridgeAttempt, 3, 'the attempt count still reaches the store')

  applyLiveStatus('gave-up', set, get, T0 + 30_000)
  eq(state.bridgeStaleSince, T0, 'a second status does not restart the age')

  applyLiveStatus('connected', set, get, T0 + 31_000)
  eq(state.bridgeStaleSince, T0, 'and the socket returning does not clear it either')
  ok(state.bridgeConnected, 'though the store does know it is connected again')

  // The deliberate path still clears, and that is not an inconsistency: a
  // detach ends the session, so there is no "last known" left to qualify.
  disconnectBridge(set)
  eq(state.character, null, 'a deliberate disconnect still clears the character')
  eq(state.scriptStates.length, 0, 'and the script list')
  eq(state.bridgeStaleSince, 0, 'and takes the mark with it, so no badge floats over an empty panel')
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
