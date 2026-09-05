/**
 * Runs lich-scripts/test/protocol_harness.rb and talks to it.
 *
 * The harness stubs the Lich runtime so companion_bridge.lic can serve the
 * real protocol outside the game. It has existed since 25 Aug 2026, works, and
 * was documented in two places as a two-shell manual procedure — which meant
 * nothing ran it, and nobody would have known if it stopped working. This is
 * the loader: one command starts the harness, drives it with the independent
 * client in tools/ws-client.mjs, asserts the frames, and stops the process it
 * started (by PID; never by image name — other Ruby processes on this machine
 * belong to Lich).
 *
 * Three outcomes, never two, following tools/ruby-test.mjs:
 *
 *   the exchange ran and matched     exit 0
 *   the exchange ran and did not     exit 1, naming what was missing
 *   Ruby could not be found          exit 0, NOT CHECKED, and says so
 *
 * It needs a free TCP port and a Ruby, so it is deliberately outside
 * tools/test-suites.json; `npm run test:needs-env` lists it with that reason.
 */
import { spawn } from 'node:child_process'
import { findRuby, notCheckedMessage } from './find-ruby.mjs'
import { runProtocolClient, EXPECTED_TYPES } from './ws-client.mjs'

const RUNNER = 'lich-scripts/test/protocol_harness.rb'
const SUBJECT = 'lich-scripts/companion_bridge.lic'
// Overridable so the "port already busy" path can be exercised on purpose, and
// so a second session running this cannot collide with the first.
const PORT = Number(process.env.DRC_HARNESS_PORT || 7419)

console.log(`-- ${RUNNER}, under Ruby, on port ${PORT} --`)

const ruby = findRuby()
if (!ruby) {
  console.log(notCheckedMessage(RUNNER))
  process.exit(0)
}

const child = spawn(ruby, [RUNNER, SUBJECT, String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] })
let harnessOutput = ''
child.stdout.on('data', (d) => (harnessOutput += d))
child.stderr.on('data', (d) => (harnessOutput += d))

const stopHarness = () => {
  // The PID we started, and nothing else.
  if (child.exitCode === null && child.signalCode === null) child.kill()
}
process.on('exit', stopHarness)

/** Waits for the harness's own "listening" line rather than sleeping a guess. */
const listening = new Promise((resolve, reject) => {
  const deadline = setTimeout(
    () => reject(new Error(`harness did not report listening within 15s:\n${harnessOutput}`)),
    15_000,
  )
  const poll = setInterval(() => {
    if (/listening on ws:/.test(harnessOutput)) {
      clearInterval(poll)
      clearTimeout(deadline)
      resolve()
    }
    if (child.exitCode !== null) {
      clearInterval(poll)
      clearTimeout(deadline)
      reject(new Error(`harness exited ${child.exitCode} before listening:\n${harnessOutput}`))
    }
  }, 100)
})

let failures = 0
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`)
  if (!ok) failures += 1
}

try {
  await listening
  const { types, lines } = await runProtocolClient({
    url: `ws://127.0.0.1:${PORT}/companion`,
  })

  for (const t of EXPECTED_TYPES) check(types.includes(t), `bridge sent a "${t}" frame`)

  // The refusal path is the one worth having: an unimplemented intent must be
  // acknowledged as a refusal, not silently dropped and not an error frame.
  check(
    lines.some((l) => l.startsWith('ACK stop_all ok=true')),
    'stop_all acknowledged as done',
  )
  check(
    lines.some((l) => l.startsWith('ACK town_run ok=false')),
    'an unimplemented intent is refused, not dropped',
  )
  // Garbage in must not take the socket down: the client only reaches CLOSED
  // by closing on its own schedule, after the non-JSON send.
  check(
    lines.some((l) => l.startsWith('CLOSED.')),
    'the socket survived a non-JSON message',
  )

  // Say what was compared, so a run that asserted nothing cannot read as a pass.
  console.log(`checked ${EXPECTED_TYPES.length + 3} properties against ${types.length} frame types`)
} finally {
  stopHarness()
}

if (failures) {
  console.error(`${failures} failed`)
  process.exit(1)
}
console.log('all passed')
