/**
 * The stale-bridge warning may only name controls that exist, and the repair
 * it describes has to be completable inside the app (issue #539).
 *
 * # What went wrong
 *
 * The message read "Reinstall it from Setup, then start the bridge again."
 * There is nothing in this app called Setup - searching every button, link and
 * summary in the running app for `setup|install|bridge|reinstall|wizard`
 * returned one relevant control, Settings -> "Ruby, Lich and your frontend" ->
 * "Check what is installed" - and the second half of the sentence had no route
 * at all. Measured on Dan's live session after a successful reinstall:
 *
 *     versions.actualBridge   0.11.0     <- still the old script, in memory
 *     installed file          0.14.0     <- current
 *
 * because Lich runs the copy it read off disk at start-up. `;companion_bridge
 * stop` typed into the game bar did nothing, **Stop all** is far too broad to
 * offer for a version mismatch, and "Run companion_bridge" cannot restart a
 * script that is already running. So a player who followed the advice exactly
 * ended with a current file, a stale bridge, and the same warning next time.
 *
 * # The property, not the wording
 *
 * The checks below do not assert a sentence. They take every phrase the
 * message puts in quotation marks - which is how it names a control - and
 * require each one to be a label something actually renders. A rewrite of the
 * prose passes; a rewrite that invents a control does not. That is the same
 * shape as `first-screen-test.mjs`'s rule about a screen that says one thing
 * while the button under it offers another.
 *
 * # And why none of this needed the bridge script
 *
 * `;kill <script>` is Lich's own command. The last two checks hold the restart
 * to that: it must be Lich's vocabulary, not an argument the bridge would have
 * to implement, because `lich-scripts/companion_bridge.lic` is a 3,351-line
 * dispatch table that one increment at a time may touch (PLAN_TO_1_0.md §3)
 * and a repair that needs a working bridge to repair a broken one is not a
 * repair anyway.
 */
import { readFileSync } from 'node:fs'
import {
  compareVersions,
  REINSTALL_CONTROL,
  RESTART_CONTROL,
  SETTINGS_BRIDGE_SECTION,
} from '../src/lib/versions.ts'
import { bridgeRestartCommands } from '../src/lib/frontends.ts'

let checked = 0
let failed = 0
const ok = (name, cond, detail = '') => {
  checked++
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(62)}${detail}`)
}

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
const settings = read('src/components/layout/SettingsSheet.tsx')
const restart = read('src/components/shared/BridgeRestart.tsx')
const versions = read('src/lib/versions.ts')

console.log('-- the stale-bridge message --')
const verdict = compareVersions({
  app: '0.1.1',
  expectedBridge: '0.14.0',
  actualBridge: '0.11.0',
  lich: '5.12.0',
  protocol: 3,
})
ok('a lower running version is judged stale', verdict.verdict === 'stale_bridge', verdict.verdict)
ok('and it has a message to check', Boolean(verdict.message))
const message = verdict.message ?? ''

/*
 * Every control the message names, taken from the message itself rather than
 * listed here. A hardcoded list would agree with a message that had gone on
 * to name a fourth control nobody rendered.
 */
const named = [...message.matchAll(/"([^"]+)"/g)].map((m) => m[1])
ok('the message names at least two controls', named.length >= 2, JSON.stringify(named))

/*
 * Where a name has to be findable. Both files render these as label text, so
 * an `includes` is the right question: the constant is interpolated, so what
 * is asserted is that the *constant* reaches a rendered position.
 */
const RENDERERS = { 'SettingsSheet.tsx': settings, 'BridgeRestart.tsx': restart }
const CONSTANT_FOR = {
  [SETTINGS_BRIDGE_SECTION]: 'SETTINGS_BRIDGE_SECTION',
  [REINSTALL_CONTROL]: 'REINSTALL_CONTROL',
  [RESTART_CONTROL]: 'RESTART_CONTROL',
}
for (const name of named) {
  const constant = CONSTANT_FOR[name]
  ok(
    `"${name}" is a constant this app renders`,
    Boolean(constant) &&
      Object.values(RENDERERS).some((src) => src.includes(`{${constant}}`)),
    constant ? `via ${constant}` : 'no constant in versions.ts produces this string'
  )
}

/*
 * The control that never existed. Kept as an explicit case rather than trusted
 * to the loop above, because "from Setup" was prose and not a quoted name, so
 * nothing above would have caught it coming back.
 */
ok(
  'the message no longer sends anyone to a control called Setup',
  !/\bfrom Setup\b/.test(message),
  message.slice(0, 90)
)
ok(
  'CONTROL: that phrase is findable when present',
  /\bfrom Setup\b/.test('reinstall it from Setup, then')
)

ok(
  'and it says the running script is a separate thing from the file',
  /still running|read off disk|in memory/i.test(message),
  message.slice(-140)
)

console.log('\n-- the restart itself --')
const [kill, start] = bridgeRestartCommands(null)
ok('two commands, in order', Boolean(kill) && Boolean(start), `${kill} | ${start}`)
ok('the first stops the running script', /(^|\s)\S?kill companion_bridge$/.test(kill), kill)
ok('the second starts the copy now on disk', /companion_bridge$/.test(start) && !/kill/.test(start), start)
ok(
  "both carry this app's own Lich prefix",
  kill.startsWith(';') && start.startsWith(';'),
  `${kill} | ${start}`
)
/*
 * The constraint that decided the design. `;companion_bridge stop` was tried
 * against a live Lich and did nothing, and making it work would mean editing
 * the bridge script - which is exactly the file this repo lets one increment
 * hold at a time, and which a wedged bridge may not be able to run anyway.
 */
ok(
  'neither command is an argument the bridge script would have to implement',
  !/companion_bridge\s+\S/.test(kill.replace(/^\S*kill\s+/, 'kill ')) &&
    !/companion_bridge\s+\S/.test(start),
  `${kill} | ${start}`
)
ok(
  'the restart goes out on the game socket, not through the bridge',
  restart.includes('sendGame') && !/requestIntent|bridge\.send/.test(restart),
  'sendGame'
)
ok(
  'and it names the commands it ran in the log',
  restart.includes('addLog(`Sent ${kill}') || restart.includes('Sent ${kill}'),
  'addLog'
)

console.log('\n-- the constants have one home --')
for (const [name, constant] of Object.entries(CONSTANT_FOR)) {
  ok(
    `${constant} is declared in versions.ts`,
    new RegExp(`export const ${constant} = `).test(versions),
    name
  )
}
/*
 * The drift this is really about: a second copy of a label typed into the
 * component would let the message and the button disagree again, silently.
 */
ok(
  'SettingsSheet renders the heading from the constant, not a typed copy',
  !settings.includes(`>${SETTINGS_BRIDGE_SECTION}<`) &&
    !settings.includes(`\n                ${SETTINGS_BRIDGE_SECTION}\n`),
  SETTINGS_BRIDGE_SECTION
)

console.log('')
// Far below the real count on purpose: a tripwire for a truncated or
// half-loaded run, not a regression test on the number of cases.
const MIN_EXPECTED = 12
if (checked < MIN_EXPECTED) {
  console.error(`FAILED: only ${checked} checks ran, expected at least ${MIN_EXPECTED}`)
  process.exit(1)
}
console.log(`${checked} checked, ${failed} failed`)
if (failed) {
  console.error('FAILED')
  process.exit(1)
}
console.log('all passed')
