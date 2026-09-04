/**
 * Background jobs must never lie about what happened to them.
 *
 * Three lies are easy to write and all three are tested against here: a crash
 * reported as success, a cancellation reported as completion, and a status
 * that skipped a state. The architecture states the first one outright — "a
 * crash cannot convert `running` into `completed`" — and the other two follow
 * from it.
 */
// Minimal localStorage shim, same shape the other isolated tests use.
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const { JobStore, canTransition, isTerminal } = await import('../src/lib/aiJobStore.ts')

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

const NOW = '2026-09-04T12:00:00Z'
const LATER = '2026-09-04T12:00:30Z'
const fresh = () => {
  store.clear()
  const s = new JobStore()
  s.load()
  return s
}

console.log('-- a new job starts queued, with its budget and tools recorded --')
{
  const s = fresh()
  const job = s.create({
    kind: 'map_reconciliation',
    scope: { regionId: 'crossing-west' },
    inputRefs: ['observation:1732'],
    allowedTools: ['propose_node', 'flag_conflict'],
    budget: { maxTokens: 2048, maxSeconds: 30 },
    now: NOW,
  })
  ok('status is queued', job.status === 'queued', job.status)
  ok('it has a stable id', /^job:\d+$/.test(job.jobId), job.jobId)
  ok('allowed tools are explicit and narrow', job.allowedTools.length === 2)
  ok('a budget is always present', job.budget.maxSeconds === 30)
  ok('inputs are references, not copied payloads', job.inputRefs[0] === 'observation:1732')
  ok('no checkpoint yet', job.checkpointRef === null)
}

console.log('\n-- invalid transitions are refused, not quietly accepted --')
{
  ok('queued -> completed is not a legal transition', canTransition('queued', 'completed') === false)
  ok('queued -> running is', canTransition('queued', 'running') === true)
  ok('completed is terminal', isTerminal('completed') && canTransition('completed', 'running') === false)
  ok('cancelled is terminal', isTerminal('cancelled') && canTransition('cancelled', 'running') === false)
  ok('failed is terminal', isTerminal('failed') && canTransition('failed', 'completed') === false)

  const s = fresh()
  const job = s.create({ kind: 'wiki_draft', now: NOW })
  const skipped = s.transition(job.jobId, 'completed', { now: LATER })
  ok('a job cannot complete work it never started', skipped.ok === false, skipped.reason)
  ok('and its status is unchanged by the refusal', s.get(job.jobId).status === 'queued',
    s.get(job.jobId).status)

  const missing = s.transition('job:999', 'running', { now: LATER })
  ok('transitioning an unknown job is refused', missing.ok === false, missing.reason)
}

console.log('\n-- cancellation is not completion --')
{
  const s = fresh()
  const job = s.create({ kind: 'script_repair', now: NOW })
  s.transition(job.jobId, 'running', { now: NOW })
  const cancelled = s.transition(job.jobId, 'cancelled', {
    now: LATER,
    note: 'preempted by an urgent alert',
  })
  ok('a preempted job is cancelled', cancelled.ok && cancelled.job.status === 'cancelled',
    cancelled.job?.status)
  ok('it is NOT reported as completed', s.get(job.jobId).status !== 'completed')
  ok('the reason is recorded', /urgent alert/.test(s.get(job.jobId).note))
  const revive = s.transition(job.jobId, 'running', { now: LATER })
  ok('a cancelled job cannot be quietly restarted into running', revive.ok === false, revive.reason)
}

console.log('\n-- checkpoint recovery after a crash --')
{
  const s = fresh()
  const withCheckpoint = s.create({ kind: 'knowledge_extraction', now: NOW })
  const withoutCheckpoint = s.create({ kind: 'knowledge_extraction', now: NOW })
  s.transition(withCheckpoint.jobId, 'running', { now: NOW, checkpointRef: 'ckpt:7', cursor: 42 })
  s.transition(withoutCheckpoint.jobId, 'running', { now: NOW })

  // The process dies here. A new store loads what actually survived.
  const restarted = new JobStore()
  restarted.load()
  ok('both jobs were persisted as running', restarted.byStatus('running').length === 2,
    String(restarted.byStatus('running').length))

  const recovered = restarted.recoverInterrupted(LATER)
  ok('a job with a checkpoint becomes checkpointed, which is resumable and true',
    recovered.resumable.length === 1 && recovered.resumable[0].jobId === withCheckpoint.jobId)
  ok('its checkpoint survived the restart',
    restarted.get(withCheckpoint.jobId).checkpointRef === 'ckpt:7',
    restarted.get(withCheckpoint.jobId).checkpointRef)
  ok('and so did its cursor', restarted.get(withCheckpoint.jobId).cursor === 42,
    String(restarted.get(withCheckpoint.jobId).cursor))
  ok('a job with no checkpoint is honestly marked failed',
    recovered.failed.length === 1 && restarted.get(withoutCheckpoint.jobId).status === 'failed')
  ok('neither became completed',
    restarted.all().every((j) => j.status !== 'completed'))
  ok('nothing is left claiming to be running after a restart',
    restarted.byStatus('running').length === 0, String(restarted.byStatus('running').length))
  ok('the failure says why', /no checkpoint/.test(restarted.get(withoutCheckpoint.jobId).note))
}

console.log('\n-- a resumed job continues from its checkpoint --')
{
  const s = fresh()
  const job = s.create({ kind: 'map_reconciliation', now: NOW })
  s.transition(job.jobId, 'running', { now: NOW, checkpointRef: 'ckpt:1', cursor: 10 })
  s.transition(job.jobId, 'checkpointed', { now: LATER })
  const resumed = s.transition(job.jobId, 'running', { now: LATER })
  ok('checkpointed -> running is the resume path', resumed.ok === true, resumed.reason)
  ok('the resume point was not erased by the transitions',
    s.get(job.jobId).checkpointRef === 'ckpt:1', s.get(job.jobId).checkpointRef)
  const done = s.transition(job.jobId, 'awaiting_review', { now: LATER })
  ok('finished work goes to awaiting_review, not straight to completed', done.ok === true)
  ok('and only then to completed', s.transition(job.jobId, 'completed', { now: LATER }).ok === true)
}

console.log('\n-- a failed save is reported, never swallowed --')
{
  const s = fresh()
  const job = s.create({ kind: 'wiki_draft', now: NOW })
  const realSet = localStorage.setItem
  localStorage.setItem = () => {
    throw new DOMException('quota', 'QuotaExceededError')
  }
  const result = s.transition(job.jobId, 'running', { now: LATER, checkpointRef: 'ckpt:x' })
  localStorage.setItem = realSet
  ok('a transition that could not be persisted reports failure', result.ok === false, result.reason)
  ok('and says it is only in memory, so a caller cannot trust the checkpoint',
    /not saved/.test(result.reason || ''), result.reason)
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
