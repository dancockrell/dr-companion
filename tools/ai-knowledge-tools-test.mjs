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
