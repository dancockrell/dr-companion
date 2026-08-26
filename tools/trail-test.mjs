/**
 * The trail, tested against the runs it exists to tell apart.
 *
 * The interesting cases are not "does it record a room". They are the three
 * situations a player actually looks at the map to distinguish: a working
 * circuit, a wedged script, and a straight walk.
 */
import { emptyTrail, visit, recency, segments, describeTrail } from '../src/lib/trail.ts'

let failed = 0
const ok = (name, got, want) => {
  const pass = JSON.stringify(got) === JSON.stringify(want)
  if (!pass) failed++
  console.log(`${pass ? 'OK  ' : 'FAIL'} ${name.padEnd(46)} ${pass ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

const walk = (ids) => ids.reduce((t, id) => visit(t, id), emptyTrail())

console.log('-- standing still must not erase the route that got you there --')
{
  const t = walk([1, 2, 3, 3, 3, 3, 3, 3])
  ok('idling collapses to one entry', t.recent, [1, 2, 3])
  ok('and does not inflate the tally', t.visits[3], 1)
}

console.log('-- a genuine return is counted, an idle repeat is not --')
{
  const t = walk([1, 2, 1, 2, 1])
  ok('trail keeps every real move', t.recent.length, 5)
  ok('room 1 visited three times', t.visits[1], 3)
}

console.log('-- the three runs a player needs to tell apart --')
{
  ok('a wedged script', describeTrail(walk([7, 7, 7, 7])), 'held in one room')
  ok('a straight walk', describeTrail(walk([1, 2, 3, 4, 5])), '5 rooms in the last 5 moves')
  const circuit = []
  for (let i = 0; i < 6; i++) circuit.push(10, 11, 12, 13)
  ok('a hunting circuit', describeTrail(walk(circuit)), 'circling 4 rooms, most time in room 10')
  ok('nothing yet', describeTrail(emptyTrail()), 'no movement yet')
}

console.log('-- recency: where you are is brightest, and a revisit refreshes --')
{
  const r = recency(walk([1, 2, 3]))
  ok('current room is 1', r.get(3), 1)
  ok('oldest is 0', r.get(1), 0)
  const back = recency(walk([1, 2, 3, 1]))
  ok('revisited room takes its freshest value', back.get(1), 1)
}

console.log('-- segments are pairs, so an unwalkable jump can be dropped --')
{
  const s = segments(walk([1, 2, 3]))
  ok('two segments from three rooms', s.length, 2)
  ok('oldest first', [s[0].from, s[0].to], [1, 2])
  ok('newest is freshest', s[1].fresh, 1)
  ok('a single room has no segments', segments(walk([1])).length, 0)
}

console.log('-- bounds hold on a long run --')
{
  const long = []
  for (let i = 0; i < 5000; i++) long.push(i)
  const t = walk(long)
  ok('trail is capped', t.recent.length, 40)
  ok('tally is capped', Object.keys(t.visits).length, 400)
}

console.log('-- the tally keeps the places you keep returning to --')
{
  // A training loop inside a long walk: the loop rooms must survive the trim
  // that a plain oldest-first rule would have thrown away first.
  let t = emptyTrail()
  for (let i = 0; i < 30; i++) t = visit(t, i % 2 === 0 ? 5000 : 5001)
  for (let i = 0; i < 1000; i++) t = visit(t, i)
  ok('the loop rooms survived', [t.visits[5000], t.visits[5001]], [15, 15])
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
