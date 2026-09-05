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
const { AlertBroker } = await import('../src/lib/aiAlertBroker.ts')
const { JobStore } = await import('../src/lib/aiJobStore.ts')
const { ingestLines, deriveAlerts, runHostTick, reviewHash, deriveActivity } = await import('../src/lib/aiIngest.ts')

/**
 * The host module is read as text, never imported: it pulls in useAppStore,
 * which reaches src/bridge through a directory import Node refuses. The path
 * is overridable so the source checks below can be aimed at a deliberately
 * broken copy - a branch nobody can execute on purpose is a branch nobody can
 * prove they fixed.
 */
const HOST_SRC = process.env.DRC_AI_HOST_SRC ?? 'src/lib/aiWorkerHost.ts'

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

console.log('\n-- the review hash wakes the model for changes that matter, and only those --')
{
  // Equal hashes suppress inference entirely, so this function decides both
  // what gets reviewed and what never can be. Each case below is a real
  // frame-to-frame change from a live session.
  const base = {
    roomId: 'room-1',
    situation: ['in_combat'],
    roundtime: 0,
    roomCombatants: [{ hostile: true, dead: false }],
  }
  const h = (over) => reviewHash({ ...base, ...over })

  ok('walking into another room is a change', h({}) !== h({ roomId: 'room-2' }), h({ roomId: 'room-2' }))
  ok('health 84 to 83 is not - vitals are not in the hash at all',
    h({ health: 84 }) === h({ health: 83 }))
  ok('roundtime counting 9 down to 4 is not a change',
    h({ roundtime: 9 }) === h({ roundtime: 4 }))
  ok('but roundtime reaching 0 is - you can act again',
    h({ roundtime: 4 }) !== h({ roundtime: 0 }))
  ok('a killed hostile is a change', h({}) !== h({ roomCombatants: [{ hostile: true, dead: true }] }))
  ok('a corpse and an empty room hash the same - a corpse is not a threat',
    h({ roomCombatants: [{ hostile: true, dead: true }] }) === h({ roomCombatants: [] }))
  ok('flag order from the bridge does not invent a change',
    reviewHash({ ...base, situation: ['stunned', 'in_combat'] }) ===
      reviewHash({ ...base, situation: ['in_combat', 'stunned'] }))
  ok('gaining a situation flag is a change', h({}) !== h({ situation: ['in_combat', 'stunned'] }))
  ok('absent state does not throw and hashes stably',
    reviewHash({ roomId: undefined, situation: undefined, roundtime: undefined, roomCombatants: undefined }) ===
      reviewHash({ roomId: null, situation: [], roundtime: 0, roomCombatants: [] }))
}

console.log('\n-- activity is decided in priority order, not by independent tests --')
{
  // Every frame satisfies several of these at once, so the table is written
  // as cases that each match more than one rule: what is being checked is
  // which rule wins, not whether the rule exists.
  const NOW = 1_000_000
  const cases = [
    {
      what: 'no bridge outranks everything, including combat',
      state: { bridgeConnected: false, situation: ['in_combat'], roomChangedAt: NOW - 1, lastAppendAt: NOW, isTown: true },
      want: 'disconnected',
    },
    {
      what: 'combat outranks a room you just walked into',
      state: { bridgeConnected: true, situation: ['in_combat'], roomChangedAt: NOW - 1000, lastAppendAt: NOW, isTown: true },
      want: 'combat',
    },
    {
      what: 'a room entered 3s ago is travel, even in a safe town',
      state: { bridgeConnected: true, situation: [], roomChangedAt: NOW - 3000, lastAppendAt: NOW, isTown: true },
      want: 'travel',
    },
    {
      what: 'travel lapses after ten seconds',
      state: { bridgeConnected: true, situation: [], roomChangedAt: NOW - 10_001, lastAppendAt: NOW, isTown: false },
      want: 'active',
    },
    {
      what: 'silence for over two minutes is idle, wherever you are standing',
      state: { bridgeConnected: true, situation: [], roomChangedAt: NOW - 60_000, lastAppendAt: NOW - 120_001, isTown: true },
      want: 'idle',
    },
    {
      what: 'a town with a live stream is quiet',
      state: { bridgeConnected: true, situation: [], roomChangedAt: NOW - 60_000, lastAppendAt: NOW - 5000, isTown: true },
      want: 'quiet',
    },
    {
      what: 'anywhere else with a live stream is active',
      state: { bridgeConnected: true, situation: [], roomChangedAt: NOW - 60_000, lastAppendAt: NOW - 5000, isTown: false },
      want: 'active',
    },
    {
      what: 'a journal that has never taken a line is idle, not active',
      state: { bridgeConnected: true, situation: [], roomChangedAt: null, lastAppendAt: null, isTown: false },
      want: 'idle',
    },
    {
      what: 'a bridge too old to report isTown reads as not a town',
      state: { bridgeConnected: true, situation: [], roomChangedAt: null, lastAppendAt: NOW - 5000, isTown: undefined },
      want: 'active',
    },
  ]

  for (const c of cases) {
    const got = deriveActivity({ ...c.state, now: NOW })
    ok(c.what, got === c.want, `${got} (wanted ${c.want})`)
  }

  const covered = new Set(cases.map((c) => c.want))
  ok('every activity the scheduler knows about is produced by some case',
    ['combat', 'travel', 'active', 'quiet', 'idle', 'disconnected'].every((a) => covered.has(a)),
    [...covered].join(','))
}

console.log('\n-- a turn in flight is not disturbed by unrelated updates --')
{
  // The defect this guards: the tick effect used to depend on `character`,
  // which is replaced on every status frame, so its cleanup ran about once a
  // second and aborted whatever generation was in flight. Nothing errored -
  // the worker recorded `cancelled`, which is a legitimate outcome - so a
  // model that took longer than one frame to answer would simply never
  // finish, forever, with an honest-looking status line.
  const j = new EventJournal()
  const broker = new AlertBroker()
  const jobs = new JobStore()
  const stuck = {
    describe: () => ({ available: true, profile: 'never answers' }),
    generate: () => new Promise(() => {}),
  }

  const buffer = [line('a'), line('b')]
  ingestLines(j, buffer, 0)
  const before = j.acknowledged()

  const memory = { lastReviewAt: null, lastReviewedHash: null, ticks: 0, missedLines: 0, roomChangedAt: null, lastAppendAt: 9_990 }
  const controller = new AbortController()
  let settled = false
  const inFlight = runHostTick({
    journal: j,
    alerts: broker,
    jobs,
    provider: stuck,
    app: { situation: [], roundtime: 0, bridgeConnected: true },
    memory,
    now: 10_000,
    nowIso: '2026-09-05T00:00:00.000Z',
    signal: controller.signal,
  })
  inFlight.then(
    () => (settled = true),
    () => (settled = true)
  )

  // Twenty updates of the kind a store change drives through this host.
  for (let i = 0; i < 20; i++) {
    buffer.push(line(`update-${i}`))
    ingestLines(j, buffer, buffer.length - 1)
  }
  await new Promise((r) => setTimeout(r, 20))

  ok('twenty updates during a turn do not abort the generation', controller.signal.aborted === false)
  ok('the turn is still in flight rather than cancelled out from under itself', settled === false)
  ok('and the cursor has not moved', j.acknowledged() === before, String(j.acknowledged()))
  ok('the turn counted itself exactly once', memory.ticks === 1, String(memory.ticks))

  controller.abort()
  const outcome = await inFlight
  ok('cancelling really does end the turn', settled === true)
  ok('a cancelled turn still acknowledges nothing', j.acknowledged() === before, String(j.acknowledged()))
  ok('and reports the failure rather than swallowing it',
    /cancelled/.test(outcome.lastFailure ?? ''), String(outcome.lastFailure))
}

console.log('\n-- the tick effect does not depend on per-tick state --')
{
  const fs = await import('node:fs')
  const src = fs.readFileSync(HOST_SRC, 'utf8')

  // The property, not the mechanism: whatever owns the abort controller must
  // not be rebuilt by ordinary state churn. That is decided entirely by the
  // dependency array of the effect that calls runHostTick.
  const effect = /runHostTick\(\{[\s\S]*?\n {2}\}, \[([^\]]*)\]\)/.exec(src)
  ok('the tick effect and its dependency array were found in the source',
    effect !== null, HOST_SRC)
  const deps = effect?.[1] ?? ''
  ok('the tick effect depends on enabled and provider', /enabled/.test(deps) && /provider/.test(deps), deps)
  ok('and on nothing that changes every frame',
    !/\b(character|bridgeConnected|version|status)\b/.test(deps), deps)

  // A positive control on the regexp itself: the same shape with `character`
  // present must be caught, or the check above is only reporting that its
  // pattern did not match.
  const sabotaged = src.replace(/(runHostTick\(\{[\s\S]*?\n {2}\}, \[)([^\]]*)(\]\))/, '$1$2, character$3')
  const control = /runHostTick\(\{[\s\S]*?\n {2}\}, \[([^\]]*)\]\)/.exec(sabotaged)
  ok('the same check catches character when it is present',
    /\bcharacter\b/.test(control?.[1] ?? ''), control?.[1] ?? 'no match')
}

console.log('\n-- the host cannot reach the game command path --')
{
  const fs = await import('node:fs')
  const src = fs.readFileSync(HOST_SRC, 'utf8')
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
const MIN_EXPECTED = 50
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
