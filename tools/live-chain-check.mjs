/**
 * Ask the running app, over its real socket, whether the live chain works.
 *
 * # Why this is not in `test-suites.json`
 *
 * Every other suite in this repository runs against source. This one runs
 * against a *running DR Companion* - it reads the port and token that
 * `presentation_bridge.rs` wrote into the app data directory, opens the same
 * loopback socket the Godot viewer opens, and speaks the same protocol. With
 * no app up there is nothing to check, and a suite that cannot fail is not a
 * check. So it stays out of the full run and is listed instead as a
 * needs-environment suite (`npm run test:needs-env`, increment C6).
 *
 * # What it establishes, and what it cannot
 *
 * It stands in for the viewer, not for the player. It proves the app is
 * publishing a real snapshot and that the intent boundary refuses a room the
 * app never published. It says nothing about whether Godot renders any of
 * that - `docs/verification/live-chain-2026-09-05.md` is where the eyes-on
 * half of the same chain is recorded, including what that run failed to
 * establish.
 *
 * # Use
 *
 *   node tools/live-chain-check.mjs            against the running app
 *   node tools/live-chain-check.mjs --token x  the negative case: auth must fail
 *   node tools/live-chain-check.mjs --dir D    a different app data directory
 *
 * Prints OK or FAIL per step and a count, because a run that stopped early and
 * a run that found nothing wrong otherwise print the same reassuring nothing.
 * Exits 1 on any FAIL, and on the overall deadline - naming the step it was
 * waiting on, since "it hung" and "step 4 never answered" send a reader to two
 * different places.
 */
import { readFileSync } from 'node:fs'
import net from 'node:net'
import { join } from 'node:path'

const args = process.argv.slice(2)
const option = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

// Names from src-tauri/src/presentation_bridge.rs. Spelled here because
// nothing else compares the two, and a rename there would otherwise show up
// as "the app is not running".
const PORT_FILE = 'presentation-bridge.port'
const TOKEN_FILE = 'presentation-bridge.token'

const DEADLINE_MS = 5000
const SNAPSHOT_MS = 2000

/** Every step this run is meant to perform, in order. The denominator. */
const STEPS = ['files', 'connect', 'hello', 'auth', 'snapshot', 'intent-rejected']

const results = new Map()
let waitingOn = STEPS[0]

function ok(step, detail) {
  results.set(step, true)
  console.log(`OK   ${step}${detail ? ` - ${detail}` : ''}`)
}

function fail(step, reason) {
  results.set(step, false)
  console.log(`FAIL ${step}: ${reason}`)
}

/**
 * The only exit. Reports the count as well as the verdict: a run that stopped
 * at step two has zero failures, and reporting that as a pass is the exact
 * defect this file exists to catch elsewhere.
 */
function finish(socket) {
  if (socket) socket.destroy()
  const passed = [...results.values()].filter(Boolean).length
  const failed = [...results.values()].filter((v) => v === false).length
  const missing = STEPS.filter((s) => !results.has(s))
  console.log('')
  console.log(`${passed} of ${STEPS.length} steps passed, ${failed} failed, ${missing.length} never ran`)
  if (missing.length) console.log(`did not run: ${missing.join(', ')}`)
  if (failed === 0 && missing.length === 0) {
    console.log('all passed')
    process.exit(0)
  }
  process.exit(1)
}

const dir = option('dir') || join(process.env.LOCALAPPDATA || '.', 'DR Companion Data')

let port
let token
try {
  const portPath = join(dir, PORT_FILE)
  const tokenPath = join(dir, TOKEN_FILE)
  port = Number(readFileSync(portPath, 'utf8').trim())
  token = option('token') ?? readFileSync(tokenPath, 'utf8').trim()
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail('files', `${portPath} does not hold a port number`)
    finish(null)
  }
  ok('files', `port ${port}, token ${token.length} chars, from ${dir}`)
  // Advance before the socket is opened, or a refusal is reported against the
  // step that already passed - which both mislabels it and un-passes a step
  // that genuinely succeeded.
  waitingOn = 'connect'
} catch (e) {
  fail('files', `${e.message} - is DR Companion running?`)
  finish(null)
}

const socket = net.connect(port, '127.0.0.1')
socket.setNoDelay(true)

const deadline = setTimeout(() => {
  fail(waitingOn, `nothing answered within ${DEADLINE_MS} ms`)
  finish(socket)
}, DEADLINE_MS)
deadline.unref?.()

let snapshotTimer = null

socket.on('connect', () => {
  ok('connect', `127.0.0.1:${port}`)
  waitingOn = 'hello'
})

socket.on('error', (e) => {
  // A refusal is a real answer and must not read as a hang: with no app up
  // this is the line a reader should see.
  fail(waitingOn, `${e.code || e.message}`)
  clearTimeout(deadline)
  finish(socket)
})

socket.on('close', () => {
  if (results.has('intent-rejected')) return
  fail(waitingOn, 'the bridge closed the connection')
  clearTimeout(deadline)
  finish(socket)
})

const send = (message) => socket.write(`${JSON.stringify(message)}\n`)

let buffer = ''
socket.on('data', (chunk) => {
  buffer += chunk.toString('utf8')
  let cut
  while ((cut = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, cut)
    buffer = buffer.slice(cut + 1)
    if (!line.trim()) continue
    let message
    try {
      message = JSON.parse(line)
    } catch {
      fail(waitingOn, `the bridge sent something that is not JSON: ${line.slice(0, 80)}`)
      clearTimeout(deadline)
      finish(socket)
      return
    }
    handle(message)
  }
})

function handle(message) {
  switch (message.type) {
    case 'hello': {
      if (message.protocol !== 1) {
        fail('hello', `protocol ${message.protocol}, expected 1`)
        clearTimeout(deadline)
        finish(socket)
        return
      }
      ok('hello', 'protocol 1')
      waitingOn = 'auth'
      send({ type: 'auth', token })
      return
    }
    case 'auth_ok': {
      ok('auth')
      waitingOn = 'snapshot'
      // A separate, tighter budget than the overall one: a bridge that
      // authenticates and then never publishes is a different bug from a
      // bridge that never answers at all.
      snapshotTimer = setTimeout(() => {
        fail('snapshot', `no snapshot within ${SNAPSHOT_MS} ms of auth_ok`)
        clearTimeout(deadline)
        finish(socket)
      }, SNAPSHOT_MS)
      snapshotTimer.unref?.()
      return
    }
    case 'auth_failed': {
      fail('auth', 'the bridge rejected the token')
      clearTimeout(deadline)
      finish(socket)
      return
    }
    case 'snapshot': {
      if (results.has('snapshot')) return
      clearTimeout(snapshotTimer)
      if (!Number.isFinite(message.sequence)) {
        fail('snapshot', `sequence is ${JSON.stringify(message.sequence)}, not a number`)
        clearTimeout(deadline)
        finish(socket)
        return
      }
      const cells = Array.isArray(message.cells) ? message.cells.length : 0
      ok('snapshot', `sequence ${message.sequence}, room ${message.currentRoomId}, ${cells} cells`)
      waitingOn = 'intent-rejected'
      // A room the app cannot have published, so an acceptance here would mean
      // the boundary is taking the viewer's word for the world - the one thing
      // presentation_bridge.rs exists to refuse.
      send({
        type: 'intent',
        kind: 'walk',
        fromRoomId: `not-a-room-${Date.now()}`,
        exitMove: 'northwest',
      })
      return
    }
    case 'intent_rejected': {
      ok('intent-rejected', String(message.reason || '').slice(0, 80))
      clearTimeout(deadline)
      finish(socket)
      return
    }
    case 'intent_accepted': {
      fail('intent-rejected', 'a walk from a room the app never published was accepted')
      clearTimeout(deadline)
      finish(socket)
      return
    }
    default:
      // events and anything later in the protocol are not this check's
      // business; ignoring them is correct, and silence here is not a skip
      // because every step has its own deadline.
      return
  }
}
