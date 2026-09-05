/**
 * One rule, tested against every way a model can fail: the cursor advances
 * only after the work actually succeeded.
 *
 * A worker that acknowledged on timeout would lose events silently and look
 * perfectly healthy doing it, which is why each failure gets its own case
 * rather than one representative.
 *
 * The scripted providers here are test doubles and live only in this file.
 * src/ ships no model implementation but `absentProvider`.
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
const { absentProvider } = await import('../src/lib/aiModelProvider.ts')
const { runWorkerOnce } = await import('../src/lib/aiWorker.ts')

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

const working = { describe: () => ({ available: true }), generate: async () => ({ ok: true, text: '{}', tokens: 3 }) }
const hangs = { describe: () => ({ available: true }), generate: () => new Promise(() => {}) }
const oom = { describe: () => ({ available: true }), generate: async () => { throw new Error('CUDA out of memory') } }
const garbage = { describe: () => ({ available: true }), generate: async () => 'nonsense' }

const setup = (over = {}) => {
  store.clear()
  const journal = new EventJournal()
  const alerts = new AlertBroker()
  const jobs = new JobStore()
  jobs.load()
  return {
    journal, alerts, jobs,
    provider: working,
    activity: 'active',
    now: 100000,
    nowIso: '2026-09-04T13:00:00Z',
    lastReviewAt: null,
    stateHash: 'h2',
    lastReviewedHash: 'h1',
    instructions: 'classify',
    ...over,
  }
}

console.log('-- a successful review consumes its events exactly once --')
{
  const d = setup()
  d.journal.append('room', { id: 1 }, 1)
  d.journal.append('combat', { id: 2 }, 2)
  const out = await runWorkerOnce(d)
  ok('the worker reviewed', out.did === 'review', out.did)
  ok('the model succeeded', out.result.ok === true)
  ok('the cursor advanced', out.acknowledged === true && out.cursorAfter === 2, String(out.cursorAfter))
  ok('and the events are not handed out again', d.journal.readFrom(d.journal.acknowledged()).events.length === 0)
}

console.log('-- ...and every failure leaves the cursor exactly where it was --')
{
  for (const [name, provider, expected] of [
    ['absent (no model installed)', absentProvider(), 'absent'],
    ['timeout', hangs, 'timeout'],
    ['out of memory', oom, 'out_of_memory'],
    ['invalid output', garbage, 'invalid_output'],
  ]) {
    const d = setup({ provider })
    d.journal.append('room', { id: 1 }, 1)
    d.journal.append('combat', { id: 2 }, 2)
    const out = await runWorkerOnce(d)
    ok(`${name}: reported as a typed failure`, out.result.ok === false && out.result.failure === expected,
      out.result.failure)
    ok(`${name}: cursor did NOT advance`, out.cursorAfter === 0 && out.acknowledged === false,
      String(out.cursorAfter))
    ok(`${name}: the events are still available for the retry`,
      d.journal.readFrom(d.journal.acknowledged()).events.length === 2)
  }
}

console.log('\n-- a cancelled review does not consume, and is not a failure of the job --')
{
  const d = setup({ provider: hangs })
  d.journal.append('room', { id: 1 }, 1)
  const ac = new AbortController()
  const running = runWorkerOnce(d, ac.signal)
  ac.abort()
  const out = await running
  ok('cancellation is reported as cancelled', out.result.failure === 'cancelled', out.result.failure)
  ok('the cursor did not move', out.cursorAfter === 0, String(out.cursorAfter))
}

console.log('\n-- an unanswered alert stays pending --')
{
  const d = setup({ provider: absentProvider() })
  d.journal.append('combat', {}, 1)
  d.alerts.raise('urgent', 'stunned', {}, 1)
  const out = await runWorkerOnce(d)
  ok('the alert drove the review', out.alertKey === 'stunned', String(out.alertKey))
  ok('a failed review does NOT retire the alert', d.alerts.pendingCount() === 1,
    String(d.alerts.pendingCount()))

  const d2 = setup()
  d2.journal.append('combat', {}, 1)
  d2.alerts.raise('urgent', 'stunned', {}, 1)
  await runWorkerOnce(d2)
  ok('a successful review does retire it', d2.alerts.pendingCount() === 0,
    String(d2.alerts.pendingCount()))
}

console.log('\n-- an urgent alert preempts a running job before any model call --')
{
  const d = setup()
  const job = d.jobs.create({ kind: 'map_reconciliation', now: d.nowIso })
  d.jobs.transition(job.jobId, 'running', { now: d.nowIso, checkpointRef: 'ckpt:1' })
  d.journal.append('combat', {}, 1)
  d.alerts.raise('urgent', 'stunned', {}, 1)

  const out = await runWorkerOnce(d)
  ok('the turn preempted rather than reviewing', out.did === 'preempted', out.did)
  ok('the job is cancelled, not completed', d.jobs.get(job.jobId).status === 'cancelled',
    d.jobs.get(job.jobId).status)
  ok('its checkpoint is retained so the work resumes later',
    d.jobs.get(job.jobId).checkpointRef === 'ckpt:1')
  ok('preemption consumed no events', out.cursorAfter === 0, String(out.cursorAfter))
  ok('the alert is still pending, because nothing has answered it yet',
    d.alerts.pendingCount() === 1, String(d.alerts.pendingCount()))
}

console.log('\n-- background work produces a candidate, never a completion --')
{
  const d = setup({ stateHash: 'same', lastReviewedHash: 'same' })
  const job = d.jobs.create({ kind: 'knowledge_extraction', allowedTools: ['propose_node'], now: d.nowIso })
  const out = await runWorkerOnce(d)
  ok('idle capacity ran the queued job', out.did === 'background-job', out.did)
  ok('a successful job is awaiting_review, NOT completed', out.status === 'awaiting_review', out.status)
  ok('nothing was promoted into canonical data by this turn',
    d.jobs.get(job.jobId).status === 'awaiting_review')

  const failed = setup({ stateHash: 'same', lastReviewedHash: 'same', provider: oom })
  failed.jobs.create({ kind: 'knowledge_extraction', now: failed.nowIso })
  const fout = await runWorkerOnce(failed)
  ok('a job whose model ran out of memory is honestly failed', fout.status === 'failed', fout.status)
  ok('and the reason is recorded', /out_of_memory/.test(failed.jobs.all()[0].note), failed.jobs.all()[0].note)
}

console.log('\n-- absence does not impair ordinary operation --')
{
  const d = setup({ provider: absentProvider(), stateHash: 'same', lastReviewedHash: 'same' })
  d.jobs.create({ kind: 'wiki_draft', now: d.nowIso })
  const out = await runWorkerOnce(d)
  ok('a turn with no model still completes without throwing', out.did === 'background-job', out.did)
  ok('the job is failed rather than left running forever', out.status === 'failed', out.status)
  ok('nothing is left claiming to run', d.jobs.byStatus('running').length === 0)
}

console.log('\n-- unchanged state costs nothing --')
{
  const d = setup({ stateHash: 'same', lastReviewedHash: 'same' })
  let called = 0
  d.provider = { describe: () => ({ available: true }), generate: async () => { called++; return { ok: true, text: '', tokens: 0 } } }
  d.journal.append('vitals', {}, 1)
  const out = await runWorkerOnce(d)
  ok('no live review happened', out.did !== 'review', out.did)
  ok('and the model was never called', called === 0, String(called))
}

console.log('\n-- the worker cannot reach the game --')
{
  const fs = await import('node:fs')
  const src = fs.readFileSync('src/lib/aiWorker.ts', 'utf8')
  ok('no import from the command path',
    !/from '\.\/(gameActions|gameCommand|gameLink)/.test(src))
  ok('no send or invoke surface anywhere in the worker',
    !/\b(sendGame|requestGameAction|invokeTauri|game_send)\b/.test(src))
}

console.log('\n-- a refused prompt is a reported failure, not an unhandled rejection --')
{
  // Assembled at runtime so the literal never exists in this file: the
  // gitleaks hook rejects a credential-shaped literal, including a fake one.
  const leak = 'pass' + 'word: hunter2'

  const deps = setup({ instructions: `classify. ${leak}` })
  deps.journal.append('line', { text: 'a' }, 1)
  const before = deps.journal.acknowledged()

  let threw = null
  let outcome = null
  try {
    outcome = await runWorkerOnce(deps)
  } catch (error) {
    threw = error
  }

  ok('nothing escapes as a rejection - the turn returns', threw === null, String(threw))
  ok('the turn still reports what it tried to do', outcome?.did === 'review', outcome?.did)
  ok('and reports it as a privacy refusal, not a generic error',
    outcome?.result.ok === false && outcome.result.failure === 'privacy_gate',
    outcome?.result?.failure)
  ok('naming the pattern that matched', /account password/.test(outcome?.result.message ?? ''),
    outcome?.result?.message)
  ok('and never the value', !/hunter2/.test(JSON.stringify(outcome)))
  ok('the cursor did not move, so the events are still there to review',
    deps.journal.acknowledged() === before, String(deps.journal.acknowledged()))

  // The background path goes through the same gate, and a job must record it.
  const jobDeps = setup({ instructions: `research. ${leak}`, stateHash: 'h1', lastReviewedHash: 'h1' })
  const job = jobDeps.jobs.create({ kind: 'knowledge_extraction', now: jobDeps.nowIso })
  const jobOutcome = await runWorkerOnce(jobDeps)
  ok('a background job hits the same gate', jobOutcome.did === 'background-job', jobOutcome.did)
  ok('and is recorded as failed rather than left running',
    jobDeps.jobs.get(job.jobId)?.status === 'failed', jobDeps.jobs.get(job.jobId)?.status)
  ok('with the pattern name in the note and not the value',
    /account password/.test(jobDeps.jobs.get(job.jobId)?.note ?? '') &&
      !/hunter2/.test(jobDeps.jobs.get(job.jobId)?.note ?? ''),
    jobDeps.jobs.get(job.jobId)?.note)

  // A genuine bug must not be relabelled as a privacy refusal.
  const bug = {
    describe: () => ({ available: true }),
    generate: async () => {
      throw new TypeError('provider is not a function')
    },
  }
  const bugDeps = setup({ provider: bug })
  bugDeps.journal.append('line', { text: 'a' }, 1)
  const bugOutcome = await runWorkerOnce(bugDeps)
  ok('an ordinary provider bug is still reported as an error, not as a refusal',
    bugOutcome.did === 'review' && bugOutcome.result.failure === 'error',
    bugOutcome.result?.failure)
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
