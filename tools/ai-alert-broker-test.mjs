/**
 * Alert ordering has to be *total and deterministic* — same alerts in, same
 * winner out, every run — or no test of preemption means anything.
 *
 * The properties here are about scheduling, not sound. alertGate.ts owns
 * whether a noise plays; muting one must never stop a critical alert from
 * cancelling background work, which is why these are separate mechanisms and
 * why nothing below consults a throttle.
 */
import { AlertBroker, preemptsBackgroundWork } from '../src/lib/aiAlertBroker.ts'

let pass = 0
let fail = 0
const ok = (what, cond, detail = '') => {
  if (cond) {
    pass++
    console.log(`OK   ${what.padEnd(72)} ${detail}`)
  } else {
    fail++
    console.log(`FAIL ${what.padEnd(72)} ${detail}`)
  }
}

console.log('-- which priorities interrupt background work --')
{
  ok('critical preempts', preemptsBackgroundWork('critical') === true)
  ok('urgent preempts', preemptsBackgroundWork('urgent') === true)
  // A new room must not abandon a research job; the architecture puts it in
  // "include in the next heartbeat".
  ok('normal does NOT preempt', preemptsBackgroundWork('normal') === false)
  ok('background does NOT preempt', preemptsBackgroundWork('background') === false)
}

console.log('\n-- deterministic total ordering --')
{
  const b = new AlertBroker()
  b.raise('background', 'map-gap', {}, 1)
  b.raise('normal', 'new-room', {}, 1)
  b.raise('critical', 'disconnect', {}, 1)
  b.raise('urgent', 'stunned', {}, 1)
  const order = b.drain().map((a) => a.priority).join(',')
  ok('priority decides first, regardless of arrival order',
    order === 'critical,urgent,normal,background', order)
  ok('next() agrees with drain()', b.next().key === 'disconnect', b.next().key)
}

console.log('\n-- ties are broken by sequence, not by clock --')
{
  const b = new AlertBroker()
  // Same priority, same millisecond: still exactly one defined winner.
  b.raise('urgent', 'first', {}, 5000)
  b.raise('urgent', 'second', {}, 5000)
  ok('the earlier-raised alert wins a same-timestamp tie', b.next().key === 'first', b.next().key)

  const b2 = new AlertBroker()
  b2.raise('urgent', 'second', {}, 5000)
  b2.raise('urgent', 'first', {}, 5000)
  ok('and the order is decided by arrival, so it is reproducible', b2.next().key === 'second',
    b2.next().key)
}

console.log('\n-- deduplication keeps one alert and counts the repeats --')
{
  const b = new AlertBroker()
  const first = b.raise('urgent', 'stunned', { round: 1 }, 100)
  const again = b.raise('urgent', 'stunned', { round: 2 }, 200)
  ok('a repeat of a pending condition is deduplicated', again.deduplicated === true)
  ok('only one alert is pending', b.pendingCount() === 1, String(b.pendingCount()))
  ok('occurrences are counted, so "stunned three rounds" is not lost',
    again.alert.occurrences === 2, String(again.alert.occurrences))
  ok('the original sequence is kept, so a repeat cannot jump the queue',
    again.alert.seq === first.alert.seq, String(again.alert.seq))
  ok('the newest detail is kept', again.alert.detail.round === 2, String(again.alert.detail.round))
}

console.log('\n-- an escalating condition is re-filed at the higher priority --')
{
  const b = new AlertBroker()
  b.raise('normal', 'combat', {}, 1)
  ok('starts as normal, so it does not preempt', b.hasPreempting() === false)
  const up = b.raise('urgent', 'combat', {}, 2)
  ok('the same key raised more severely is escalated', up.alert.priority === 'urgent', up.alert.priority)
  ok('and now preempts', b.hasPreempting() === true)

  // The reverse must not happen: a calmer repeat cannot demote a live danger.
  const down = b.raise('normal', 'combat', {}, 3)
  ok('a calmer repeat does NOT demote an escalated alert', down.alert.priority === 'urgent',
    down.alert.priority)
}

console.log('\n-- acknowledgement --')
{
  const b = new AlertBroker()
  b.raise('critical', 'stop', {}, 1)
  ok('acknowledging a pending alert reports true', b.acknowledge('stop') === true)
  ok('it is no longer pending', b.pendingCount() === 0, String(b.pendingCount()))
  ok('nothing preempts once it is handled', b.hasPreempting() === false)
  ok('a double-acknowledge reports false rather than looking like success',
    b.acknowledge('stop') === false)

  // After acknowledgement the same condition can legitimately recur.
  const again = b.raise('critical', 'stop', {}, 2)
  ok('the same key can be raised again later as a new alert',
    again.deduplicated === false && again.alert.occurrences === 1)
}

console.log('\n-- peeking does not consume --')
{
  const b = new AlertBroker()
  b.raise('urgent', 'death', {}, 1)
  b.next()
  b.next()
  ok('next() twice still leaves the alert pending', b.pendingCount() === 1, String(b.pendingCount()))
}

console.log('\n-- malformed input is refused --')
{
  const b = new AlertBroker()
  let noKey = false
  try { b.raise('urgent', '', {}, 1) } catch { noKey = true }
  ok('an alert with no deduplication key is refused', noKey)
  let badPriority = false
  try { b.raise('emergency', 'x', {}, 1) } catch { badPriority = true }
  ok('an unknown priority is refused rather than silently sorted last', badPriority)
  ok('and neither left anything pending', b.pendingCount() === 0, String(b.pendingCount()))
}

console.log('')
const total = pass + fail
const MIN_EXPECTED = 20
if (total < MIN_EXPECTED) {
  console.error(`FAILED: only ${total} checks ran, expected at least ${MIN_EXPECTED}`)
  process.exit(1)
}
console.log(`${pass} checked, ${fail} failed`)
if (fail > 0) {
  console.error('FAILED')
  process.exit(1)
}
console.log('all passed')
