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
const { ingestLines, deriveAlerts, runHostTick, reviewHash, deriveActivity, sameStatus } = await import('../src/lib/aiIngest.ts')

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

console.log('\n-- status is published on a change, and otherwise on a slow schedule --')
{
  // A status the host really produced, not a fixture. The field list below is
  // read off this object, so a field added to AiWorkerStatus is covered here
  // without anybody remembering - which is the whole failure being guarded
  // against, and a hand-written base could not detect it.
  const base = await runHostTick({
    journal: new EventJournal(),
    alerts: new AlertBroker(),
    jobs: new JobStore(),
    provider: {
      describe: () => ({ available: false, reason: 'No local model is installed.' }),
      generate: async () => ({ ok: false, failure: 'absent', message: 'none' }),
    },
    app: { situation: [], roundtime: 0, bridgeConnected: true, roomId: 'r1', roomCombatants: [], isTown: false },
    memory: {
      lastReviewAt: null,
      lastReviewedHash: null,
      ticks: 0,
      missedLines: 0,
      roomChangedAt: null,
      lastAppendAt: 9_990,
    },
    now: 10_000,
    nowIso: '2026-09-05T00:00:00.000Z',
  })

  ok('two identical statuses are the same', sameStatus(base, { ...base }))
  ok('a different tick count alone is not a change - it moves every second by design',
    sameStatus(base, { ...base, ticks: 99 }))

  // Every field except ticks must be compared. Driven off the object's own
  // keys so a field added later is covered without anybody remembering to add
  // a case - the failure this replaces is a new field that silently never
  // reaches the panel.
  const changed = {
    available: true,
    providerReason: 'ready',
    journalPending: 3,
    journalLost: 7,
    missedLines: 2,
    pendingAlerts: 1,
    jobs: { running: 1 },
    lastOutcome: 'review',
    lastFailure: 'timeout: too slow',
    unreviewedWithoutModel: 42,
  }
  const fields = Object.keys(base).filter((k) => k !== 'ticks')
  ok('every field of the status except ticks has a changed value to test with',
    fields.every((f) => f in changed), fields.filter((f) => !(f in changed)).join(',') || 'all covered')
  for (const field of fields) {
    ok(`a change to ${field} is a change`, !sameStatus(base, { ...base, [field]: changed[field] }),
      String(changed[field]))
  }

  ok('a job count changing is a change even though the record is rebuilt each turn',
    !sameStatus({ ...base, jobs: { running: 1 } }, { ...base, jobs: { running: 2 } }))
  ok('a job disappearing is a change too, not only one appearing',
    !sameStatus({ ...base, jobs: { running: 1 } }, { ...base, jobs: {} }))
  ok('an equal job record built separately is not a change',
    sameStatus({ ...base, jobs: { running: 1 } }, { ...base, jobs: { running: 1 } }))
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

console.log('\n-- no model is an idle worker, not a permanent red loss counter --')
{
  // What shipped: an install with no model journals every line, never
  // acknowledges (an absent provider never returns ok), fills the 5000-event
  // bound, and the panel then reads "N events were discarded before review"
  // in danger ink forever. The capture is right; the framing was a lie.
  const runFor = async (provider) => {
    const j = new EventJournal()
    const buffer = []
    for (let i = 0; i < 6000; i++) buffer.push(line(`line ${i}`))
    ingestLines(j, buffer, 0)
    const memory = {
      lastReviewAt: null,
      lastReviewedHash: null,
      ticks: 0,
      missedLines: 0,
      roomChangedAt: null,
      lastAppendAt: 9_990,
    }
    return runHostTick({
      journal: j,
      alerts: new AlertBroker(),
      jobs: new JobStore(),
      provider,
      app: { situation: [], roundtime: 0, bridgeConnected: true, roomId: 'r1', roomCombatants: [], isTown: false },
      memory,
      now: 10_000,
      nowIso: '2026-09-05T00:00:00.000Z',
    })
  }

  const absent = await runFor({
    describe: () => ({ available: false, reason: 'No local model is installed.' }),
    generate: async () => ({ ok: false, failure: 'absent', message: 'No local model is installed.' }),
  })
  ok('capture still runs with no model - the events are journalled',
    absent.journalPending > 0, String(absent.journalPending))
  ok('and they are reported as unreviewed, not as loss',
    absent.unreviewedWithoutModel > 0, String(absent.unreviewedWithoutModel))
  ok('the count covers everything captured, including what the bound dropped',
    absent.unreviewedWithoutModel >= absent.journalLost + absent.journalPending,
    `${absent.unreviewedWithoutModel} >= ${absent.journalLost} + ${absent.journalPending}`)

  const scripted = await runFor({
    describe: () => ({ available: true, profile: 'scripted' }),
    generate: async () => ({ ok: true, text: 'reviewed', tokens: 3 }),
  })
  ok('with a model available the same input reports real loss',
    scripted.journalLost > 0, String(scripted.journalLost))
  ok('and nothing is filed as unreviewed-for-want-of-a-model',
    scripted.unreviewedWithoutModel === 0, String(scripted.unreviewedWithoutModel))

  const fs = await import('node:fs')
  const panel = fs.readFileSync('src/components/shared/AiWorkerPanel.tsx', 'utf8')
  ok('the danger-ink loss paragraph is reachable only when a provider is available',
    /status\.available && lost > 0/.test(panel))
  ok('and the no-model paragraph is not in danger ink',
    /unreviewedWithoutModel > 0[\s\S]{0,200}text-ink-muted/.test(panel))
}

console.log('\n-- the panel promises only what this build can do --')
{
  const fs = await import('node:fs')
  const panel = fs.readFileSync('src/components/shared/AiWorkerPanel.tsx', 'utf8')
  /**
   * Keyed on whether the host can actually build a local provider, not on
   * whether a file called aiLocalProvider.ts exists.
   *
   * The original read `existsSync('src/lib/aiLocalProvider.ts')`, which is an
   * existence check on the container standing in for a content check on the
   * thing: the module can be committed, and tested, and still be reachable by
   * nobody, at which point the panel would be made to promise a feature that
   * has no way in. What decides the player's experience is whether the host
   * imports it, so that is what the promise is held against.
   */
  const host = fs.readFileSync(HOST_SRC, 'utf8')
  const providerReachable = /from '\.\/aiLocalProvider\.ts'/.test(host)
  const saysNotAvailable = /Local model support is not yet available in this build\./.test(panel)
  const saysPointAtOne = /a model server running on this machine/.test(panel)

  ok('the panel says exactly one of the two things', saysNotAvailable !== saysPointAtOne,
    `not-yet=${saysNotAvailable} point-at-one=${saysPointAtOne}`)
  ok(providerReachable
    ? 'the host can build a local provider, so the panel must tell the player how to connect one'
    : 'nothing can build a local provider, so the panel must say support is not in this build',
    providerReachable ? saysPointAtOne : saysNotAvailable,
    `host imports aiLocalProvider: ${providerReachable}`)
  ok('a refused prompt is named rather than left to read as a generic failure',
    /Sensitive input withheld/.test(panel))
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
const MIN_EXPECTED = 75
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
