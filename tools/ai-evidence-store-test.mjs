/**
 * Evidence has to still be there when somebody reads the claim that cites it.
 *
 * The failure this suite is built around is not an exception. It is a claim
 * shown with two of its four events and nothing saying the other two are
 * gone — a partial answer wearing the clothes of a complete one. So the
 * decisive cases here are the ones where something is missing: a ref that was
 * never pinned, a journal that evicted past capacity before the pin, and an
 * eviction pass that would have discarded evidence a live claim is standing
 * on.
 */
// Minimal localStorage shim, same shape the other isolated tests use.
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const { EvidenceStore, eventRef, refSeq, EVIDENCE_KEY } = await import(
  '../src/lib/aiEvidenceStore.ts'
)
const { EventJournal } = await import('../src/lib/aiEventJournal.ts')
const { JobStore } = await import('../src/lib/aiJobStore.ts')

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

const fresh = (capacity, journalCapacity = 100) => {
  store.clear()
  const journal = new EventJournal({ capacity: journalCapacity })
  const evidence = new EvidenceStore({ source: journal, capacity })
  evidence.load()
  return { journal, evidence }
}

console.log('-- a ref names one sequence, and an unreadable ref names none --')
{
  ok('eventRef builds the vocabulary claims already use', eventRef(1733) === 'event:1733')
  ok('refSeq reads it back', refSeq('event:1733') === 1733)
  ok('a ref of another kind is not guessed at', refSeq('observation:1733') === null)
  ok('a malformed ref is not guessed at', refSeq('event:') === null)
}

console.log('\n-- pin, then evict the journal past capacity: the payload survives --')
{
  const { journal, evidence } = fresh(50, 5)
  for (let i = 0; i < 5; i++) journal.append('line', { text: `line ${i + 1}` }, 1000 + i)

  const pinned = evidence.pin(['event:2', 'event:3'], 'job:1')
  ok('both refs pinned', pinned.pinned.length === 2 && pinned.missing.length === 0)

  // Push the journal well past its bound. Events 2 and 3 are gone from it.
  for (let i = 0; i < 20; i++) journal.append('line', { text: `later ${i}` }, 2000 + i)
  ok(
    'the journal itself no longer holds event 2',
    journal.readFrom(1, 1).events[0]?.seq !== 2,
    `oldest retained is ${journal.stats().oldestRetained}`
  )

  const resolved = evidence.resolve(['event:2', 'event:3'])
  ok('the evidence store still resolves both', resolved.resolved.length === 2)
  ok('nothing is reported missing', resolved.missing.length === 0)
  ok(
    'the payload is the original, not a placeholder',
    resolved.resolved[0].payload.text === 'line 2',
    JSON.stringify(resolved.resolved[0].payload)
  )
  ok('the kind travelled with it', resolved.resolved[0].kind === 'line')
  ok('so did the original timestamp', resolved.resolved[0].at === 1001)
}

console.log('\n-- a ref that was never pinned is named, never silently dropped --')
{
  const { journal, evidence } = fresh(50)
  journal.append('line', { text: 'one' }, 1)
  evidence.pin(['event:1'], 'claim:1')

  const r = evidence.resolve(['event:1', 'event:9999'])
  ok('the pinned one resolves', r.resolved.length === 1)
  ok('the unpinned one is listed in missing', r.missing.length === 1 && r.missing[0] === 'event:9999')
  ok('resolvesAll refuses the set', evidence.resolvesAll(['event:1', 'event:9999']) === false)
  ok('and accepts the set that is wholly held', evidence.resolvesAll(['event:1']) === true)
  ok('an empty ref list is not "all resolved"', evidence.resolvesAll([]) === false)
}

console.log('\n-- pinning something the journal has already lost reports it --')
{
  const { journal, evidence } = fresh(50, 3)
  for (let i = 0; i < 10; i++) journal.append('line', { text: `x${i}` }, i)
  // Only the last three survive: 8, 9, 10.
  const result = evidence.pin(['event:1', 'event:9'], 'job:2')
  ok('the surviving one is pinned', result.pinned.length === 1 && result.pinned[0] === 'event:9')
  ok('the evicted one is reported missing', result.missing.length === 1 && result.missing[0] === 'event:1')
  ok('and it was not stored under a later event', evidence.resolve(['event:1']).missing.length === 1)
}

console.log('\n-- the pin reads the event it asked for, not the next one along --')
{
  // A journal whose oldest retained event is 8: asking for 5 must not hand
  // back 8 under the ref "event:5". This is the quietest way to attach the
  // wrong evidence to a claim, and it looks like a successful pin.
  const { journal, evidence } = fresh(50, 3)
  for (let i = 0; i < 10; i++) journal.append('mark', { i }, i)
  const r = evidence.pin(['event:5'], 'job:3')
  ok('a lost ref is missing rather than substituted', r.missing[0] === 'event:5' && r.pinned.length === 0)
}

console.log('\n-- eviction takes the oldest uncited entry and never a cited one --')
{
  const { journal, evidence } = fresh(3)
  for (let i = 0; i < 6; i++) journal.append('line', { i }, i)

  // event:1 is cited by a live claim; the rest are pinned and then released,
  // so they are ordinary retention.
  evidence.pin(['event:1'], 'claim:live', 100)
  evidence.pin(['event:2'], 'job:done', 200)
  evidence.pin(['event:3'], 'job:done', 300)
  evidence.release('job:done')
  ok('three retained, one cited', evidence.stats().retained === 3 && evidence.stats().cited === 1)

  evidence.pin(['event:4'], 'job:next', 400)
  const after = evidence.resolve(['event:1', 'event:2', 'event:3', 'event:4'])
  ok('the store is back at its bound', evidence.stats().retained === 3, `${evidence.stats().retained}`)
  ok('the oldest uncited entry went', after.missing.length === 1 && after.missing[0] === 'event:2')
  ok('the cited entry survived', evidence.resolve(['event:1']).resolved.length === 1)
  ok('one eviction was counted', evidence.stats().evicted === 1)
}

console.log('\n-- when everything retained is cited, the store says so rather than dropping one --')
{
  const { journal, evidence } = fresh(2)
  for (let i = 0; i < 4; i++) journal.append('line', { i }, i)
  evidence.pin(['event:1'], 'claim:a', 100)
  evidence.pin(['event:2'], 'claim:b', 200)
  evidence.pin(['event:3'], 'claim:c', 300)

  const all = evidence.resolve(['event:1', 'event:2', 'event:3'])
  ok('no cited entry was discarded', all.resolved.length === 3, `missing ${all.missing.join(',')}`)
  ok('the overrun is reported', evidence.stats().overCapacity === 1, `${evidence.stats().overCapacity}`)
  ok('and nothing was counted as evicted', evidence.stats().evicted === 0)
}

console.log('\n-- releasing a citer makes its evidence evictable again, not gone --')
{
  const { journal, evidence } = fresh(10)
  journal.append('line', { text: 'a' }, 1)
  evidence.pin(['event:1'], 'claim:x')
  const released = evidence.release('claim:x')
  ok('one entry released', released === 1)
  ok('the entry is still readable straight afterwards', evidence.resolve(['event:1']).resolved.length === 1)
  ok('but it is no longer cited', evidence.stats().cited === 0)
}

console.log('\n-- two citers on one entry: releasing one does not unpin it --')
{
  const { journal, evidence } = fresh(10)
  journal.append('line', { text: 'a' }, 1)
  evidence.pin(['event:1'], 'claim:x')
  const second = evidence.pin(['event:1'], 'claim:y')
  ok('re-citing a held ref is an ordinary success', second.pinned.length === 1 && second.missing.length === 0)
  evidence.release('claim:x')
  ok('still cited by the other', evidence.stats().cited === 1)
}

console.log('\n-- what is pinned survives a reload --')
{
  const { journal, evidence } = fresh(10)
  journal.append('line', { text: 'durable' }, 42)
  evidence.pin(['event:1'], 'claim:z')
  const reloaded = new EvidenceStore({ capacity: 10 })
  reloaded.load()
  const r = reloaded.resolve(['event:1'])
  ok('the payload came back from storage', r.resolved[0]?.payload.text === 'durable')
  ok('under the documented key', store.has(EVIDENCE_KEY), EVIDENCE_KEY)
}

console.log('\n-- JobStore.create pins its inputRefs, and reports what it could not --')
{
  const { journal, evidence } = fresh(50, 3)
  for (let i = 0; i < 10; i++) journal.append('line', { i }, i)
  const jobs = new JobStore({ evidence })
  jobs.load()

  const job = jobs.create({
    kind: 'map_reconciliation',
    inputRefs: ['event:9', 'event:1'],
    now: '2026-09-05T12:00:00Z',
  })
  ok('the surviving ref is pinned by the job', evidence.resolve(['event:9']).resolved.length === 1)
  ok(
    'the lost ref is recorded on the job, not dropped',
    job.unpinnedInputRefs?.length === 1 && job.unpinnedInputRefs[0] === 'event:1',
    JSON.stringify(job.unpinnedInputRefs)
  )
  ok('the job is the citer', evidence.resolve(['event:9']).resolved[0].citedBy[0] === job.jobId)

  const clean = jobs.create({
    kind: 'wiki_draft',
    inputRefs: ['event:10'],
    now: '2026-09-05T12:00:01Z',
  })
  ok('a job whose refs all pin carries no unpinned list', clean.unpinnedInputRefs === undefined)
}

console.log('\n-- a store with no source pins nothing and says so --')
{
  store.clear()
  const detached = new EvidenceStore({ capacity: 5 })
  detached.load()
  const r = detached.pin(['event:1'], 'job:1')
  ok('every ref is missing', r.missing.length === 1 && r.pinned.length === 0)
  ok('a jobless JobStore still works', new JobStore().create({ kind: 'wiki_draft', now: 'x' }).jobId === 'job:1')
}

console.log('')
const total = pass + fail
const MIN_EXPECTED = 36
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
