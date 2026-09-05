/**
 * A producer that fires on every tick fills the queue with noise, and one that
 * never fires is indistinguishable from a map with no errors in it.
 *
 * Both failures are here. The dedupe is checked by asking twice and demanding
 * one job; the "always fires" failure is checked by giving a room a doorway,
 * which the compass cannot ever mention, and demanding silence.
 */
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const { detectExitDivergence, proposeMapReconciliation } = await import('../src/lib/aiJobProducers.ts')
const { JobStore } = await import('../src/lib/aiJobStore.ts')
const { EvidenceStore } = await import('../src/lib/aiEvidenceStore.ts')
const { EventJournal } = await import('../src/lib/aiEventJournal.ts')

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

const NOW = '2026-09-05T12:00:00Z'
const cell = (...moves) => ({ exits: moves.map((move) => ({ move })) })

const fresh = () => {
  store.clear()
  const journal = new EventJournal({ capacity: 100 })
  for (let i = 0; i < 5; i++) journal.append('line', { i }, i)
  const evidence = new EvidenceStore({ source: journal, capacity: 100 })
  evidence.load()
  const jobs = new JobStore({ evidence })
  jobs.load()
  return { jobs, evidence }
}

console.log('-- agreement produces nothing, whichever vocabulary each side uses --')
{
  ok('identical lists agree', detectExitDivergence(cell('north', 'east'), ['north', 'east']).length === 0)
  ok(
    'the compass abbreviations are the same directions',
    detectExitDivergence(cell('north', 'northeast'), ['n', 'ne']).length === 0,
    JSON.stringify(detectExitDivergence(cell('north', 'northeast'), ['n', 'ne']))
  )
  ok('order does not matter', detectExitDivergence(cell('east', 'north'), ['n', 'e']).length === 0)
  ok('case does not matter', detectExitDivergence(cell('North'), ['N']).length === 0)
}

console.log('-- a doorway is not a divergence, because the compass never mentions one --')
{
  // The check that always fires would report `go gate` missing from the
  // compass in every room with a gate, forever. That is the same amount of
  // information as a check that never fires.
  const d = detectExitDivergence(cell('north', 'go gate', 'climb ladder', 'out', 'up'), ['n'])
  ok('only bearings are compared', d.length === 0, JSON.stringify(d))

  const withReal = detectExitDivergence(cell('north', 'go gate'), ['n', 'e'])
  ok('and a real disagreement beside a doorway is still found', withReal.length === 1, JSON.stringify(withReal))
  ok('naming the bearing, not the doorway', withReal[0].move === 'east')
}

console.log('-- each side is named, because a stale map and a closed exit need different fixes --')
{
  const missingFromStream = detectExitDivergence(cell('north', 'east'), ['n'])
  ok('one divergence', missingFromStream.length === 1, JSON.stringify(missingFromStream))
  ok('it names the direction', missingFromStream[0].move === 'east')
  ok('in the snapshot', missingFromStream[0].inSnapshot === true)
  ok('not in the stream', missingFromStream[0].inStream === false)

  const missingFromSnapshot = detectExitDivergence(cell('north'), ['n', 'w'])
  ok('the other direction is found too', missingFromSnapshot.length === 1)
  ok('and named the other way round',
    missingFromSnapshot[0].inSnapshot === false && missingFromSnapshot[0].inStream === true,
    JSON.stringify(missingFromSnapshot[0]))

  const both = detectExitDivergence(cell('north', 'east'), ['n', 'w'])
  ok('both kinds at once', both.length === 2, JSON.stringify(both))
  ok('sorted, so two runs produce the same list', both.map((x) => x.move).join(',') === 'east,west')
}

console.log('-- missing knowledge is not disagreement --')
{
  ok('no cell yet', detectExitDivergence(null, ['n']).length === 0)
  ok('no compass yet', detectExitDivergence(cell('north'), null).length === 0)
  ok('an empty compass that has arrived IS a disagreement',
    detectExitDivergence(cell('north'), []).length === 1,
    JSON.stringify(detectExitDivergence(cell('north'), [])))
}

console.log('-- a divergence makes one job, and asking again makes none --')
{
  const { jobs } = fresh()
  const divergence = detectExitDivergence(cell('north', 'east'), ['n'])

  const first = proposeMapReconciliation({ jobs, roomId: 'room:142', divergence, evidenceSeqs: [3], now: NOW })
  ok('a job was created', first.created === true && first.job !== null, first.reason)
  ok('of the right kind', first.job.kind === 'map_reconciliation')
  ok('scoped to the room', first.job.scope.roomId === 'room:142')
  ok('carrying the divergence it was made for', first.job.scope.divergence.length === 1)
  ok('with evidence as refs, not payloads', first.job.inputRefs[0] === 'event:3', first.job.inputRefs.join(','))
  ok('and one tool, which cannot write anything',
    first.job.allowedTools.length === 1 && first.job.allowedTools[0] === 'flag_conflict',
    first.job.allowedTools.join(','))
  ok('the evidence really was pinned', first.job.unpinnedInputRefs === undefined)

  const second = proposeMapReconciliation({ jobs, roomId: 'room:142', divergence, evidenceSeqs: [4], now: NOW })
  ok('asking again creates nothing', second.created === false, second.reason)
  ok('and points at the job that already covers it', second.job.jobId === first.job.jobId)
  ok('still exactly one job', jobs.all().length === 1, String(jobs.all().length))

  const other = proposeMapReconciliation({ jobs, roomId: 'room:143', divergence, evidenceSeqs: [4], now: NOW })
  ok('another room gets its own job', other.created === true)
  ok('two jobs now', jobs.all().length === 2, String(jobs.all().length))
}

console.log('-- a resolved job stops covering the room, so a later divergence is heard --')
{
  const { jobs } = fresh()
  const divergence = detectExitDivergence(cell('north', 'east'), ['n'])
  const first = proposeMapReconciliation({ jobs, roomId: 'room:142', divergence, evidenceSeqs: [1], now: NOW })
  jobs.transition(first.job.jobId, 'cancelled', { now: NOW })

  const again = proposeMapReconciliation({ jobs, roomId: 'room:142', divergence, evidenceSeqs: [2], now: NOW })
  ok('a terminal job does not suppress a new one', again.created === true, again.reason)
  ok('two records, not one reopened', jobs.all().length === 2, String(jobs.all().length))
}

console.log('-- no divergence, no job --')
{
  const { jobs } = fresh()
  const r = proposeMapReconciliation({ jobs, roomId: 'room:142', divergence: [], evidenceSeqs: [1], now: NOW })
  ok('nothing was created', r.created === false && r.job === null, r.reason)
  ok('and the queue is empty', jobs.all().length === 0)
}

console.log('')
const total = pass + fail
const MIN_EXPECTED = 30
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
