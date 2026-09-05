/**
 * The scheduler decides when the worker looks. Two properties carry the
 * architecture's cost and safety promises:
 *
 *   unchanged relevant state  ->  no model call at all, however long it's been
 *   critical or urgent alert  ->  look now, and stop background work
 *
 * The last section is the first deliverable stated end to end: an urgent alert
 * interrupts a resumable background job without losing events, advancing an
 * unacknowledged cursor, issuing a game command, or falsely reporting
 * completion. It is here rather than in a separate file because it is a
 * property *between* these three owners, and testing each alone would prove
 * each works and leave the interaction unproven.
 */
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const { EventJournal } = await import('../src/lib/aiEventJournal.ts')
const { AlertBroker } = await import('../src/lib/aiAlertBroker.ts')
const { JobStore } = await import('../src/lib/aiJobStore.ts')
const { decideReview, REVIEW_INTERVAL_MS } = await import('../src/lib/aiReviewScheduler.ts')

let pass = 0
let fail = 0
const ok = (what, cond, detail = '') => {
  if (cond) {
    pass++
    console.log(`OK   ${what.padEnd(74)} ${detail}`)
  } else {
    fail++
    console.log(`FAIL ${what.padEnd(74)} ${detail}`)
  }
}

const base = (over = {}) => ({
  journal: new EventJournal(),
  alerts: new AlertBroker(),
  activity: 'active',
  now: 100000,
  lastReviewAt: null,
  stateHash: 'h1',
  lastReviewedHash: null,
  backgroundRunning: false,
  ...over,
})

console.log('-- unchanged relevant state produces no model call --')
{
  const journal = new EventJournal()
  journal.append('vitals', { hp: 100 }, 1)
  // An hour has passed and the hash still matches: still no review.
  const d = decideReview(base({
    journal,
    stateHash: 'same',
    lastReviewedHash: 'same',
    lastReviewAt: 0,
    now: 3_600_000,
  }))
  ok('unchanged state does not schedule a review even after an hour',
    d.action !== 'review', `${d.action}: ${d.reason}`)
  ok('idle capacity is offered to background work instead', d.action === 'background', d.action)

  const changed = decideReview(base({
    journal,
    stateHash: 'new',
    lastReviewedHash: 'old',
    lastReviewAt: 0,
    now: 3_600_000,
  }))
  ok('changed state does schedule a review', changed.action === 'review', changed.reason)
}

console.log('\n-- the cadence table, and that it is a target rather than a hard timer --')
{
  ok('normal active play targets about five seconds', REVIEW_INTERVAL_MS.active === 5000)
  ok('combat is tighter', REVIEW_INTERVAL_MS.combat < REVIEW_INTERVAL_MS.active)
  ok('quiet town activity is looser', REVIEW_INTERVAL_MS.quiet > REVIEW_INTERVAL_MS.active)

  const journal = new EventJournal()
  journal.append('line', {}, 1)
  const tooSoon = decideReview(base({ journal, lastReviewAt: 99000, now: 100000, lastReviewedHash: 'x' }))
  ok('a review is not due 1s into a 5s cadence', tooSoon.action === 'idle', tooSoon.reason)

  const due = decideReview(base({ journal, lastReviewAt: 94000, now: 100000, lastReviewedHash: 'x' }))
  ok('it is due at 6s', due.action === 'review', due.reason)
  ok('and the review starts from the acknowledged cursor, not from zero-by-default',
    due.fromCursor === journal.acknowledged(), String(due.fromCursor))
}

console.log('\n-- live review is suspended, not merely slowed, when idle or disconnected --')
{
  const journal = new EventJournal()
  journal.append('line', {}, 1)
  for (const activity of ['idle', 'disconnected']) {
    const d = decideReview(base({ journal, activity, lastReviewAt: 0, now: 9_999_999, lastReviewedHash: 'x' }))
    ok(`${activity}: no elapsed time triggers a live review`, d.action === 'background', d.reason)
  }
}

console.log('\n-- a preempting alert beats the clock and beats suppression --')
{
  const journal = new EventJournal()
  const alerts = new AlertBroker()
  alerts.raise('urgent', 'stunned', {}, 1)
  // Hash unchanged AND a review just ran: an urgent alert still wins.
  const d = decideReview(base({
    journal,
    alerts,
    stateHash: 'same',
    lastReviewedHash: 'same',
    lastReviewAt: 99999,
    now: 100000,
    backgroundRunning: true,
  }))
  ok('an urgent alert schedules an immediate review', d.action === 'review', d.reason)
  ok('it is not suppressed by an unchanged state hash', d.priority === 'urgent', String(d.priority))
  ok('it reports that background work must be preempted', d.preempt === true)
  ok('and names the alert being answered', d.alertKey === 'stunned', d.alertKey)

  const normal = new AlertBroker()
  normal.raise('normal', 'new-room', {}, 1)
  const nd = decideReview(base({
    journal, alerts: normal, stateHash: 'same', lastReviewedHash: 'same', backgroundRunning: true,
  }))
  ok('a normal alert does NOT preempt; it waits for the next heartbeat',
    nd.action === 'background', `${nd.action}: ${nd.reason}`)
}

console.log('\n-- preempt is only claimed when something is actually running --')
{
  const alerts = new AlertBroker()
  alerts.raise('critical', 'disconnect', {}, 1)
  const d = decideReview(base({ alerts, backgroundRunning: false }))
  ok('with nothing running, no preemption is claimed', d.preempt === false)
}

console.log('\n-- THE DELIVERABLE: urgent alert interrupts a resumable job, losing nothing --')
{
  store.clear()
  const journal = new EventJournal()
  const alerts = new AlertBroker()
  const jobs = new JobStore()
  jobs.load()

  // A background job is running, mid-work, with a real checkpoint.
  const job = jobs.create({
    kind: 'map_reconciliation',
    scope: { regionId: 'crossing-west' },
    allowedTools: ['propose_node', 'flag_conflict'],
    now: '2026-09-04T12:00:00Z',
  })
  jobs.transition(job.jobId, 'running', { now: '2026-09-04T12:00:01Z' })

  // Events arrive while it works. It reads them but has not finished.
  journal.append('room', { id: 1 }, 10)
  journal.append('room', { id: 2 }, 11)
  const inFlight = journal.readFrom(journal.acknowledged())
  ok('the worker read 2 events', inFlight.events.length === 2)

  jobs.transition(job.jobId, 'checkpointed', {
    now: '2026-09-04T12:00:02Z',
    checkpointRef: 'ckpt:mid',
    cursor: journal.acknowledged(),
  })

  // More events arrive, then the urgent alert.
  journal.append('combat', { stunned: true }, 12)
  alerts.raise('urgent', 'stunned', { round: 1 }, 12)

  const decision = decideReview({
    journal, alerts, activity: 'combat', now: 100000, lastReviewAt: 99999,
    stateHash: 'same', lastReviewedHash: 'same', backgroundRunning: true,
  })
  ok('the scheduler calls for an immediate review', decision.action === 'review', decision.reason)
  ok('and reports the background job must be preempted', decision.preempt === true)

  // The caller acts on that: cancel the job. It did not finish.
  const cancelled = jobs.transition(job.jobId, 'cancelled', {
    now: '2026-09-04T12:00:03Z',
    note: 'preempted by urgent alert stunned',
  })
  ok('the interrupted job is cancelled', cancelled.ok === true)
  ok('it is NOT reported as completed', jobs.get(job.jobId).status === 'cancelled',
    jobs.get(job.jobId).status)
  ok('its checkpoint is retained, so the work is resumable',
    jobs.get(job.jobId).checkpointRef === 'ckpt:mid', jobs.get(job.jobId).checkpointRef)

  // The cursor was never acknowledged, because the work never completed.
  ok('cancellation did not advance the event cursor', journal.acknowledged() === 0,
    String(journal.acknowledged()))
  const afterCancel = journal.readFrom(journal.acknowledged())
  ok('every event is still available after the interruption', afterCancel.events.length === 3,
    String(afterCancel.events.length))
  ok('including the one that arrived during the job', afterCancel.events.some((e) => e.kind === 'combat'))
  ok('and nothing was lost', afterCancel.lost === 0 && journal.stats().lost === 0)

  // Nothing in this path can reach the game.
  const surface = Object.keys(journal).concat(Object.keys(alerts), Object.keys(jobs))
  ok('no journal/alert/job object exposes a send or command surface',
    !surface.some((k) => /send|command|invoke|exec/i.test(k)), surface.join(',') || '(none)')
}

console.log('')
const total = pass + fail
const MIN_EXPECTED = 25
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
