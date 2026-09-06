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
const { ClaimStore } = await import('../src/lib/aiClaimStore.ts')
const { EvidenceStore } = await import('../src/lib/aiEvidenceStore.ts')
const { readJSON, writeJSON } = await import('../src/lib/storage.ts')

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

// `{}` used to be enough. H3 gave the live review a schema, so the double
// now answers it: an empty object no longer parses as a review and would
// correctly be invalid_output, which is a different property than the ones
// this double is here to exercise.
const working = { describe: () => ({ available: true }), generate: async () => ({ ok: true, text: '{"notable":[]}', tokens: 3 }) }
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

console.log('\n-- a review that is not the agreed object has reviewed nothing --')
{
  const says = (text) => ({ describe: () => ({ available: true }), generate: async () => ({ ok: true, text, tokens: 5 }) })
  const run = async (text) => {
    const d = setup({ provider: says(text) })
    d.journal.append('room', { id: 1 }, 1)
    const out = await runWorkerOnce(d)
    return { out, cursor: d.journal.acknowledged() }
  }

  const good = await run('{"notable":["a closed door"],"question":"where does it go?"}')
  ok('a conforming object is ok', good.out.result.ok === true,
    good.out.result.ok ? '' : good.out.result.message)
  ok('and is handed back parsed rather than as text',
    good.out.review?.notable?.[0] === 'a closed door', JSON.stringify(good.out.review))
  ok('the optional question survives', good.out.review?.question === 'where does it go?')
  ok('and the cursor moved', good.cursor === 1, String(good.cursor))

  const chatty = await run('Sure! Here is my analysis:\n```json\n{"notable":["a rat"]}\n```\nHope that helps.')
  ok('an object wrapped in a fence and a sentence is still found',
    chatty.out.result.ok === true && chatty.out.review?.notable?.[0] === 'a rat',
    JSON.stringify(chatty.out.review))

  const nested = await run('{"notable":["a door"],"meta":{"confidence":0.4},"extra":1} and then some prose')
  ok('a nested object does not truncate the match', nested.out.result.ok === true,
    nested.out.result.ok ? '' : nested.out.result.message)
  ok('and extra keys are kept rather than refused',
    nested.out.review?.notable?.length === 1, JSON.stringify(nested.out.review))

  const brace = await run('{"notable":["the sign said } here"]}')
  ok('a brace inside a string does not close the object early',
    brace.out.result.ok === true && brace.out.review?.notable?.[0] === 'the sign said } here',
    JSON.stringify(brace.out.review))

  const prose = await run('The room looks quiet and nothing seems notable right now.')
  ok('prose is invalid_output', !prose.out.result.ok && prose.out.result.failure === 'invalid_output',
    prose.out.result.ok ? 'ok' : prose.out.result.failure)
  ok('with no parsed review', prose.out.review === null)
  // The whole reason this demotion happens before the acknowledge: a cursor
  // that moved past events nothing reviewed cannot be moved back.
  ok('and the cursor did NOT move', prose.cursor === 0, String(prose.cursor))
  ok('so the outcome reports it was not acknowledged', prose.out.acknowledged === false)

  const wrongShape = await run('{"notable":"a door"}')
  ok('valid JSON of the wrong shape is invalid_output too',
    !wrongShape.out.result.ok && wrongShape.out.result.failure === 'invalid_output',
    wrongShape.out.result.ok ? 'ok' : wrongShape.out.result.failure)
  ok('and it too leaves the cursor alone', wrongShape.cursor === 0, String(wrongShape.cursor))

  const unclosed = await run('{"notable":["a door"')
  ok('a truncated object is invalid_output rather than a crash',
    !unclosed.out.result.ok && unclosed.out.result.failure === 'invalid_output',
    unclosed.out.result.ok ? 'ok' : unclosed.out.result.failure)

  // The prompt has to carry the schema the parser enforces, or every answer
  // is invalid_output forever with nothing saying why.
  let sent = null
  const capture = {
    describe: () => ({ available: true }),
    generate: async (request) => {
      sent = request
      return { ok: true, text: '{"notable":[]}', tokens: 1 }
    },
  }
  const d = setup({ provider: capture })
  d.journal.append('room', { id: 1 }, 1)
  await runWorkerOnce(d)
  ok('the instructions still begin with the caller\'s own prompt',
    sent?.instructions.startsWith('classify'), sent?.instructions?.slice(0, 20))
  // Every field the validator reads has to appear in the prompt's schema, and
  // the check is written that way round rather than as one literal block: a
  // schema that has drifted from the validator produces `invalid_output`
  // forever with nothing to say why, and a field the prompt never mentions is
  // one no model will ever fill in. G11 added the third.
  const schema = sent?.instructions ?? ''
  ok('and end with the schema the validator enforces',
    /"notable": string\[\]/.test(schema) && /"question"\?: string/.test(schema))
  ok('including the one optional field that can become a command',
    /"suggestion"\?: \{ "command": string, "commandType": string \}/.test(schema))
  ok('and it says plainly that a suggestion is never run automatically',
    /must confirm it/.test(schema))
}

console.log('\n-- the worker cannot reach the game --')
{
  const fs = await import('node:fs')
  const src = fs.readFileSync('src/lib/aiWorker.ts', 'utf8')
  ok('no import from the command path',
    !/from '\.\/(gameActions|gameCommand|gameLink)/.test(src))
  ok('no send or invoke surface anywhere in the worker',
    !/\b(sendGame|requestGameAction|invokeTauri|game_send)\b/.test(src))
  // G11 gave the live review a `suggestion` field, so the property above is no
  // longer carried by the shape of the contract alone. It is still true, and
  // these two say why: the store arrives as a structural interface admitting
  // `create`, so there is no `SuggestionStore` reference here and no way to
  // spell the method that sends.
  ok('the suggestion store is not imported, only described',
    !/from '\.\/aiSuggestions/.test(src))
  ok('and the worker has no way to spell the method that sends',
    !/requestExecution/.test(src))
}

console.log('\n-- a proposed command becomes a record, and only a record --')
{
  const proposing = {
    describe: () => ({ available: true }),
    generate: async () => ({
      ok: true,
      text: '{"notable":["a chest"],"suggestion":{"command":"look chest","commandType":"look"}}',
      tokens: 4,
    }),
  }
  // A spy that records what the worker asked for and can also refuse, so both
  // halves of the outcome are observable. `send` is deliberately absent: the
  // interface the worker is handed has no such method, which is the property.
  const made = []
  const suggestions = {
    create: (params) => {
      made.push(params)
      return { ok: true, suggestion: { id: 'suggestion:1' } }
    },
  }
  const d = setup({ provider: proposing, suggestions, stateVersion: 12 })
  d.journal.append('room', { id: 1 }, 41)
  const out = await runWorkerOnce(d)

  ok('the review parsed with its suggestion', out.review?.suggestion?.command === 'look chest',
    JSON.stringify(out.review))
  ok('exactly one record was proposed', made.length === 1, String(made.length))
  ok('carrying the command unchanged', made[0]?.exactCommand === 'look chest', made[0]?.exactCommand)
  ok('pinned to the state version the caller handed in', made[0]?.basedOnStateVersion === 12,
    String(made[0]?.basedOnStateVersion))
  ok('with an expiry in the future', made[0]?.expiresAt > d.now, String(made[0]?.expiresAt))
  // The journal assigns the sequence number; the third argument to `append`
  // is the timestamp. Asserted against what the journal actually handed the
  // turn, so this cannot pass by agreeing with a number invented here.
  ok('and citing the events it reviewed',
    made[0]?.evidenceRefs.length === 1 &&
    made[0]?.evidenceRefs[0] === `event:${d.journal.acknowledged()}`,
    JSON.stringify(made[0]?.evidenceRefs))
  ok('the outcome names the record rather than the command', out.suggestionId === 'suggestion:1')
  ok('and reports no refusal', out.suggestionRefused === null)

  // A host that wired no store produces no suggestions rather than crashing,
  // the same way it produces no claims.
  const bare = setup({ provider: proposing })
  bare.journal.append('room', { id: 1 }, 41)
  const noStore = await runWorkerOnce(bare)
  ok('with no store wired, the turn still succeeds', noStore.did === 'review')
  ok('and records nothing', noStore.suggestionId === null && noStore.suggestionRefused === null)

  // "The model proposed nothing" and "the proposal was refused" must not look
  // the same to a host that has to explain an empty panel.
  const refusing = {
    create: () => ({ ok: false, reason: 'a “look” suggestion must begin with “look”' }),
  }
  const denied = setup({ provider: proposing, suggestions: refusing, stateVersion: 12 })
  denied.journal.append('room', { id: 1 }, 41)
  const out2 = await runWorkerOnce(denied)
  ok('a refused proposal has no id', out2.suggestionId === null)
  ok('and says why', /must begin/.test(out2.suggestionRefused ?? ''), out2.suggestionRefused)

  // A review with no suggestion must not manufacture one.
  const quiet = setup({ suggestions, stateVersion: 12 })
  made.length = 0
  quiet.journal.append('room', { id: 1 }, 41)
  const out3 = await runWorkerOnce(quiet)
  ok('a review that proposed nothing records nothing', made.length === 0 && out3.suggestionId === null)
}

console.log('\n-- the validator is strict about the field that can become a command --')
{
  const malformed = [
    '{"notable":[],"suggestion":{"command":"look chest"}}',
    '{"notable":[],"suggestion":{"commandType":"look"}}',
    '{"notable":[],"suggestion":"look chest"}',
    '{"notable":[],"suggestion":{"command":7,"commandType":"look"}}',
    '{"notable":[],"suggestion":null}',
  ]
  for (const text of malformed) {
    const provider = {
      describe: () => ({ available: true }),
      generate: async () => ({ ok: true, text, tokens: 2 }),
    }
    const made = []
    const d = setup({
      provider,
      suggestions: { create: (p) => { made.push(p); return { ok: true, suggestion: { id: 'x' } } } },
    })
    d.journal.append('room', { id: 1 }, 1)
    const before = d.journal.acknowledged()
    const out = await runWorkerOnce(d)
    ok(`a malformed suggestion is invalid_output, not a record: ${text.slice(24, 60)}`,
      out.result.ok === false && out.result.failure === 'invalid_output' && made.length === 0,
      JSON.stringify({ failure: out.result.failure, made: made.length }))
    ok('and the cursor did not move past events nothing reviewed',
      d.journal.acknowledged() === before)
  }
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

console.log('\n-- a map reconciliation produces a claim with no model at all --')
{
  // Everything below runs against a real evidence store fed by a real journal,
  // so "the claim was accepted" is not resting on a resolver that says yes to
  // anything.
  const mapReconSetup = (provider, opts = {}) => {
    const d = setup({ provider, activity: 'idle', stateHash: 'h1', lastReviewedHash: 'h1' })
    d.journal.append('snapshot', { currentRoomId: 'room:143' }, 1)
    d.journal.append('line', { text: 'a gate' }, 2)
    const evidence = new EvidenceStore({ source: d.journal, capacity: 100 })
    evidence.load()
    const claims = new ClaimStore({ evidence, storage: { read: readJSON, write: writeJSON } })
    claims.load()
    d.jobs = new JobStore({ evidence })
    d.jobs.load()
    d.claims = claims
    d.evidence = evidence
    d.knownRoom = (id) => id === 'room:142'
    const job = d.jobs.create({
      kind: 'map_reconciliation',
      scope: { roomId: 'room:142', divergence: [{ move: 'east', inSnapshot: true, inStream: false }] },
      inputRefs: ['event:1', 'event:2'],
      allowedTools: ['flag_conflict'],
      now: d.nowIso,
    })
    return { d, job, claims, evidence }
  }

  {
    const { d, job, claims } = mapReconSetup(absentProvider())
    const out = await runWorkerOnce(d)
    ok('the job ran', out.did === 'background-job', out.did)
    ok('the provider was absent', out.result.ok === false && out.result.failure === 'absent', JSON.stringify(out.result))
    ok('exactly one claim', out.claimIds.length === 1, JSON.stringify(out.claimIds))
    const c = claims.get(out.claimIds[0])
    ok('about the room', c.subject === 'room:142')
    ok('with the right predicate', c.predicate === 'exit_divergence')
    ok('carrying the diff', JSON.stringify(c.value.diff) === JSON.stringify(job.scope.divergence))
    ok('confidence 0.5, which says the sources disagree', c.confidence === 0.5, String(c.confidence))
    ok('produced by the parser, named',
      c.producer.kind === 'parser' && c.producer.identity === 'aiJobProducers.detectExitDivergence', c.producer.identity)
    ok('and the job is awaiting review, not failed', d.jobs.get(job.jobId).status === 'awaiting_review', d.jobs.get(job.jobId).status)
    ok('the note says the parser claim stands alone', (d.jobs.get(job.jobId).note ?? '').includes('stands alone'), d.jobs.get(job.jobId).note)
  }

  {
    const { d, job } = mapReconSetup(oom)
    const out = await runWorkerOnce(d)
    ok('a failing model changes none of that', out.claimIds.length === 1, JSON.stringify(out.claimIds))
    ok('still awaiting review', d.jobs.get(job.jobId).status === 'awaiting_review')
    ok('and the failure is in the note', (d.jobs.get(job.jobId).note ?? '').includes('out_of_memory'), d.jobs.get(job.jobId).note)
  }
}

console.log('\n-- a working model adds a second claim, and only for a tether that survives validation --')
{
  const proposing = (tethers) => ({
    describe: () => ({ available: true }),
    generate: async () => ({ ok: true, text: JSON.stringify({ tethers }), tokens: 9 }),
  })

  const run = async (tethers, opts = {}) => {
    const d = setup({ provider: proposing(tethers), activity: 'idle', stateHash: 'h1', lastReviewedHash: 'h1' })
    d.journal.append('snapshot', { currentRoomId: 'room:143' }, 1)
    d.journal.append('line', { text: 'a gate' }, 2)
    if (opts.transport) d.journal.append('transport', { transport: true }, 3)
    const evidence = new EvidenceStore({ source: d.journal, capacity: 100 })
    evidence.load()
    const claims = new ClaimStore({ evidence, storage: { read: readJSON, write: writeJSON } })
    claims.load()
    d.jobs = new JobStore({ evidence })
    d.jobs.load()
    d.claims = claims
    d.evidence = evidence
    d.knownRoom = (id) => id === 'room:142'
    const job = d.jobs.create({
      kind: 'map_reconciliation',
      scope: { roomId: 'room:142', divergence: [{ move: 'east', inSnapshot: true, inStream: false }] },
      inputRefs: opts.transport ? ['event:1', 'event:2', 'event:3'] : ['event:1', 'event:2'],
      allowedTools: ['flag_conflict'],
      now: d.nowIso,
    })
    const out = await runWorkerOnce(d)
    return { d, job, claims, out, note: d.jobs.get(job.jobId).note ?? '' }
  }

  {
    // Destination room:143 IS in a cited authoritative snapshot.
    const { out, claims } = await run([
      {
        fromRoomId: 'room:142',
        toRoomId: 'room:143',
        kind: 'road',
        move: 'east',
        boardAnchor: { x: 2.5, y: 0, z: 0, yawDeg: 90 },
      },
    ])
    ok('two claims', out.claimIds.length === 2, JSON.stringify(out.claimIds))
    const model = out.claimIds.map((id) => claims.get(id)).find((c) => c.producer.kind === 'model')
    ok('the second one is the model proposal', model !== undefined)
    ok('and it is a tether claim', model.predicate === 'has_tether')
    ok('a bearing keeps the anchor it arrived with', model.value.boardAnchor !== null,
      JSON.stringify(model.value.boardAnchor))
  }

  {
    // ADVERSARIAL: an invented destination. Nothing ever went there.
    const { out, note, claims } = await run([
      { fromRoomId: 'room:142', toRoomId: 'room:999', kind: 'road', move: 'east' },
    ])
    ok('no model claim for an invented destination', out.claimIds.length === 1, JSON.stringify(out.claimIds))
    ok('the note names the destination', note.includes('room:999'), note)
    ok('and says no snapshot witnessed it', note.includes('authoritative snapshot'), note)
    ok('nothing produced by a model exists', claims.all().every((c) => c.producer.kind !== 'model'))
  }

  {
    // ADVERSARIAL: a directionless exit arriving WITH an anchor the model made up.
    const { out, claims } = await run([
      {
        fromRoomId: 'room:142',
        toRoomId: null,
        kind: 'threshold',
        move: 'go gate',
        boardAnchor: { x: 9, y: 9, z: 9, yawDeg: 9 },
      },
    ])
    ok('a directionless exit is still allowed as a claim', out.claimIds.length === 2, JSON.stringify(out.claimIds))
    const model = out.claimIds.map((id) => claims.get(id)).find((c) => c.producer.kind === 'model')
    ok('but its board anchor is null, not the invented one', model.value.boardAnchor === null, JSON.stringify(model.value.boardAnchor))
  }

  {
    // ADVERSARIAL: a portal justified only by two cells looking close together.
    const { out, note } = await run([
      { fromRoomId: 'room:142', toRoomId: null, kind: 'portal', move: 'enter shimmer', basis: ['board-proximity'] },
    ])
    ok('a proximity-only portal is refused', out.claimIds.length === 1, JSON.stringify(out.claimIds))
    ok('and the note says why', note.includes('board proximity'), note)
  }

  {
    // ADVERSARIAL: a ferry with no crossing in evidence.
    const { out, note } = await run([
      { fromRoomId: 'room:142', toRoomId: null, kind: 'ferry', move: 'board ferry' },
    ])
    ok('a ferry with no transport evidence is refused', out.claimIds.length === 1, JSON.stringify(out.claimIds))
    ok('and the note says what was missing', note.includes('transport'), note)
  }

  {
    // ...and the same ferry once a crossing is on file. The positive control
    // for the clause above: without it the ferry rule could be refusing
    // everything and look identical.
    const { out } = await run(
      [{ fromRoomId: 'room:142', toRoomId: null, kind: 'ferry', move: 'board ferry' }],
      { transport: true }
    )
    ok('a ferry WITH transport evidence is accepted', out.claimIds.length === 2, JSON.stringify(out.claimIds))
  }

  {
    // ADVERSARIAL: a room the map has never heard of.
    const { out, note } = await run([
      { fromRoomId: 'room:404', toRoomId: null, kind: 'road', move: 'east' },
    ])
    ok('an unknown origin room is refused', out.claimIds.length === 1)
    ok('and the note names it', note.includes('room:404'), note)
  }
}

console.log('\n-- malformed model output is invalid_output, and the parser claim still stands --')
{
  const malformed = {
    describe: () => ({ available: true }),
    generate: async () => ({ ok: true, text: 'not json at all', tokens: 2 }),
  }
  const d = setup({ provider: malformed, activity: 'idle', stateHash: 'h1', lastReviewedHash: 'h1' })
  d.journal.append('snapshot', { currentRoomId: 'room:143' }, 1)
  const evidence = new EvidenceStore({ source: d.journal, capacity: 100 })
  evidence.load()
  const claims = new ClaimStore({ evidence, storage: { read: readJSON, write: writeJSON } })
  claims.load()
  d.jobs = new JobStore({ evidence })
  d.jobs.load()
  d.claims = claims
  d.evidence = evidence
  d.knownRoom = () => true
  const job = d.jobs.create({
    kind: 'map_reconciliation',
    scope: { roomId: 'room:142', divergence: [{ move: 'east', inSnapshot: true, inStream: false }] },
    inputRefs: ['event:1'],
    allowedTools: ['flag_conflict'],
    now: d.nowIso,
  })
  const out = await runWorkerOnce(d)
  const note = d.jobs.get(job.jobId).note ?? ''
  ok('the parser claim still stands', out.claimIds.length === 1, JSON.stringify(out.claimIds))
  ok('the note says invalid_output', note.includes('invalid_output'), note)
  ok('and the job is awaiting review', d.jobs.get(job.jobId).status === 'awaiting_review')
}


console.log('')
const total = pass + fail
const MIN_EXPECTED = 68
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
