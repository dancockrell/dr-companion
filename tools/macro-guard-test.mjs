/**
 * A macro cannot be sent while the stop latch is up.
 *
 * Asserted as the property, not the mechanism. Nothing here checks that a
 * button carries `disabled` - a rewrite that guards the send some other way
 * still has to pass this, and a rewrite that leaves the attribute on while
 * sending anyway still has to fail it.
 *
 * The defect these cover is not that a blocked macro runs. The bridge already
 * refuses it correctly, with `ok: false` and "stopped - press Resume". The
 * defect is that the button looked exactly as available as it did a second
 * earlier, so the only way to learn the rule was to press and be refused - the
 * same class as a Stop button that does not stop, which this repo has already
 * paid for once.
 */
import { canSendMacro } from '../src/lib/canSendMacro.ts'
import { createMacroFlightGate } from '../src/lib/macroFlightGate.ts'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let failed = 0
let checked = 0
const ok = (name, cond, detail = '') => {
  checked++
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(56)}${detail}`)
}

console.log('-- the ordinary case, or none of the rest means anything --')
{
  const s = canSendMacro({ stopLatched: false, inFlight: false, connected: true })
  ok('an idle, unlatched, connected character can send', s.canSend === true)
  ok('and there is nothing to tell them', s.reason === null, String(s.reason))
}

console.log('\n-- the latch --')
{
  const s = canSendMacro({ stopLatched: true, inFlight: false, connected: true })
  ok('a macro cannot be sent while the latch is up', s.canSend === false)
  ok('and the way out is named, not the diagnosis', /resume/i.test(s.reason ?? ''), s.reason)
}

console.log('\n-- an older bridge, which does not send the field at all --')
{
  // undefined must read as false. A bridge that predates `stopLatched`
  // behaves exactly as an unlatched one, and treating absence as "blocked"
  // would break every macro against it - a pre-emptive fix that makes things
  // worse than the refusal it was meant to complement.
  const s = canSendMacro({ stopLatched: undefined, inFlight: false, connected: true })
  ok('undefined reads as unlatched, not as blocked', s.canSend === true, String(s.reason))
}

console.log('\n-- one macro at a time --')
{
  const s = canSendMacro({ stopLatched: false, inFlight: true, connected: true })
  ok('a second macro cannot queue behind the first', s.canSend === false)
  ok('and it says something is already running', /running/i.test(s.reason ?? ''), s.reason)
}

console.log('\n-- every launcher shares one atomic flight gate --')
{
  let now = 1000
  const scheduled = []
  const gate = createMacroFlightGate({
    now: () => now,
    schedule: (callback, delayMs) => {
      scheduled.push({ callback, delayMs })
      return scheduled.length
    },
    cancel: () => {},
  })
  let changes = 0
  gate.subscribe(() => { changes += 1 })
  ok('the first launcher claims the shared slot', gate.claim() === true)
  ok('a second launcher loses the same atomic claim', gate.claim() === false)
  ok('every observer sees the flight', gate.isInFlight() === true)
  ok('the shared duration is 900ms', scheduled[0]?.delayMs === 900, String(scheduled[0]?.delayMs))
  now += 900
  scheduled[0]?.callback()
  ok('expiry re-enables every launcher', gate.isInFlight() === false)
  ok('claim and expiry both notify mounted launchers', changes === 2, String(changes))
}

console.log('\n-- run_macro has one dispatch owner --')

const bridgeSource = readFileSync('lich-scripts/companion_bridge.lic', 'utf8')
ok('the bridge process owns a cross-window atomic macro flight',
  bridgeSource.includes('MACRO_FLIGHT_LOCK = Mutex.new') &&
  bridgeSource.includes("intent == 'run_macro'") &&
  bridgeSource.includes('!claim_macro_flight') &&
  bridgeSource.includes('Process.clock_gettime(Process::CLOCK_MONOTONIC)') &&
  bridgeSource.includes('reset_macro_flight!'))
{
  const sourceFiles = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.tsx?$/.test(name)) sourceFiles.push(path)
    }
  }
  walk('src')
  const owners = sourceFiles.filter((path) => readFileSync(path, 'utf8').includes("requestIntent('run_macro'"))
  ok('one module owns every direct run_macro dispatch',
    JSON.stringify(owners.map((path) => path.replaceAll('\\', '/'))) === '["src/lib/macroFlight.ts"]',
    owners.join(', '))
  const app = readFileSync('src/App.tsx', 'utf8')
  const runner = readFileSync('src/lib/useMacroRunner.ts', 'utf8')
  const take = readFileSync('src/lib/useRoomItemTake.ts', 'utf8')
  const training = readFileSync('src/components/shared/TrainingPanel.tsx', 'utf8')
  ok('keyboard Quick Switch uses the shared request', app.includes('requestMacro(variation.commands)') && !app.includes('inFlight: false'))
  ok('macro hooks subscribe to the shared flight state', runner.includes('useSyncExternalStore(subscribeMacroFlight'))
  ok('floor-item macros reuse the same runner', take.includes('useMacroRunner()'))
  ok('activity training reuses the same runner', training.includes('useMacroRunner()'))
}

console.log('\n-- both at once, which is reachable: press a macro, then Stop --')
{
  const s = canSendMacro({ stopLatched: true, inFlight: true, connected: true })
  ok('still blocked', s.canSend === false)
  // The latch needs a deliberate Resume; in-flight clears on its own. Telling
  // somebody to wait when the truth is "press Resume" sends them to wait for
  // something that will never happen by itself.
  ok(
    'the latch is reported, not the wait',
    /resume/i.test(s.reason ?? ''),
    s.reason
  )
}

console.log('\n-- no character --')
{
  const s = canSendMacro({ stopLatched: false, inFlight: false, connected: false })
  ok('nothing to send to', s.canSend === false)
  ok('and it says so', /connect/i.test(s.reason ?? ''), s.reason)
}

console.log('\n-- a blocked answer always carries a reason --')
{
  // The failure this guards is a caller disabling a control and saying
  // nothing, which swaps "refused after pressing" for "dead for no stated
  // reason". Both leave the player without the rule.
  const cases = [
    { stopLatched: true, inFlight: false, connected: true },
    { stopLatched: false, inFlight: true, connected: true },
    { stopLatched: false, inFlight: false, connected: false },
    { stopLatched: true, inFlight: true, connected: false },
  ]
  const bad = cases
    .map((c) => canSendMacro(c))
    .filter((s) => !s.canSend && !s.reason)
  ok('every refusal explains itself', bad.length === 0, `${bad.length} silent refusals`)
}

// A floor on the work, below the real count so it catches a truncated or
// half-loaded run and never needs adjusting when a case is added.
const ran = checked
ok('enough was checked for a pass to mean something', ran >= 10, `${ran} assertions`)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
