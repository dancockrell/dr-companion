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
  // The resultRef is new (A12): a completion has to point at what it
  // produced. The property this check is named for is the ordering - only
  // reachable after awaiting_review - and that is unchanged.
  ok('and only then to completed',
    s.transition(job.jobId, 'completed', { now: LATER, resultRef: 'candidate:1' }).ok === true)
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

console.log('\n-- a completion has to point at what it produced --')
{
  // running -> completed is exactly the transition a crash or a bug can
  // forge, which section 6 forbids. It stays legal for the one real case - a
  // job that finished with nothing to review - and only when it carries a
  // reference to the result, which a crash cannot invent.
  const s = new JobStore()
  s.reset()
  const job = s.create({ kind: 'evaluation_case_mining', now: NOW })
  s.transition(job.jobId, 'running', { now: NOW })

  const bare = s.transition(job.jobId, 'completed', { now: LATER })
  ok('completed without a resultRef is refused', bare.ok === false, bare.reason)
  ok('and says why, rather than failing silently', /resultRef/.test(bare.reason || ''), bare.reason)
  ok('the job is left running, not half-moved',
    s.get(job.jobId).status === 'running', s.get(job.jobId).status)

  const done = s.transition(job.jobId, 'completed', { now: LATER, resultRef: 'candidate:7' })
  ok('completed with a resultRef is accepted', done.ok === true, done.reason)
  ok('and the reference is kept', s.get(job.jobId).resultRef === 'candidate:7',
    s.get(job.jobId).resultRef)
  ok('it survives a reload, so the record is durable rather than in-memory',
    (() => { const t = new JobStore(); t.load(); return t.get(job.jobId).resultRef === 'candidate:7' })())
}

console.log('\n-- a checkpointed job can go back in line, and cannot be declared failed --')
{
  // The architecture document's table allows neither running -> completed nor
  // checkpointed -> failed, and adds checkpointed -> queued. This reconciles
  // in favour of the stricter table, with the one exception above.
  const s = new JobStore()
  s.reset()
  const job = s.create({ kind: 'map_reconciliation', now: NOW })
  s.transition(job.jobId, 'running', { now: NOW, checkpointRef: 'ckpt:9' })
  s.transition(job.jobId, 'checkpointed', { now: LATER })

  const failed = s.transition(job.jobId, 'failed', { now: LATER, note: 'gave up' })
  ok('checkpointed -> failed is refused - it would throw away a live resume point',
    failed.ok === false, failed.reason)
  ok('so the job keeps its checkpointed status',
    s.get(job.jobId).status === 'checkpointed', s.get(job.jobId).status)
  ok('and keeps the resume point itself', s.get(job.jobId).checkpointRef === 'ckpt:9',
    s.get(job.jobId).checkpointRef)

  const requeued = s.transition(job.jobId, 'queued', { now: LATER })
  ok('checkpointed -> queued is accepted, so it can wait behind other work',
    requeued.ok === true, requeued.reason)
  ok('the resume point is still there after re-queueing',
    s.get(job.jobId).checkpointRef === 'ckpt:9', s.get(job.jobId).checkpointRef)

  // The honest route to failure: resume, then fail, which records that the
  // resume was actually attempted.
  s.transition(job.jobId, 'running', { now: LATER })
  const honest = s.transition(job.jobId, 'failed', { now: LATER, note: 'the checkpoint was unusable' })
  ok('running -> failed is the honest route, and still works', honest.ok === true, honest.reason)
}

/** Does the store actually refuse a completion with no resultRef? Asked as a
  * function so the documentation check above asserts the code's behaviour
  * rather than the presence of a word in a file. */
function s6Refuses() {
  const s = new JobStore()
  s.reset()
  const job = s.create({ kind: 'evaluation_case_mining', now: NOW })
  s.transition(job.jobId, 'running', { now: NOW })
  return s.transition(job.jobId, 'completed', { now: LATER }).ok === false
}

console.log('\n-- section 6.1 records the resultRef rule that the table cannot show --')
{
  // The table itself is checked against the code by the doc-vs-code block
  // that C8 added below; duplicating that here would be two records of one
  // fact, free to drift. What a from/to table cannot express is the
  // condition on running -> completed, so that is what this checks.
  const fs = await import('node:fs')
  const doc = fs.readFileSync('docs/LOCAL_AI_BACKGROUND_WORKER.md', 'utf8')
  const section = doc.slice(doc.indexOf('## 6.'), doc.indexOf('## 7.'))
  ok('section 6 was found and is not empty', section.length > 200, String(section.length))
  ok('it records that a completion must carry a resultRef', /resultRef/.test(section))
  ok('and that the code enforces it', s6Refuses())
}

console.log('')
console.log("-- the doc's transition table and the code's rule are the same table --")
{
  // Two places stating the same rule will drift, so neither may be edited
  // alone. This reads section 6.1 of the architecture doc and compares it to
  // the store's own answer, in both directions: a transition the doc allows
  // and the code refuses fails, and so does the reverse.
  //
  // The code side is asked through `canTransition` rather than by reading the
  // source, so this compares against the behaviour callers actually get. A
  // grep of the module text would agree with a table that no longer drives
  // anything.
  const { readFileSync } = await import('node:fs')
  const DOC = 'docs/LOCAL_AI_BACKGROUND_WORKER.md'
  const md = readFileSync(DOC, 'utf8')
  const STATES = ['queued', 'running', 'checkpointed', 'awaiting_review', 'completed', 'failed', 'cancelled']

  const heading = md.indexOf('### 6.1 Legal transitions')
  ok('the doc still has section 6.1', heading >= 0, DOC)

  // Only the rows of the first table after that heading. The section also
  // carries prose about A12's pending changes, and a row-shaped line there
  // must not be read as part of the contract.
  const rows = []
  for (const line of md.slice(Math.max(heading, 0)).split(/\r?\n/).slice(1)) {
    const cells = /^\|\s*`([a-z_]+)`\s*\|([^|]*)\|\s*$/.exec(line)
    if (cells) {
      rows.push([cells[1], (cells[2].match(/`[a-z_]+`/g) || []).map((t) => t.replaceAll('`', ''))])
      continue
    }
    if (rows.length && !line.trimStart().startsWith('|')) break
  }

  const documented = Object.fromEntries(rows)

  // The denominator. If the parse breaks this goes to zero and says so,
  // instead of every comparison below passing against an empty table.
  ok(
    `the doc's table parsed to ${rows.length} rows`,
    rows.length === STATES.length,
    `expected ${STATES.length}, got: ${rows.map((r) => r[0]).join(', ') || '(none)'}`,
  )

  for (const from of STATES) {
    const doc = documented[from]
    if (!doc) {
      ok(`the doc documents "${from}"`, false, 'no row for this state')
      continue
    }
    const codeAllows = STATES.filter((to) => canTransition(from, to)).sort()
    const docAllows = [...doc].sort()
    ok(
      `"${from}" allows the same targets in the doc and the code`,
      JSON.stringify(codeAllows) === JSON.stringify(docAllows),
      `code [${codeAllows.join(' ')}] doc [${docAllows.join(' ')}]`,
    )
  }

  for (const from of Object.keys(documented)) {
    if (!STATES.includes(from)) {
      ok(`the doc's "${from}" is a real status`, false, 'no such JobStatus')
    }
  }
}

console.log('')
const total = pass + fail
const MIN_EXPECTED = 38
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
