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
  //
  // This used to assert `deduplicated === false && occurrences === 1`, which
  // was the mechanism of the day rather than the property in the name. A
  // handled critical now keeps its record and comes back with occurrences 2 -
  // strictly more information, since "the bridge has dropped twice" is worth
  // more than "the bridge has dropped". What the name actually promises is
  // that the key becomes actionable again, and that is what is checked.
  const again = b.raise('critical', 'stop', {}, 2)
  ok('the same key can be raised again later as a new alert',
    b.pendingCount() === 1 && again.preempts === true && b.next()?.key === 'stop',
    `pending=${b.pendingCount()} occurrences=${again.alert.occurrences}`)
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

console.log('\n-- a handled condition stays handled until it actually clears --')
{
  // The defect: acknowledge deleted the key, and the host re-derives
  // situation flags from character state on every update, so a stun lasting
  // four rounds became four urgent reviews - one a second with a real
  // provider, each answering a question already answered.
  const b = new AlertBroker()
  b.raise('urgent', 'situation:stunned', { flag: 'stunned' }, 1)
  ok('the first occurrence is pending', b.pendingCount() === 1, String(b.pendingCount()))

  b.acknowledge('situation:stunned')
  ok('acknowledging clears the queue', b.pendingCount() === 0, String(b.pendingCount()))

  const again = b.raise('urgent', 'situation:stunned', { flag: 'stunned' }, 2)
  ok('the same condition next round does not re-enter the queue',
    b.pendingCount() === 0, String(b.pendingCount()))
  ok('but it is still counted, because four rounds stunned is worth more than one',
    again.alert.occurrences === 2, String(again.alert.occurrences))
  ok('and it does not claim to preempt background work a second time', again.preempts === false)

  // The condition ends. Nothing is reported this pass, so the handled record
  // is dropped and the next stun is a new alert rather than a suppressed one.
  const cleared = b.reconcile([])
  ok('reconcile forgets a handled condition that is no longer reported',
    cleared.includes('situation:stunned'), cleared.join(','))
  ok('and nothing is left held', b.handledCount() === 0, String(b.handledCount()))

  const returned = b.raise('urgent', 'situation:stunned', { flag: 'stunned' }, 3)
  ok('a condition that ended and came back is a fresh alert',
    b.pendingCount() === 1, String(b.pendingCount()))
  ok('with a fresh count', returned.alert.occurrences === 1, String(returned.alert.occurrences))

  // Still being reported: reconcile must NOT forget it.
  b.acknowledge('situation:stunned')
  b.reconcile(['situation:stunned'])
  ok('a handled condition still being reported is kept, not forgotten',
    b.handledCount() === 1, String(b.handledCount()))
  b.raise('urgent', 'situation:stunned', { flag: 'stunned' }, 4)
  ok('so it stays out of the queue while it lasts', b.pendingCount() === 0, String(b.pendingCount()))
}

console.log('\n-- critical is exempt: a disconnect always re-alerts --')
{
  const b = new AlertBroker()
  b.raise('critical', 'bridge-disconnected', {}, 1)
  b.acknowledge('bridge-disconnected')
  ok('acknowledged, so nothing is queued', b.pendingCount() === 0, String(b.pendingCount()))

  const again = b.raise('critical', 'bridge-disconnected', {}, 2)
  ok('a repeated critical re-enters the queue even though it was handled',
    b.pendingCount() === 1, String(b.pendingCount()))
  ok('and says so, so background work stops again', again.preempts === true)
  ok('its count carries across the acknowledgement', again.alert.occurrences === 2,
    String(again.alert.occurrences))
  ok('it is the alert the worker would take next', b.next()?.key === 'bridge-disconnected',
    String(b.next()?.key))
}

console.log('')
const total = pass + fail
const MIN_EXPECTED = 34
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
