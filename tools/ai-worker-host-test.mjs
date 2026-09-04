/**
 * The two decisions in the host that are easy to get silently wrong: which
 * lines are new, and which parsed state becomes an alert.
 *
 * Both fail quietly when wrong. Ingesting from the wrong offset duplicates
 * every line or skips a batch with nothing thrown, and a disconnect alert that
 * fires at startup trains a player to ignore the one priority that must never
 * be ignored. The React wiring around them is not tested here; these are the
 * parts where a bug would not announce itself.
 */
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const { EventJournal } = await import('../src/lib/aiEventJournal.ts')
const { ingestLines, deriveAlerts } = await import('../src/lib/aiIngest.ts')

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

const line = (text, stream = '') => ({ text, stream, at: 1 })

console.log('-- ingestion appends each line exactly once --')
{
  const j = new EventJournal()
  const lines = [line('a'), line('b')]
  const first = ingestLines(j, lines, 0)
  ok('both new lines are journalled', first.appended === 2, String(first.appended))
  ok('and the ingested mark matches the buffer length', first.ingested === 2)

  // The buffer grows; only the new tail should be appended.
  lines.push(line('c'))
  const second = ingestLines(j, lines, first.ingested)
  ok('a later pass appends only what arrived since', second.appended === 1, String(second.appended))
  ok('so nothing is journalled twice', j.stats().appended === 3, String(j.stats().appended))
  ok('and the events are in arrival order',
    j.readFrom(0).events.map((e) => e.payload.text).join('') === 'abc')
}

console.log('\n-- a pass with nothing new does nothing --')
{
  const j = new EventJournal()
  const lines = [line('a')]
  ingestLines(j, lines, 0)
  const again = ingestLines(j, lines, 1)
  ok('no events appended', again.appended === 0, String(again.appended))
  ok('the journal is unchanged', j.stats().appended === 1, String(j.stats().appended))
}

console.log('\n-- a truncated buffer cannot make ingestion run backwards --')
{
  // gameLink trims its buffer under load, so the array can be SHORTER than
  // the count we last ingested. Appending from a stale offset would replay
  // old lines as new ones.
  const j = new EventJournal()
  const trimmed = [line('x')]
  const r = ingestLines(j, trimmed, 5)
  ok('an ingested mark beyond the buffer appends nothing rather than replaying',
    r.appended === 0, String(r.appended))
  ok('the journal stays empty', j.stats().appended === 0)
}

console.log('\n-- lines the display buffer dropped are reported, not absorbed --')
{
  const j = new EventJournal()
  const r = ingestLines(j, [line('a')], 0, 12, 0)
  ok('newly dropped lines are counted as missed', r.missed === 12, String(r.missed))

  // Already-counted drops must not be counted again on every tick.
  const r2 = ingestLines(j, [line('a'), line('b')], 1, 12, 12)
  ok('drops already seen are not double counted', r2.missed === 0, String(r2.missed))

  const r3 = ingestLines(j, [line('a'), line('b')], 2, 20, 12)
  ok('further drops are counted once', r3.missed === 8, String(r3.missed))
}

console.log('\n-- alerts come from parsed state, with the startup case handled --')
{
  const never = deriveAlerts({ situation: [], bridgeConnected: false, everConnected: false })
  ok('a client that has never connected is NOT reported as disconnected',
    never.length === 0, JSON.stringify(never.map((a) => a.key)))

  const dropped = deriveAlerts({ situation: [], bridgeConnected: false, everConnected: true })
  ok('losing an established connection is critical',
    dropped.length === 1 && dropped[0].priority === 'critical', dropped[0]?.key)

  const fine = deriveAlerts({ situation: ['in_combat'], bridgeConnected: true, everConnected: true })
  ok('ordinary combat is not an alert by itself', fine.length === 0,
    JSON.stringify(fine.map((a) => a.key)))

  const stunned = deriveAlerts({ situation: ['in_combat', 'stunned'], bridgeConnected: true, everConnected: true })
  ok('stunned is urgent', stunned.some((a) => a.key === 'situation:stunned' && a.priority === 'urgent'))

  for (const flag of ['webbed', 'immobilized', 'dying']) {
    const got = deriveAlerts({ situation: [flag], bridgeConnected: true, everConnected: true })
    ok(`${flag} is urgent`, got.length === 1 && got[0].priority === 'urgent', got[0]?.key)
  }

  // prone is dangerous but you can still act; it must not preempt research.
  const prone = deriveAlerts({ situation: ['prone'], bridgeConnected: true, everConnected: true })
  ok('prone is NOT raised as urgent - vulnerable is not helpless', prone.length === 0)

  const many = deriveAlerts({ situation: ['stunned', 'webbed'], bridgeConnected: false, everConnected: true })
  ok('several conditions each get their own keyed alert, so none is hidden',
    many.length === 3, String(many.length))

  ok('absent situation data does not throw and raises nothing',
    deriveAlerts({ situation: undefined, bridgeConnected: true, everConnected: true }).length === 0)
}

console.log('\n-- the host cannot reach the game command path --')
{
  const fs = await import('node:fs')
  const src = fs.readFileSync('src/lib/aiWorkerHost.ts', 'utf8')
  ok('no import from gameActions or gameCommand',
    !/from '\.\/(gameActions|gameCommand)'/.test(src))
  ok('it reads the stream but never sends to it',
    !/\b(sendGame|requestGameAction|game_send)\b/.test(src))
  // It legitimately reads gameLink for the buffer; the ban is on sending.
  ok('it does read the established stream owner rather than a second source',
    /from '\.\/gameLink'/.test(src))
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
