#!/usr/bin/env node
/**
 * One run that plays the game: sign in, attach, play, drop, reconnect, and
 * carry a configuration across a reload - with no Godot anywhere near it.
 *
 *   npm run test:mud-client-e2e
 *
 * # What this is for
 *
 * Dan, 9 September 2026: "outside of godot we need to get the build running
 * and tested as a mud client without godot, all on its own... godot is
 * dessert." Gate 1 of `docs/PLAN_TO_1_0.md` is the plan's name for the same
 * sentence - "text client stands alone" - and until this file its check line
 * asked for "a full play session recorded with viewer and AI absent", which is
 * a thing a person does once and writes down, not a thing that runs again
 * tomorrow. A recording proves the session happened. It cannot notice the day
 * a change breaks it.
 *
 * So this is the automated half. It does not replace the recorded session -
 * the recording is what covers the installer, the real account and the real
 * Lich - it covers the chain that a recording cannot re-run.
 *
 * # What is real here and what is a stand-in
 *
 * Real, in this process:
 *
 *   - `tools/fake-lich.mjs`, a separate process, over a real loopback TCP
 *     socket, replaying text captured off the wire from a live DragonRealms
 *     session. Every byte the parser sees arrived through a socket.
 *   - every `src/lib` module in the chain, imported and executed: the tag
 *     parser, the line buffer, the line rules, the highlights, the aliases,
 *     the keybinding resolver, the macro runner, the pause and stop signals,
 *     the player-config store and its export/import.
 *   - the fixture's own view of what it received, read back off its stderr.
 *     That is the far side of the socket, and it is what makes "the command
 *     reached the game" a measurement rather than a claim about a function
 *     this file called.
 *
 * Stood in for, and named as such wherever it matters:
 *
 *   - **Rust.** `src-tauri` is not running. This file plays the part Rust
 *     plays - it dials the socket, emits `game:line`, `game:state` and
 *     `game:lane` the way the reader thread does, and answers `game_send`.
 *     That is the same technique `tools/line-rules-test.mjs` uses, for the
 *     same reason, and it has the same limit: the *ordering and pacing* of the
 *     outbound lane live in `src-tauri/src/command_gate.rs` and are not
 *     executed here. Every step that depends on them says NOT CHECKED and
 *     names the command that does establish it. See PHASE 3, `lane`.
 *   - **the account.** `src/lib/lichLoginFake.ts` is the scripted EAccess, and
 *     the real one (`src-tauri/src/eaccess.rs`, with `MockEAccess` beside it)
 *     is `pub(crate)` and reachable only from `cargo test`.
 *
 * # Three states, always
 *
 * Every step is OK, FAIL, or NOT CHECKED with a reason and the command that
 * would settle it. A step that could not run is never a pass, and the summary
 * carries the skip count as well as the failure count - a run that ends "no
 * failures" over four things it never attempted is the defect this whole tree
 * is built to refuse.
 *
 * Every phase prints a denominator, and the denominators are chosen to be the
 * number that goes to zero when the *mechanism* breaks rather than the number
 * being measured: lines actually delivered through the socket, panels
 * populated out of panels asked, commands observed by the fixture out of
 * commands sent.
 *
 * # Proving the checks can fail
 *
 *   DRC_E2E_SABOTAGE=bypass-lane   the ordering step must go red
 *   DRC_E2E_SABOTAGE=early-drop    the reconnect step must go red
 *   DRC_E2E_SABOTAGE=no-godot-lie  the viewer-absent step must go red
 *
 * These are seams in this file, not damage to tracked source, and the
 * difference is worth stating rather than leaving to be discovered. A seam
 * proves *this check can go red* - which is the thing a green run cannot tell
 * you and the thing that was missing. It does not prove the app would fail if
 * the app were wrong; `tools/command-lane-break-check.mjs` damages
 * `command_gate.rs` itself and is the harness for that, and it is deliberately
 * not run from here because it compiles a broken file that any other session
 * building this tree would meet.
 *
 * `tools/mud-client-e2e-break-check.mjs` runs all three and asserts that each
 * reddens its own step and no other.
 *
 * # Ports
 *
 * The fixture is bound on 11200 + (pid mod 300), never 11024 (a real Lich's
 * detachable-client port) and never 7415 (the companion bridge). Two lanes can
 * run this at once. Whatever it starts, it kills by the pid it started, which
 * is the only form of kill this machine's rules allow.
 */
import { mock } from 'node:test'
import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SABOTAGE = process.env.DRC_E2E_SABOTAGE || ''

// --------------------------------------------------------------- the ledger

let checks = 0
let fails = 0
let skips = 0
/** Which step each failure and skip belongs to, so a sabotage run can assert
 *  that it reddened the step it aimed at and nothing else. */
const failedSteps = []
const skippedSteps = []

/**
 * `OK  ` and `FAIL` at column zero, and nothing else may start a line with
 * them: `tools/run-tests.mjs` counts exactly those two prefixes to establish
 * this suite's denominator, and a file that printed only a summary would be
 * reported as NOT RUN however loudly the summary claimed otherwise.
 */
function ok(step, condition, detail = '') {
  checks += 1
  if (!condition) {
    fails += 1
    failedSteps.push(step)
  }
  // Two spaces between the step and its detail, always - `padEnd` leaves one
  // when the name is already that long, and `mud-client-e2e-break-check.mjs`
  // reads the step name back out of these lines by that gap. A step whose name
  // happened to be 46 characters used to arrive there as an empty string, so
  // the sabotage check compared [] against its expectation and reported a seam
  // that had in fact worked.
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${step.padEnd(46)}  ${detail}`)
}

/**
 * Something this run could not establish, with the reason and the command that
 * does establish it.
 *
 * Not a pass and not a failure, because folding it into either is where the
 * lie enters: "the lane held the command" and "nothing here can execute the
 * lane" are different facts and they call for different things from whoever is
 * reading this.
 */
function notChecked(step, why, command) {
  skips += 1
  skippedSteps.push(step)
  console.log(`NOT CHECKED ${step.padEnd(39)} ${why}`)
  console.log(`            ${''.padEnd(39)} run: ${command}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Poll until a predicate holds, so nothing here is a guessed sleep. */
async function until(predicate, ms = 8000, step = 20) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (predicate()) return true
    await sleep(step)
  }
  return false
}

// ------------------------------------------------------- the browser globals
//
// Set before any import, because `playerConfig.ts` and `storage.ts` read
// `localStorage` and `gameLink.ts` coalesces its notifications onto an
// animation frame. Neither is a mock of behaviour under test; they are the
// platform those modules are written against.

const memory = new Map()
globalThis.localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
  clear: () => memory.clear(),
}
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0)
// `gameActions.ts` publishes a failure event on `window`. Present so a refusal
// reaches its listener rather than throwing a second, unrelated error on the
// way out.
globalThis.window = globalThis.window || {
  location: { search: '' },
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
}

// ------------------------------------------------------------- the Rust part
//
// Everything below stands in for `src-tauri`. It is deliberately thin: the
// less decision-making lives here, the less this file is testing itself.

/** The fixture's port. Never 11024, never 7415 - see the header. */
const PORT = 11200 + (process.pid % 300)

/** What the app asked to send, in order, as it entered the outbound path. */
const laneRecord = []
/** The lane status the window last saw, as Rust would have published it. */
let laneStatus = null
/** The socket to the fixture, or null. */
let wire = null
let chunkSeq = 0
let linkState = { connected: false, host: '127.0.0.1', port: PORT, lines: 0, note: '' }
/** Set once the socket has closed without a detach having been asked for. */
let droppedUnexpectedly = false

const handlers = new Map()
const emit = (name, payload) => {
  const fn = handlers.get(name)
  if (fn) fn(payload)
}

/** Open the socket and start delivering, exactly as the reader thread does. */
function dial(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1')
    socket.setNoDelay(true)
    socket.once('error', reject)
    socket.once('connect', () => {
      socket.removeListener('error', reject)
      wire = socket
      linkState = { connected: true, host: '127.0.0.1', port, lines: 0, note: '' }
      socket.on('data', (buf) => {
        // Chunked as Rust chunks it: whatever the socket gave us, with a
        // sequence number. The tag parser's whole job is that this boundary is
        // not the text's boundary, so it is deliberately not tidied up here.
        emit('game:line', {
          seq: ++chunkSeq,
          receivedAtMs: Date.now(),
          text: buf.toString('utf8'),
        })
      })
      socket.on('close', () => {
        wire = null
        droppedUnexpectedly = true
        linkState = { ...linkState, connected: false, reconnecting: true, attempt: 1, maxAttempts: 6 }
        emit('game:state', linkState)
      })
      socket.on('error', () => {})
      resolve(linkState)
    })
  })
}

const stub = {
  isTauri: () => true,
  listenTauri: (name, fn) => {
    handlers.set(name, fn)
    return () => handlers.delete(name)
  },
  invokeTauri: async (command, args) => {
    switch (command) {
      case 'game_backlog':
        return { lines: [], dropped: 0 }
      case 'game_attach':
        return await dial(args?.port ?? PORT)
      case 'game_status':
        return linkState
      case 'game_detach':
        wire?.end()
        linkState = { ...linkState, connected: false }
        return linkState
      case 'game_send': {
        // The outbound path. Recording first and writing second is the order
        // that makes the far-side comparison meaningful: a command the fixture
        // saw that is not in this list did not come through here.
        laneRecord.push({ command: args.command, source: args.source })
        wire?.write(`${args.command}\r\n`)
        return undefined
      }
      case 'game_lane_status':
        return laneStatus
      case 'game_lane_flush': {
        const dropped = laneRecord.filter((e) => e.source !== 'player').length
        laneStatus = { ...(laneStatus ?? {}), queued: 0, flushed: dropped }
        return dropped
      }
      // No viewer, and this is the honest answer rather than a refusal: a
      // backend that is not there returns undefined, which `viewerStatus()`
      // turns into the absent shape. See `tools/viewer-absent-test.mjs`.
      case 'viewer_status':
        return undefined
      default:
        return undefined
    }
  },
  setAlwaysOnTop: async () => {},
  getBridgeDefaultUrl: async () => '',
  // Every export of `src/lib/tauri.ts`, not only the ones this file drives.
  // A stub short of one export fails at *import* time, in whichever module
  // happens to reach for it — which reads as that module being broken.
  emitTauri: (event, payload) => emit(event, payload),
}

const nodeMajor = Number(process.versions.node.split('.')[0])
mock.module('../src/lib/tauri.ts', nodeMajor >= 24 ? { exports: stub } : { namedExports: stub })

// ------------------------------------------------------------- the modules
//
// Imported after the mock, and imported for real: nothing below is a second
// implementation of anything the app ships.

const gameLink = await import('../src/lib/gameLink.ts')
const gameActions = await import('../src/lib/gameActions.ts')
const commandLane = await import('../src/lib/commandLane.ts')
const flowStop = await import('../src/lib/flowStop.ts')
const viewerClient = await import('../src/lib/viewerClient.ts')
const loginFake = await import('../src/lib/lichLoginFake.ts')
const { exitControls } = await import('../src/lib/roomExits.ts')
const { describeRoomPlayers } = await import('../src/lib/roomOccupants.ts')
const { paint, parseHighlights } = await import('../src/lib/highlights.ts')
const { applyLineRules, resetLineRuleCache } = await import('../src/lib/lineRules.ts')
const { parseAliases, expandAlias } = await import('../src/lib/aliases.ts')
const { resolveKeybinding, runMacroCommands } = await import('../src/lib/keybindings.ts')
const { canSendMacro } = await import('../src/lib/canSendMacro.ts')
const { pauseStatus } = await import('../src/lib/pauseStatus.ts')
const staleMark = await import('../src/store/staleMark.ts')
const playerConfig = await import('../src/lib/playerConfig.ts')
const transfer = await import('../src/lib/playerConfigTransfer.ts')
const persistence = await import('../src/lib/persistence.ts')
// `aiModelProvider.ts` and not `aiWorkerHost.ts`: the host reaches
// `mapData.ts`, which is built on `import.meta.glob` and only exists under
// Vite. The decision this phase is about — what a client with no model says —
// lives in the provider, and the host's part in it is checked at the source
// below rather than guessed at.
const { absentProvider } = await import('../src/lib/aiModelProvider.ts')
const aiHostSource = readFileSync(join(root, 'src', 'lib', 'aiWorkerHost.ts'), 'utf8')

// ------------------------------------------------------------ the fixture

let fixture = null
/** Every line the fixture printed to stderr, which is where it logs what it
 *  received: `  > <command>`. The far side of the socket. */
let fixtureLog = ''

function startFixture() {
  // Cleared, because the restart in phase 4 waits for "listening on" and the
  // previous fixture's line is still in this buffer: a stale match would
  // report a server that is up when nothing is bound yet, and the reattach
  // below would be measured against a port nobody holds.
  fixtureLog = ''
  const child = spawn(
    process.execPath,
    [join(root, 'tools', 'fake-lich.mjs'), '--port', String(PORT), '--tagged', '--e2e', '--speed', '40', '--max-minutes', '3'],
    { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] }
  )
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (d) => {
    fixtureLog += d
  })
  return child
}

/** What the fixture says it received, in the order it received it. */
const fixtureSaw = () =>
  [...fixtureLog.matchAll(/^ {2}> (.*)$/gm)].map((m) => m[1].trim())

/**
 * Stop the fixture - by the pid this file started and by nothing else.
 *
 * Never by image name and never by a wildcard: several sessions run node on
 * this machine and at least one of them has its own copy of this fixture up.
 */
function stopFixture() {
  if (!fixture || fixture.exitCode !== null) return
  try {
    fixture.kill()
  } catch {
    // Already gone. Nothing to report; the caller's next assertion is what
    // decides whether that mattered.
  }
}
process.on('exit', stopFixture)

// ============================================================ PHASE 1
// Godot is not here, and nothing pretends otherwise.

console.log('\n== phase 1: the viewer is absent, and every panel says so honestly ==')

/*
 * "Godot is absent" as a property of the client, not of the machine.
 *
 * The first version of this counted Godot processes and failed if any were up.
 * That is the wrong instrument twice over. Several lanes run here at once and
 * `tools/gate.mjs` itself *starts* engines - its own `godot` stage does - so on
 * a busy evening this would have gone red because somebody else's gate was
 * doing its job, and a false red addressed at a peer is the most expensive
 * kind. Worse, it was never the claim worth making: another session's engine
 * is not this client's dependency, and a machine with no Godot on it at all
 * would have passed a client that imports the viewer on every screen.
 *
 * The claim worth making is that the play chain cannot reach the viewer. So
 * this walks the import closure of `gameLink.ts` - the module that owns the
 * socket, and the root of everything a text client does - and requires that no
 * module in it names the viewer or the presentation bridge.
 *
 * The denominator is the number of modules walked, and it has a floor: a
 * closure that came back with three modules in it would satisfy "none of them
 * is the viewer" for the wrong reason.
 */
function importClosure(entry) {
  const seen = new Set()
  const stack = [entry]
  while (stack.length) {
    const file = stack.pop()
    if (seen.has(file)) continue
    seen.add(file)
    let source
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      // A specifier that does not resolve to a file on disk - a package, or a
      // type-only import elided by the compiler. Not this walk's business.
      continue
    }
    for (const [, spec] of source.matchAll(/from '(\.\.?\/[^']+\.ts)'/g)) {
      stack.push(join(dirname(file), spec))
    }
  }
  return seen
}

const chain = importClosure(join(root, 'src', 'lib', 'gameLink.ts'))
const viewerModules = [...chain].filter((f) =>
  /viewerClient|presentationBridge|presentationIntents|presentationTypes|godot/i.test(f)
)
ok(
  'the play chain walked far enough to mean something',
  // Well below the ten this walks today, so a refactor that moves a module
  // does not redden this, but an empty or one-deep walk does.
  chain.size >= 6,
  `${chain.size} modules reachable from gameLink.ts`
)
ok(
  'nothing the client needs to play can reach the viewer',
  SABOTAGE === 'no-godot-lie' ? viewerModules.length > 0 : viewerModules.length === 0,
  `${viewerModules.length} of ${chain.size} modules: ${viewerModules.map((f) => f.split(/[\\/]/).pop()).join(', ') || 'none'}`
)
ok('this run was given no Godot binary', !process.env.GODOT4, `GODOT4=${process.env.GODOT4 ?? '(unset)'}`)

// Reported, deliberately not asserted. What other sessions are running is
// their business - `tools/gate.mjs` starts engines itself - and a count of
// them says nothing about whether this client needs one.
const listing = spawnSync(
  process.platform === 'win32' ? 'tasklist' : 'ps',
  process.platform === 'win32' ? ['/FO', 'CSV', '/NH'] : ['-A', '-o', 'comm='],
  { encoding: 'utf8' }
)
const rows = (listing.stdout || '').split('\n').filter((l) => l.trim())
console.log(
  rows.length < 10
    ? `     (the process listing returned ${rows.length} rows, so the machine-wide Godot count is unknown)`
    : `     (for information only: ${rows.filter((l) => /godot/i.test(l)).length} of ${rows.length} processes on this machine match /godot/i)`
)

const viewer = await viewerClient.viewerStatus()
ok('viewerStatus answers with no backend rather than throwing', viewer !== undefined)
ok('nothing is claimed to be installed', viewer.installed === false)
ok(
  'and "could not look" is not reported as "no viewer"',
  viewer.runningKnown === false,
  `runningKnown=${viewer.runningKnown}`
)
ok(
  'the label a panel shows is a state, not an error',
  viewerClient.viewerStateLabel(viewer, false) === 'not built yet',
  JSON.stringify(viewerClient.viewerStateLabel(viewer, false))
)
ok(
  'and no exit is invented for a viewer nobody launched',
  viewerClient.viewerExitNote(viewer) === null
)

// The AI half of the same sentence: Gate 1 asks for a session with the viewer
// *and* AI absent, and "absent" has to be a state the panel can say.
const absent = absentProvider().describe()
ok('with no model configured the provider says so', absent.available === false)
ok(
  'and says it in a sentence a panel can print',
  /No local model is installed\./.test(absent.reason ?? ''),
  JSON.stringify(absent.reason)
)
ok(
  'and no configured model is what reaches that provider',
  /const DEFAULT_PROVIDER[^=]*=\s*absentProvider\(\)/.test(aiHostSource) &&
    /if \(!url\) return DEFAULT_PROVIDER/.test(aiHostSource),
  'source check: src/lib/aiWorkerHost.ts buildProvider(null)'
)

// ============================================================ PHASE 2
// Sign in, list characters, launch, attach.

console.log('\n== phase 2: sign in, pick a character, attach ==')

const account = { account: 'demo', password: 'demo', gameCode: 'DR' }
let listed = null
try {
  listed = await loginFake.fakeListCharacters(account)
} catch (e) {
  ok('the scripted EAccess returns a character list', false, e.message)
}
if (listed) {
  const characters = listed.characters ?? []
  ok('the scripted EAccess returns a character list', characters.length > 0, `${characters.length} characters`)
  ok(
    'every character has a code and a name to show',
    characters.length > 0 && characters.every((c) => c.code && c.name),
    `${characters.filter((c) => c.code && c.name).length} of ${characters.length} complete`
  )
  const launch = await loginFake.fakeLaunch({ ...account, character: characters[0].name })
  ok('launching a character reports a port to attach to', Number.isInteger(launch.port), JSON.stringify(launch))
}

// The `.sal` file and the dry run are Rust, and there is no route to them from
// here. Said rather than skipped past.
notChecked(
  'the .sal launch file is written then shredded',
  'sal::write_temp and shred_pending_launch_files are Rust and are not reachable from Node',
  'cd src-tauri && DRC_LICH_DRY_RUN=1 cargo test --lib sal'
)
notChecked(
  'the attach retry dials until Lich is up',
  'dial_with_retry (#458) is Rust and needs the app process',
  'cd src-tauri && cargo test --lib game_link'
)

fixture = startFixture()
const listening = await until(() => /listening on/.test(fixtureLog), 10000)
ok('the stand-in Lich is listening', listening, `127.0.0.1:${PORT}`)

gameLink.subscribeGame(() => {})
let attached = null
try {
  attached = await gameLink.attachGame(PORT)
} catch (e) {
  ok('attach succeeds against the stand-in', false, e.message)
}
if (attached) {
  ok('attach succeeds against the stand-in', attached.connected === true, JSON.stringify(attached.note || ''))
  ok(
    'and the window reads the link as connected',
    gameLink.linkPhase(gameLink.gameState()) === 'connected',
    gameLink.linkPhase(gameLink.gameState())
  )
}

// ============================================================ PHASE 3
// Play. Everything below is driven by text that came through the socket.

console.log('\n== phase 3: play a session ==')

// Wait for the fixture to have replayed enough to have said everything the
// panels need, rather than for a guessed interval.
const delivered = await until(() => {
  const s = gameLink.streamCharacterState()
  return (
    gameLink.gameLines().length > 25 &&
    !!s.roomPresentation &&
    !!s.compass &&
    Object.keys(s.vitals?.value ?? {}).length >= 4 &&
    gameLink.gameStreams().includes('whispers')
  )
}, 25000, 100)

const lines = gameLink.gameLines()
const state = gameLink.streamCharacterState()

// The denominator, and it is the fragile number: if the socket, the chunking
// or the parser breaks, this is what goes to zero, and every assertion below
// would otherwise be vacuously true over an empty buffer.
ok(
  'the socket delivered a session to parse',
  lines.length >= 25,
  `${lines.length} lines through the socket${delivered ? '' : ' (timed out waiting)'}`
)

/** The panels this session must fill, and what fills each. */
const panels = [
  ['room title', () => (state.roomPresentation?.value?.title ?? '').includes('Firulf Vista')],
  ['exits strip', () => exitControls(state.compass?.value).length >= 3],
  ['vitals', () => Object.keys(state.vitals?.value ?? {}).length >= 4],
  ['status icons', () => Object.keys(state.indicators?.value ?? {}).length >= 5],
  ['room occupants', () => !!describeRoomPlayers(state.roomPlayers)],
  ['channels', () => gameLink.gameStreams().length >= 3],
]
const filled = panels.filter(([, f]) => {
  try {
    return f()
  } catch {
    return false
  }
})
ok(
  'every panel this session feeds is populated',
  filled.length === panels.length,
  `${filled.length} of ${panels.length}: missing ${panels.filter((p) => !filled.includes(p)).map((p) => p[0]).join(', ') || 'none'}`
)

const vitals = state.vitals?.value ?? {}
ok(
  'vitals are numbers, read from text and not from value',
  (vitals.health?.max ?? 0) === 100 && (vitals.mana?.current ?? 0) > 0,
  JSON.stringify(vitals)
)
ok(
  'the exits strip offers the words the compass sent',
  exitControls(state.compass?.value).every((c) => c.command === c.label),
  exitControls(state.compass?.value).map((c) => c.label).join(',')
)

// Channels: the whole point of receiving streams rather than inferring them.
const streams = gameLink.gameStreams()
for (const wanted of ['combat', 'whispers']) {
  ok(
    `the ${wanted} channel is labelled by the game`,
    streams.includes(wanted),
    `channels: ${streams.join(', ')}`
  )
}
ok(
  'a script line arrives in the main window, not a channel',
  lines.some((l) => l.text.startsWith('[go2]') && !l.stream),
  `${lines.filter((l) => l.text.startsWith('[go2]')).length} script lines`
)

// -- highlights and gags, over the lines that actually arrived ---------------

const highlightSource = [
  '#highlight {string} {#FF4444} {swings a scimitar}',
  '#highlight {string} {#66DDFF} {whispers}',
].join('\n')
const { entries: highlights, skipped: highlightsSkipped } = parseHighlights(highlightSource)
// The rules parsed at all. Without this a typo in the fixture rules gives an
// empty rule set, nothing is painted, and "no line was wrongly painted" is
// true and means nothing.
ok(
  'the highlight rules parse',
  highlights.length === 2 && highlightsSkipped.length === 0,
  highlightsSkipped.join('; ') || `${highlights.length} rules`
)
// The denominator: lines the rules name. If the session stops carrying them
// this goes to zero and says so, instead of the check passing vacuously.
const shouldPaint = lines.filter((l) => /swings a scimitar|whispers/.test(l.text))
const painted = lines.filter((l) => paint(l.text, highlights).spans.length > 0)
ok(
  'a highlight paints the lines it names and no others',
  shouldPaint.length > 0 &&
    painted.length === shouldPaint.length &&
    painted.every((l) => /swings a scimitar|whispers/.test(l.text)),
  `${painted.length} painted of ${shouldPaint.length} the rules name, out of ${lines.length} lines`
)

resetLineRuleCache()
const gagRules = {
  substitutes: [],
  gags: [{ id: 'g1', enabled: true, source: 'player', pattern: 'GENIE HAS FLAGGED YOU AS IDLE' }],
}
const gagCandidates = lines.filter((l) => /GENIE HAS FLAGGED/.test(l.text))
const gagged = gagCandidates.filter((l) => applyLineRules(l.text, gagRules).gagged)
ok(
  'a gag hides the line it names',
  gagCandidates.length > 0 && gagged.length === gagCandidates.length,
  `${gagged.length} of ${gagCandidates.length} candidates gagged`
)
ok(
  'and the raw line survives in the buffer, so an alert still sees it',
  gameLink.gameLines().some((l) => /GENIE HAS FLAGGED/.test(l.text)),
  'the buffer is unchanged; rules are applied on read'
)

// -- aliases ---------------------------------------------------------------

const { entries: aliases } = parseAliases('#alias {gt} {go through gate}')
const expanded = expandAlias('gt', aliases)
ok('an alias expands before the command goes out', expanded.expanded && expanded.text === 'go through gate', JSON.stringify(expanded.text))

// -- the outbound lane ------------------------------------------------------

const before = laneRecord.length
const sawBefore = fixtureSaw().length

// A player types. The distinguishable words are chosen so the far-side
// comparison is about order rather than about content.
await gameLink.sendGame('look', 'player')
// An exit word is clicked. The command is the label, which is the type's
// promise in roomExits.ts.
const exitWord = exitControls(state.compass?.value)[0]
if (SABOTAGE === 'bypass-lane') {
  // The seam. A caller that reaches the socket without entering the outbound
  // path is exactly the defect `command_gate.rs` exists to prevent, and this
  // is what it looks like from here.
  wire?.write(`${exitWord.command}\r\n`)
} else {
  await gameActions.sendGameAction(exitWord.command, exitWord.label, 'ui-action')
}
// A numpad hotkey. The resolver is the real one; NumPad8 is a shipped default.
const resolved = resolveKeybinding({ key: '8', code: 'Numpad8' }, false, [])
ok('a numpad key resolves to a game command', resolved?.kind === 'game', JSON.stringify(resolved))
if (resolved?.kind === 'game') await gameLink.sendGame(resolved.command, 'keybind')

const arrived = await until(() => fixtureSaw().length >= sawBefore + 3, 5000)
const saw = fixtureSaw().slice(sawBefore)
const asked = laneRecord.slice(before).map((e) => e.command)
ok(
  'every command the player caused reached the game',
  arrived && saw.length >= 3,
  `${saw.length} of 3 observed by the fixture: ${saw.join(' | ')}`
)
ok(
  'and each one entered the outbound path, in order',
  saw.length > 0 && asked.length === saw.length && asked.every((c, i) => c === saw[i]),
  `sent ${JSON.stringify(asked)} vs observed ${JSON.stringify(saw)}`
)
ok(
  'and each one named who asked for it',
  laneRecord.slice(before).every((e) => e.source),
  laneRecord.slice(before).map((e) => `${e.command}=${e.source}`).join(', ')
)

// -- roundtime -------------------------------------------------------------
//
// The hold itself is Rust. What this can establish is the two halves either
// side of it: that the fixture puts a roundtime on the wire in a form the one
// implementation recognises, and that the window reads a hold when the lane
// reports one.

const gateSource = readFileSync(join(root, 'src-tauri', 'src', 'command_gate.rs'), 'utf8')
const rtForms = ['<roundTime', '<castTime', 'Roundtime:', '...wait ']
const declared = rtForms.filter((f) => gateSource.includes(`"${f}"`) || gateSource.includes(`["${f}"`))
const onWire = rtForms.filter((f) => new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(fixtureLog + lines.map((l) => l.text).join('\n')))
ok(
  'the roundtime on the wire is a form the lane parses',
  onWire.length > 0 && onWire.every((f) => rtForms.includes(f)),
  `on the wire: ${onWire.join(', ') || 'none'}; declared in command_gate.rs: ${declared.join(', ')}`
)

// Subscribe before publishing. `commandLane.wire()` is lazy — it installs the
// `game:lane` listener on the first read — so an event emitted before anything
// had asked for the status would land on nobody, and the check would report a
// lane that never held rather than a listener that was never installed.
commandLane.commandLaneStatus()
laneStatus = { ...commandLane.EMPTY_LANE_STATUS, queued: 1, holdingUntilMs: Date.now() + 5000 }
emit('game:lane', laneStatus)
await sleep(20)
ok(
  'the window shows a hold while the lane reports one',
  commandLane.commandLaneStatus().holdingUntilMs > Date.now(),
  `holdingUntilMs=${commandLane.commandLaneStatus().holdingUntilMs}`
)
laneStatus = { ...commandLane.EMPTY_LANE_STATUS, queued: 0, holdingUntilMs: 0, sent: 1 }
emit('game:lane', laneStatus)
await sleep(20)
ok(
  'and the hold clears when the lane says the wire is free',
  commandLane.commandLaneStatus().holdingUntilMs === 0
)
notChecked(
  'the lane actually defers a command until the hold lifts',
  'the queue, the pacing and the priority ordering are src-tauri/src/command_gate.rs and need Rust',
  'cd src-tauri && cargo test --lib command_gate  (and node tools/command-lane-break-check.mjs)'
)

// -- pause and stop ---------------------------------------------------------

flowStop.requestPauseAll()
ok('Pause latches automation', flowStop.isAutomationPaused() === true)
ok(
  'a macro is refused while paused',
  canSendMacro({ stopLatched: true, connected: true }).canSend === false,
  canSendMacro({ stopLatched: true, connected: true }).reason ?? ''
)
ok(
  'and the reading a person sees names the state',
  pauseStatus({ appPaused: true }).state.startsWith('paused'),
  pauseStatus({ appPaused: true }).label
)
// The player is not automation. A person who types while paused is still
// typing, and this is the half of Pause that must not fire.
const pausedSendAt = fixtureSaw().length
await gameLink.sendGame('health', 'player')
const playerGotThrough = await until(() => fixtureSaw().length > pausedSendAt, 4000)
ok('but a player-typed command still goes out', playerGotThrough, `${fixtureSaw().length - pausedSendAt} observed`)
flowStop.requestResumeAll()

// -- the macro, dry run then real ------------------------------------------

const dry = []
const dryResult = runMacroCommands(['stand', 'go gate'], { send: (c) => dry.push(c), dryRun: true })
ok('a macro dry run sends nothing', dry.length === 0 && dryResult.sent.length === 0, `plan: ${dryResult.plan.join(' | ')}`)
ok('and still shows the whole plan', dryResult.plan.length === 2, dryResult.plan.join(' | '))
const fired = []
const fireResult = runMacroCommands(['stand', 'go gate'], { send: (c) => fired.push(c) })
ok(
  'firing it sends exactly the plan, in order',
  fired.length === 2 && fired.join('|') === dryResult.plan.join('|'),
  `${fired.length} of ${dryResult.plan.length}: ${fired.join(' | ')} (refused: ${fireResult.refused ?? 'none'})`
)

// -- Stop -------------------------------------------------------------------

laneRecord.push({ command: 'north', source: 'script' })
const flushedBefore = laneStatus?.flushed ?? 0
flowStop.requestStopAll()
const flushRan = await until(() => (laneStatus?.flushed ?? 0) > flushedBefore, 4000)
ok('Stop flushes the automation the lane was holding', flushRan, `flushed=${laneStatus?.flushed ?? 0}`)

// ============================================================ PHASE 4
// The socket drops. Nothing here is allowed to lie about it.

console.log('\n== phase 4: the link drops and comes back ==')

let reconnected = 0
gameLink.onGameReconnect(() => {
  reconnected += 1
})

if (SABOTAGE !== 'early-drop') stopFixture()
// The 'early-drop' seam kills nothing, so the socket never closes and the
// reconnect step has nothing to observe - which is what it must report.
const wentDown = await until(() => droppedUnexpectedly, 6000)
ok('the client notices the socket closing', wentDown, `droppedUnexpectedly=${droppedUnexpectedly}`)
ok(
  'and reads the link as reconnecting, not as connected',
  gameLink.linkPhase(gameLink.gameState()) === 'reconnecting',
  gameLink.linkPhase(gameLink.gameState())
)
ok(
  'the placeholder says so instead of inviting a command',
  /reconnect/i.test(gameLink.linkPhasePlaceholder(gameLink.gameState())),
  JSON.stringify(gameLink.linkPhasePlaceholder(gameLink.gameState()))
)

// The stale mark is the bridge's half of the same drop, and it is a separate
// fact: a socket that came back is not data that came back.
const marked = staleMark.nextStaleSince({
  status: 'reconnecting',
  hasData: true,
  staleSince: staleMark.FRESH,
  now: Date.now(),
})
ok('a drop marks the data stale', staleMark.isStale(marked), `staleSince=${marked}`)
ok('and the mark says how old in a sentence', !!staleMark.staleNote(marked, Date.now() + 9000), staleMark.staleNote(marked, Date.now() + 9000) ?? '')

fixture = startFixture()
await until(() => /listening on/.test(fixtureLog), 10000)
droppedUnexpectedly = false
let back = null
try {
  back = await gameLink.attachGame(PORT)
} catch (e) {
  ok('the client reattaches', false, e.message)
}
if (back) {
  ok('the client reattaches', back.connected === true)
  emit('game:reconnected', 1)
  await sleep(20)
  ok('and the reconnect edge fires once, so the stale parser is dropped', reconnected === 1, `${reconnected} reconnect edges`)
  const replayed = gameLink.gameLines().length
  const grew = await until(() => gameLink.gameLines().length > replayed, 15000, 100)
  ok('the session replays after the reconnect', grew, `${gameLink.gameLines().length} lines after ${replayed}`)
  ok(
    'and the stale mark clears when data lands',
    staleMark.isStale(staleMark.clearedByFreshData()) === false,
    `clearedByFreshData()=${staleMark.clearedByFreshData()}`
  )
}

// ============================================================ PHASE 5
// The configuration is the player's, and it survives.

console.log('\n== phase 5: the player configuration round trips ==')

const seeded = {
  ...playerConfig.emptyPlayerConfig(),
  aliases: [{ id: 'a1', enabled: true, source: 'player', name: 'gt', expansion: 'go through gate' }],
  gags: [{ id: 'g1', enabled: true, source: 'player', pattern: 'GENIE HAS FLAGGED YOU AS IDLE' }],
}
const doc = transfer.exportPlayerConfig(seeded, 'player')
const text = transfer.serializePlayerConfig(doc)
ok('the export is bytes, ending in a newline', text.endsWith('\n') && text.length > 40, `${text.length} bytes`)
// Determinism: two exports of one store must be the same file, or a diff is a
// key order and nobody can review it.
ok('and two exports of one store are byte-identical', text === transfer.serializePlayerConfig(transfer.exportPlayerConfig(seeded, 'player')))

const preview = transfer.previewPlayerConfigImport(JSON.parse(text), 'replace-all', playerConfig.emptyPlayerConfig())
ok('the export imports back', preview.ok === true, preview.ok ? '' : preview.reason)
if (preview.ok) {
  const domains = playerConfig.DOMAINS
  const same = domains.filter(
    (d) => JSON.stringify(preview.config[d]) === JSON.stringify(seeded[d])
  )
  ok(
    'and every domain comes back as it went out',
    same.length === domains.length,
    `${same.length} of ${domains.length} domains identical: missing ${domains.filter((d) => !same.includes(d)).join(', ') || 'none'}`
  )
  const applied = transfer.applyPlayerConfigImport(preview.config)
  ok('applying it writes every domain', applied.ok === true, applied.failures.map((f) => `${f.domain}: ${f.message}`).join('; '))
}

// A reload is a fresh read of storage with the process's own caches gone. The
// store is what has to carry the setting across it, and the check is that the
// bytes in storage say so rather than that a variable in this process does.
persistence.savePrefs({ setupComplete: true })
playerConfig.resetPlayerConfigCache?.()
ok('a preference written before a reload is in storage', /setupComplete/.test(memory.get(persistence.PREFS_STORAGE_KEY) ?? ''), persistence.PREFS_STORAGE_KEY)
ok('and reads back after one', persistence.loadPrefs().setupComplete === true)
const aliasKey = playerConfig.storageKeyFor('aliases')
ok(
  'and so does the imported configuration',
  /go through gate/.test(memory.get(aliasKey) ?? ''),
  aliasKey
)

// ============================================================ PHASE 6
// The honesty of what is missing.

console.log('\n== phase 6: what is absent says so, and is not reachable ==')

/*
 * The popped-out panel route. `PanelWindow.tsx` is TSX and there is no
 * component-render harness in this repository - `tools/viewer-absent-test.mjs`
 * writes down the same gap rather than pretending otherwise - so this reads
 * the guard and the sentence out of the source and says that is what it is.
 * Two things are asserted, and the second is the one that matters: that the
 * lookup is `Object.hasOwn` (a plain lookup answers `toString` with
 * `"[object Undefined]"` and `constructor` with a crash), and that the
 * fall-through names the id rather than rendering an empty window.
 */
const panelWindow = readFileSync(join(root, 'src', 'components', 'PanelWindow.tsx'), 'utf8')
ok(
  'an unknown panel id is looked up safely',
  /Object\.hasOwn\(\s*PANEL_CONTENT/.test(panelWindow),
  'source check: src/components/PanelWindow.tsx'
)
ok(
  'and gets a named state, not a blank window',
  /No panel called \{id\}/.test(panelWindow),
  'source check: src/components/PanelWindow.tsx'
)
const panelIds = [...readFileSync(join(root, 'src', 'lib', 'layout.ts'), 'utf8').matchAll(/export type PanelId =([^\n]*(?:\n\s*\|[^\n]*)*)/g)]
  .flatMap((m) => [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]))
console.log(`     panel ids today: ${panelIds.join(', ') || '(none parsed)'}`)
ok(
  'the panel id list parsed, so the line above is a fact',
  panelIds.length >= 5,
  `${panelIds.length} ids`
)
if (panelIds.includes('map')) {
  notChecked(
    'the removed map panel is not reachable',
    "docs/NO-3D.md says the map is gone, but `map` is still a PanelId and still renders, " +
      'so there is nothing gone to check yet - and asserting either way would be a claim about a decision rather than about the code',
    "grep -c \"kind === 'map'\" src/App.tsx   # Gate 1 wants 0; the guard above names it gone the moment it is"
  )
} else {
  ok('the removed map panel is not reachable', true, 'map is no longer a PanelId, so PanelWindow names it gone')
}

ok(
  'no panel treats the missing viewer as an error',
  !/error/i.test(viewerClient.viewerStateLabel(viewer, false)),
  viewerClient.viewerStateLabel(viewer, false)
)

// ============================================================== the summary

stopFixture()

/**
 * The floor. Well below the real count, so a run that half-imported, timed out
 * early or was truncated reports itself rather than passing for free, and so
 * this never needs touching when a step is added.
 */
const FLOOR = 45
console.log('\n──────────────────────────────────────────────')
if (checks < FLOOR) {
  console.log(`FAIL only ${checks} checks ran; this file has at least ${FLOOR}`)
  process.exit(1)
}
const verdict = fails === 0 ? `${checks} checks, all passed` : `${fails} of ${checks} FAILED: ${[...new Set(failedSteps)].join('; ')}`
console.log(verdict)
if (skips > 0) {
  // Phrased without the literal "NOT CHECKED" token, deliberately.
  // `tools/run-tests.mjs` counts every line carrying it to build the gate's
  // skip total, and a summary that repeats the token counts this run's four
  // skips twice - which makes the one number a merger reads wrong in the
  // direction that matters.
  console.log(`skipped ${skips} step(s): ${[...new Set(skippedSteps)].join('; ')}`)
  console.log('a step that could not run is not a step that passed.')
}
if (SABOTAGE) console.log(`this run was sabotaged: DRC_E2E_SABOTAGE=${SABOTAGE}`)

// No scratch file is written here on purpose.
//
// The obvious thing is to drop a "last run" note into docs/verification, and
// the first version of this did. It churns on every run, several lanes share
// this tree, and a file that changes whenever anybody runs the suite is a file
// that conflicts in every rebase and tells nobody anything the run's own
// stdout did not. The durable record is
// docs/verification/mud-client-e2e-2026-09-09.md, and that page says plainly
// that where it and this command disagree, the command is right.

process.exit(fails === 0 ? 0 : 1)
