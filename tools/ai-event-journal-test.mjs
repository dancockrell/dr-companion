/**
 * The journal's whole job is a delivery guarantee, so these test the promise
 * rather than the mechanism: after any failure, can the consumer still see
 * every event it has not acknowledged?
 *
 * The cases that matter are the ones where a worker does NOT finish - timeout,
 * cancellation, crash between read and acknowledge. A journal that only works
 * when the consumer succeeds is a queue with extra steps.
 */
import { BEFORE_FIRST_EVENT, EventJournal } from '../src/lib/aiEventJournal.ts'

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

const fill = (j, n, from = 1) => {
  for (let i = 0; i < n; i++) j.append('line', { i: from + i }, 1000 + i)
}

console.log('-- ordering and stable sequence ids --')
{
  const j = new EventJournal()
  const a = j.append('room', { id: 1 }, 100)
  const b = j.append('combat', { id: 2 }, 101)
  ok('sequence ids start at 1, so cursor 0 means "nothing acknowledged"', a.seq === 1, String(a.seq))
  ok('sequence ids strictly increase', b.seq === 2, String(b.seq))
  ok('a fresh journal has acknowledged nothing', j.acknowledged() === BEFORE_FIRST_EVENT)
  ok('events read back in append order', j.readFrom(0).events.map((e) => e.seq).join(',') === '1,2')
}

console.log('\n-- read-by-cursor does not consume --')
{
  const j = new EventJournal()
  fill(j, 3)
  const first = j.readFrom(0)
  const second = j.readFrom(0)
  ok('reading twice from the same cursor returns the same events',
    JSON.stringify(first.events.map((e) => e.seq)) === JSON.stringify(second.events.map((e) => e.seq)),
    first.events.map((e) => e.seq).join(','))
  ok('reading did not advance the acknowledged cursor', j.acknowledged() === 0, String(j.acknowledged()))
  ok('nextCursor is the last event handed over, never further', first.nextCursor === 3, String(first.nextCursor))
}

console.log('\n-- no loss on timeout, cancellation, or worker death --')
{
  const j = new EventJournal()
  fill(j, 3)

  // A worker reads, then times out before acknowledging.
  const attempt = j.readFrom(j.acknowledged())
  ok('the worker saw 3 events', attempt.events.length === 3)
  // ... no acknowledge() call. This is the timeout.

  const retry = j.readFrom(j.acknowledged())
  ok('after a timeout the retry sees the same 3 events again', retry.events.length === 3,
    retry.events.map((e) => e.seq).join(','))

  // Events that arrived while the worker was busy are also still there.
  j.append('line', { late: true }, 2000)
  const afterBusy = j.readFrom(j.acknowledged())
  ok('an event appended while the worker was busy is not lost', afterBusy.events.length === 4,
    String(afterBusy.events.length))

  // Now it succeeds.
  j.acknowledge(afterBusy.nextCursor)
  ok('after a successful consume the cursor advances', j.acknowledged() === 4, String(j.acknowledged()))
  ok('and the consumed events are not handed out again', j.readFrom(j.acknowledged()).events.length === 0)
}

console.log('\n-- acknowledgement refuses to claim more than happened --')
{
  const j = new EventJournal()
  fill(j, 2)
  let threw = false
  try { j.acknowledge(5) } catch { threw = true }
  ok('acknowledging past the newest appended event is refused', threw)
  ok('and the cursor is untouched by the refusal', j.acknowledged() === 0, String(j.acknowledged()))

  j.acknowledge(2)
  j.acknowledge(1)
  ok('acknowledging backwards does not rewind the committed cursor', j.acknowledged() === 2,
    String(j.acknowledged()))

  let negThrew = false
  try { j.readFrom(-1) } catch { negThrew = true }
  ok('a negative cursor is refused rather than silently treated as zero', negThrew)
}

console.log('\n-- bounded retention reports loss instead of hiding it --')
{
  const j = new EventJournal({ capacity: 3 })
  fill(j, 5) // 1,2 fall off the back; nothing acknowledged
  const stats = j.stats()
  ok('retention is capped', stats.retained === 3, String(stats.retained))
  ok('unacknowledged events discarded by the cap are counted as lost', stats.lost === 2, String(stats.lost))

  const read = j.readFrom(0)
  ok('a read from a cursor older than retention reports the gap', read.lost === 2, String(read.lost))
  ok('and still returns everything that survived', read.events.length === 3, String(read.events.length))
}

console.log('\n-- discarding already-acknowledged events is retention, not loss --')
{
  const j = new EventJournal({ capacity: 3 })
  fill(j, 3)
  j.acknowledge(3) // consumer is fully caught up
  fill(j, 3, 4) // pushes 1,2,3 off the back - but they were consumed
  ok('consumed events falling off the back are not reported as loss', j.stats().lost === 0,
    String(j.stats().lost))
  ok('the caught-up consumer sees only the new events', j.readFrom(3).events.length === 3)
}

console.log('\n-- capture is never blocked by a busy consumer --')
{
  const j = new EventJournal()
  const read = j.readFrom(0) // worker is "reviewing" this snapshot
  j.append('line', { during: 1 }, 10)
  j.append('line', { during: 2 }, 11)
  ok('appends during a review are accepted', j.stats().appended === 2, String(j.stats().appended))
  ok('the in-flight read is unaffected by later appends', read.events.length === 0)
  ok('pending count reflects the unreviewed backlog', j.pending() === 2, String(j.pending()))
}

console.log('\n-- construction rejects a nonsense bound --')
{
  for (const bad of [0, -1, 1.5]) {
    let threw = false
    try { new EventJournal({ capacity: bad }) } catch { threw = true }
    ok(`capacity ${bad} is refused`, threw)
  }
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
