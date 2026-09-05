/**
 * A tool a model can point anywhere is not a read-only tool.
 *
 * The allowlist is the part everybody remembers, and it is the smaller half.
 * What this suite is really built around is the three ways a tool layer leaks
 * while looking correct: arguments that were never validated, a result quietly
 * shortened so a partial corpus reads as complete, and a call that happened
 * without appearing in the job's trace. Each of those passes a test that only
 * checks the happy path.
 */
const { callTool, capResult, TOOL_IDS, untrusted } = await import('../src/lib/aiKnowledgeTools.ts')

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

/** A zone in the shape `compileWorldSnapshot` reads, built here rather than
 * loaded, so this suite never depends on which zones ship. */
const ZONE = {
  ok: true,
  zone: '1',
  name: 'The Crossing',
  rooms: [
    {
      id: 142,
      uid: null,
      title: 'Town Green, Northeast',
      x: 10,
      y: 20,
      z: 0,
      tags: ['Town Green'],
      to: [143, 144],
      moves: ['north', 'go gate'],
    },
    { id: 143, uid: null, title: 'Hodierna Way', x: 10, y: 21, z: 0, tags: [], to: [142], moves: ['south'] },
  ],
}

const ALL = [...TOOL_IDS]

console.log('-- the registry is a closed set --')
{
  ok('room_by_id exists', TOOL_IDS.includes('room_by_id'), TOOL_IDS.join(', '))
  ok('untrusted() marks text as data', untrusted('x').untrusted === true && untrusted('x').text === 'x')
}

console.log('\n-- an allowed call returns a result and one trace entry --')
{
  const trace = []
  const r = callTool('room_by_id', { zone: '1', id: 142 }, ALL, trace, { zone: ZONE, now: 5 })
  ok('the call succeeded', r.ok === true, r.ok ? '' : r.reason)
  ok('the room came back', r.ok && r.value.id === 142)
  ok('exits are move/destination pairs', r.ok && r.value.exits[0].move === 'north' && r.value.exits[0].to === 143)
  ok('the title is labelled untrusted', r.ok && r.value.title.untrusted === true)
  ok('and so are the tags', r.ok && r.value.tags[0].untrusted === true && r.value.tags[0].text === 'Town Green')
  ok('nothing was truncated', r.ok && r.truncated === false)
  ok('exactly one trace entry', trace.length === 1, `${trace.length}`)
  ok('the trace names the tool', trace[0].tool === 'room_by_id')
  ok('the trace carries a byte count', trace[0].bytes > 0, `${trace[0].bytes}`)
  ok('the trace carries the injected time', trace[0].at === 5)
  ok(
    'the trace summarises arguments rather than copying them',
    trace[0].argsSummary === 'zone=str(1) id=142',
    trace[0].argsSummary
  )
}

console.log('\n-- a disallowed tool is refused by name, and never executed --')
{
  const trace = []
  const r = callTool('room_by_id', { zone: '1', id: 142 }, ['lore_for'], trace, { zone: ZONE })
  ok('refused', r.ok === false)
  ok('the refusal names the tool', r.ok === false && r.reason.includes('room_by_id'), r.ok ? '' : r.reason)
  ok('the refusal says it was the allowlist', r.ok === false && r.reason.includes('allowedTools'))
  ok('the attempt is still traced', trace.length === 1 && trace[0].ok === false)
}

console.log('\n-- an unknown tool is refused, distinctly from a disallowed one --')
{
  const trace = []
  const r = callTool('map_write', {}, ['map_write'], trace, {})
  ok('refused', r.ok === false)
  ok('the refusal says it does not exist', r.ok === false && r.reason.includes('does not exist'), r.ok ? '' : r.reason)
  ok('and it is traced', trace.length === 1)
}

console.log('\n-- nothing throws, whatever it is given --')
{
  let threw = false
  const trace = []
  try {
    callTool('room_by_id', { zone: 5, id: 'everything' }, ALL, trace, { zone: ZONE })
    callTool('', {}, ALL, trace, {})
    callTool('room_by_id', {}, ALL, trace, {})
  } catch {
    threw = true
  }
  ok('no call threw', threw === false)
  ok('every one was traced', trace.length === 3, `${trace.length}`)
  ok('every one was a refusal', trace.every((t) => t.ok === false))
}

console.log('\n-- arguments are validated before execution, and the refusal names the field --')
{
  const trace = []
  const bad = callTool('room_by_id', { zone: '1', id: 'north' }, ALL, trace, { zone: ZONE })
  ok('a non-integer id is refused', bad.ok === false && bad.reason.includes('id must be an integer'), bad.ok ? '' : bad.reason)
  const noZone = callTool('room_by_id', { id: 142 }, ALL, trace, { zone: ZONE })
  ok('a missing zone is refused', noZone.ok === false && noZone.reason.includes('zone must be'), noZone.ok ? '' : noZone.reason)
}

console.log('\n-- scope: a tool answers about the zone it was given and nothing else --')
{
  const trace = []
  const other = callTool('room_by_id', { zone: '2', id: 142 }, ALL, trace, { zone: ZONE })
  ok('a room in another zone is null, not this zone’s room', other.ok === true && other.value === null)
  const absent = callTool('room_by_id', { zone: '1', id: 999999 }, ALL, trace, { zone: ZONE })
  ok('an unknown room is null', absent.ok === true && absent.value === null)
  const noContext = callTool('room_by_id', { zone: '1', id: 142 }, ALL, trace, {})
  ok('no zone loaded is null rather than an invented room', noContext.ok === true && noContext.value === null)
}

console.log('\n-- lore_for answers from the bestiary, and says when the match was weak --')
{
  const trace = []
  const exact = callTool('lore_for', { name: "an adan'f blood warrior", noun: 'warrior' }, ALL, trace, {})
  ok('a known creature returns lore', exact.ok === true && exact.value !== null, JSON.stringify(exact).slice(0, 90))
  ok('the level came through', exact.ok && exact.value?.lore?.level === 54, exact.ok ? JSON.stringify(exact.value).slice(0, 60) : '')
  ok('an exact name match is not flagged approximate', exact.ok && exact.value?.approximate === false)

  // 773 creatures share 408 nouns, so a noun-only hit is weaker evidence and
  // must say so - a card that hid the difference would let a model state a
  // level it cannot support.
  const weak = callTool('lore_for', { name: 'a nameless thing nobody wrote down', noun: 'mage' }, ALL, trace, {})
  ok('a noun-only match still returns lore', weak.ok === true && weak.value !== null)
  ok('and is flagged approximate', weak.ok && weak.value?.approximate === true)
  ok('a noun-only entry carries no level', weak.ok && weak.value?.lore?.level === undefined, weak.ok ? JSON.stringify(weak.value) : '')

  const unknown = callTool('lore_for', { name: 'a thing', noun: 'nothingatallliketh' }, ALL, trace, {})
  ok('an unknown creature is null, not an invented card', unknown.ok === true && unknown.value === null)

  const bad = callTool('lore_for', { name: '', noun: 'mage' }, ALL, trace, {})
  ok('an empty name is refused before execution', bad.ok === false && bad.reason.includes('name must be'), bad.ok ? '' : bad.reason)
  ok('every one of those is traced', trace.length === 4, String(trace.length))
}

console.log('\n-- recent_events returns sequences and kinds, and never a word of game text --')
{
  // A journal whose payloads carry text on purpose: this is the population
  // where the wrong answer is available. A tool that dropped text only because
  // its fixture had none would pass a test that proves nothing.
  const events = [
    { seq: 10, at: 100, kind: 'line', payload: { text: 'You see a guard.', stream: '', privacy: 'public-game' } },
    { seq: 11, at: 101, kind: 'line', payload: { text: 'Someone whispers, "meet me"', stream: 'whispers', privacy: 'private-comms' } },
    { seq: 12, at: 102, kind: 'line', payload: { text: 'The guard nods.', stream: '', privacy: 'public-game' } },
  ]
  const journal = {
    acknowledged: () => 12,
    readFrom: (cursor, limit) => ({ events: events.filter((e) => e.seq > cursor).slice(0, limit ?? events.length) }),
  }

  const trace = []
  const r = callTool('recent_events', { n: 3 }, ALL, trace, { journal })
  ok('the call succeeded', r.ok === true, r.ok ? '' : r.reason)
  ok('the whisper is not in the result at all', r.ok && r.value.length === 2, r.ok ? String(r.value.length) : '')
  ok('sequences are present', r.ok && r.value[0].seq === 10)
  ok('kinds are present', r.ok && r.value[0].kind === 'line')
  ok(
    'not one returned object has a text key',
    r.ok && r.value.every((e) => !('text' in e)),
    r.ok ? JSON.stringify(r.value[1]) : ''
  )
  ok(
    'and no returned value contains the whispered words anywhere',
    r.ok && !JSON.stringify(r.value).includes('meet me'),
    r.ok ? JSON.stringify(r.value).slice(0, 80) : ''
  )
  ok('what survives is public game text', r.ok && r.value.every((e) => e.privacy === 'public-game'), r.ok ? r.value.map((e) => e.privacy).join(',') : '')
  ok('and its sequence is gone too, not only its words', r.ok && r.value.every((e) => e.seq !== 11), r.ok ? r.value.map((e) => e.seq).join(',') : '')
  ok('an unclassified payload reports null rather than a guess',
    callTool('recent_events', { n: 1 }, ALL, [], {
      journal: { acknowledged: () => 1, readFrom: () => ({ events: [{ seq: 1, at: 0, kind: 'line', payload: { text: 'x' } }] }) },
    }).value[0].privacy === null)

  // Opted in per source, the whisper comes back - which is what proves the
  // exclusion above is a filter doing work rather than a tool that returns
  // two of anything.
  const optedIn = callTool('recent_events', { n: 3 }, ALL, trace, { journal, privacyOptIn: ['whispers'] })
  ok('a per-source opt-in lifts it', optedIn.ok && optedIn.value.length === 3, optedIn.ok ? String(optedIn.value.length) : '')
  ok('and it is labelled private-comms', optedIn.ok && optedIn.value.some((e) => e.privacy === 'private-comms'))
  ok('opting a different source in does not lift it',
    callTool('recent_events', { n: 3 }, ALL, [], { journal, privacyOptIn: ['thoughts'] }).value.length === 2)
  ok('and even opted in it carries no text', optedIn.ok && optedIn.value.every((e) => !('text' in e)))

  const window = callTool('recent_events', { n: 2 }, ALL, trace, { journal })
  ok('n bounds the window', window.ok && window.value.length <= 2, window.ok ? String(window.value.length) : '')

  const bad = callTool('recent_events', { n: 0 }, ALL, trace, { journal })
  ok('n of zero is refused', bad.ok === false && bad.reason.includes('positive integer'), bad.ok ? '' : bad.reason)
  const huge = callTool('recent_events', { n: 5000 }, ALL, trace, { journal })
  ok('an unbounded n is refused', huge.ok === false && huge.reason.includes('200'), huge.ok ? '' : huge.reason)
  const none = callTool('recent_events', { n: 3 }, ALL, trace, {})
  ok('no journal is null rather than an empty answer', none.ok === true && none.value === null)
}

console.log('\n-- an over-size result is flagged, never silently cut --')
{
  // A megabyte of rooms. The ceiling is 4 KB, so this must come back marked.
  const big = {
    ok: true,
    zone: '1',
    rooms: [
      {
        id: 1,
        uid: null,
        title: 'x',
        x: 0,
        y: 0,
        z: 0,
        tags: Array.from({ length: 40000 }, (_, i) => `tag ${i} padded out to make this large`),
        to: [],
        moves: [],
      },
    ],
  }
  const raw = new TextEncoder().encode(JSON.stringify(big.rooms[0].tags)).length
  ok('the fixture really is over a megabyte', raw > 1_000_000, `${raw} bytes`)

  const trace = []
  const r = callTool('room_by_id', { zone: '1', id: 1 }, ALL, trace, { zone: big })
  // An object cannot be honestly shortened, so this one is refused outright -
  // section 16's "fails rather than truncating" for the shape where a prefix
  // would be a wrong answer rather than a partial one.
  ok('it did not come back as if it fitted', !(r.ok === true && r.truncated === false), JSON.stringify(r).slice(0, 80))
  ok('the refusal names the ceiling', r.ok === false && r.reason.includes('4096'), r.ok ? '' : r.reason)
  ok('and the attempt is traced', trace.length === 1)
}

console.log('\n-- an array result is shortened to fit, and says so --')
{
  // The ceiling's other half, tested directly because no tool here returns an
  // array yet: a branch that cannot be executed on purpose cannot be proved.
  const big = Array.from({ length: 5000 }, (_, i) => ({ seq: i, kind: 'line' }))
  const rawBytes = new TextEncoder().encode(JSON.stringify(big)).length
  ok('the fixture is over the ceiling', rawBytes > 4096, `${rawBytes} bytes`)

  const capped = capResult(big, 4096)
  ok('it came back ok rather than refused', capped.ok === true)
  ok('flagged as truncated', capped.ok && capped.truncated === true)
  ok('and it actually fits', capped.ok && capped.bytes <= 4096, capped.ok ? `${capped.bytes}` : '')
  ok('what survived is a prefix of the original', capped.ok && capped.value[0].seq === 0)
  ok('and it is shorter', capped.ok && capped.value.length < big.length, capped.ok ? `${capped.value.length}` : '')

  const fits = capResult([1, 2, 3], 4096)
  ok('a result under the ceiling is not flagged', fits.ok === true && fits.truncated === false)

  const object = capResult({ padding: 'x'.repeat(9000) }, 4096)
  ok('an over-size object is refused, not cut', object.ok === false)
}

console.log('\n-- the trace has one entry per call, in order --')
{
  const trace = []
  callTool('room_by_id', { zone: '1', id: 142 }, ALL, trace, { zone: ZONE, now: 1 })
  callTool('room_by_id', { zone: '1', id: 143 }, ALL, trace, { zone: ZONE, now: 2 })
  callTool('nope', {}, ALL, trace, { now: 3 })
  ok('three calls, three entries', trace.length === 3, `${trace.length}`)
  ok('in call order', trace.map((t) => t.at).join(',') === '1,2,3')
  ok('two succeeded, one refused', trace.filter((t) => t.ok).length === 2)
  ok(
    'no trace entry carries a result payload',
    trace.every((t) => Object.keys(t).sort().join(',') === 'argsSummary,at,bytes,ok,tool'),
    Object.keys(trace[0]).join(',')
  )
}

console.log('')
const total = pass + fail
const MIN_EXPECTED = 62
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
