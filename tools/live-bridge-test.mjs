/**
 * Drives the app's own RealBridge against the real Ruby bridge.
 *
 *   node tools/live-bridge-test.mjs
 *
 * server_test.rb proves the Ruby side speaks WebSocket correctly, using a
 * hand-rolled client. This proves the two halves agree — the client the app
 * actually ships, against the server the player actually runs. A protocol
 * mismatch passes both suites separately and fails only here.
 *
 * It starts the bridge itself (Ruby, with Lich stubbed) so there is nothing to
 * set up and nothing left running afterwards.
 */
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PORT = 7894
let fails = 0

function check(label, ok, detail = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  if (!ok) fails++
}

// Node has no browser WebSocket before it does; bail clearly rather than
// failing in a way that looks like a bridge bug.
if (typeof WebSocket === 'undefined') {
  console.log('SKIP this Node has no global WebSocket (needs 22+)')
  process.exit(0)
}

// --- a runnable copy of the bridge, with Lich stubbed and the CLI tail cut ---

const dir = mkdtempSync(join(tmpdir(), 'drc-live-'))
const runner = join(dir, 'run_bridge.rb')
const src = readFileSync('lich-scripts/companion_bridge.lic', 'utf8')
const body = src.match(/module Companion[\s\S]*?\n^end\b/m)
if (!body) {
  console.log('FAIL could not slice the Companion module')
  process.exit(1)
}

writeFileSync(
  runner,
  [
    "require 'socket'",
    "require 'json'",
    "require 'digest/sha1'",
    "require 'base64'",
    'def respond(m) = warn("[lich] #{m}")',
    "LICH_VERSION = '5.20.1'",
    'class FakeScript',
    '  def self.current = new',
    "  def path = 'stub'",
    '  def self.at_exit(&_b) = nil',
    'end',
    'Script = FakeScript',
    body[0],
    `srv = Companion::Server.new(${PORT})`,
    'abort "could not start" unless srv.start',
    '$stdout.puts "READY"; $stdout.flush',
    'sleep 0.2 while srv.running?',
  ].join('\n')
)

const rubyExe = process.env.DRC_RUBY || 'ruby'
const ruby = spawn(rubyExe, [runner], { stdio: ['ignore', 'pipe', 'pipe'] })

const cleanup = () => {
  try { ruby.kill() } catch { /* already gone */ }
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* fine */ }
}
process.on('exit', cleanup)

const ready = new Promise((resolve, reject) => {
  let out = ''
  ruby.stdout.on('data', (d) => {
    out += d
    if (out.includes('READY')) resolve()
  })
  ruby.on('error', reject)
  ruby.on('exit', (code) => reject(new Error(`ruby exited ${code} before ready`)))
  setTimeout(() => reject(new Error('bridge did not come up in 20s')), 20_000)
})

try {
  await ready
} catch (e) {
  console.log(`FAIL ${e.message}`)
  process.exit(1)
}

// --- the app's own client, loaded from source -------------------------------

// Compiled with the project's own tsc, not stripped with regexes.
//
// The first version of this file did strip types by hand and fell over on a
// construct it had not anticipated. That is the wrong failure to have in a test
// whose job is to compare two real implementations: the harness must not be a
// third implementation with its own bugs.
//
// Importing the shipped file rather than copying it is the point. A copy would
// drift and keep passing.
//
// tsc runs through its own JS entry under this Node, not the .cmd shim: on
// Windows spawnSync cannot launch a .cmd without a shell and fails by
// returning status null with no output, which reads as a compile error and
// sends you looking at the wrong file.
const outDir = join(dir, 'out')
const tsc = spawnSync(
  process.execPath,
  [
    'node_modules/typescript/bin/tsc',
    'src/bridge/realBridge.ts',
    '--outDir', outDir,
    '--module', 'esnext',
    '--target', 'es2022',
    '--moduleResolution', 'bundler',
    '--skipLibCheck',
    '--ignoreConfig',
  ],
  { encoding: 'utf8' }
)
if (tsc.status !== 0) {
  const why = tsc.error?.message ?? `${tsc.stdout ?? ''}${tsc.stderr ?? ''}`
  console.log(`FAIL could not compile realBridge.ts (status ${tsc.status}):\n${why}`)
  process.exit(1)
}

// Find what it emitted rather than assuming the layout: tsc mirrors the
// source tree under outDir relative to a common root it picks itself, so the
// file is not reliably at outDir/realBridge.js.
//
// Then copy it to .mjs, because the package is not type:module and Node reads
// a bare .js here as CommonJS.
const emitted = findFile(outDir, 'realBridge.js')
if (!emitted) {
  console.log(`FAIL tsc reported success but emitted no realBridge.js under ${outDir}`)
  process.exit(1)
}
const modPath = join(outDir, 'realBridge.mjs')
writeFileSync(modPath, readFileSync(emitted, 'utf8'))

function findFile(root, name) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      const hit = findFile(full, name)
      if (hit) return hit
    } else if (entry.name === name) {
      return full
    }
  }
  return null
}

let RealBridge
try {
  ;({ RealBridge } = await import(pathToFileURL(modPath).href))
} catch (e) {
  console.log(`FAIL could not load the app's RealBridge: ${e.message}`)
  process.exit(1)
}

console.log("-- the app's client against the real Ruby bridge --")

const client = new RealBridge(`ws://127.0.0.1:${PORT}/companion`)
const seen = []
client.onMessage((m) => seen.push(m))

const statuses = []
// The class calls this onStatus; the facade re-exports it as onLiveStatus.
client.onStatus((s, d) => statuses.push([s, d]))

client.connect()

const waitFor = (pred, ms = 8000) =>
  new Promise((resolve) => {
    const t0 = Date.now()
    const tick = () => {
      const hit = seen.find(pred)
      if (hit) return resolve(hit)
      if (Date.now() - t0 > ms) return resolve(null)
      setTimeout(tick, 50)
    }
    tick()
  })

const hello = await waitFor((m) => m.type === 'hello')
check('connected and got hello', !!hello)
check(
  'protocol number matches what the app expects',
  hello?.protocol === 1,
  String(hello?.protocol)
)
check('bridge version is reported', !!hello?.bridgeVersion, hello?.bridgeVersion)

const status = await waitFor((m) => m.type === 'status')
check('status arrives', !!status)
check('and carries a payload object', typeof status?.payload === 'object')

check(
  'the client reported itself connected',
  statuses.some(([s]) => s === 'connected'),
  JSON.stringify(statuses)
)

// The refusal path, through the app's own send().
client.send({ type: 'intent', intent: 'not_a_real_intent' })
const ack = await waitFor((m) => m.type === 'intent_ack')
check('intent acked back to the app', !!ack)
check('refused, with ok:false', ack?.ok === false, JSON.stringify(ack))
check('and a reason the app can show', !!ack?.detail, ack?.detail?.slice(0, 60))

client.disconnect()

console.log('')
console.log(fails === 0 ? 'all passed' : `${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
