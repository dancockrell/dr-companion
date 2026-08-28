/**
 * Absent, empty and populated must all read differently — the property this
 * exists to protect, since a stream field that hasn't arrived yet and one
 * that arrived and said "nobody" look identical unless the code checks which
 * one it has, not just whether the array is empty.
 */
import { describeRoomPlayers, describeRoomItems } from '../src/lib/roomOccupants.ts'

let failed = 0
const ok = (name, got, want) => {
  const pass = JSON.stringify(got) === JSON.stringify(want)
  if (!pass) failed++
  console.log(
    `${pass ? 'OK  ' : 'FAIL'} ${name.padEnd(55)}${pass ? '' : ` got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`
  )
}

const sourced = (value) => ({ value, from: 'stream', at: 0 })

console.log('-- absent: the game has not sent this component yet --')
{
  ok('no players field renders nothing', describeRoomPlayers(undefined), null)
  ok('no items field renders nothing', describeRoomItems(undefined), null)
}

console.log('\n-- empty: the game said so explicitly, and that is worth showing --')
{
  ok('an empty room says nobody', describeRoomPlayers(sourced([])), 'Also here: nobody else.')
  ok('a bare floor says nothing', describeRoomItems(sourced([])), 'On the floor: nothing.')
}

console.log('\n-- populated --')
{
  ok(
    'names players by their display name',
    describeRoomPlayers(sourced([
      { noun: 'Bard', name: 'a grizzled Bard', status: null },
      { noun: 'Fren', name: 'Fren', status: 'kneeling' },
    ])),
    'Also here: a grizzled Bard, Fren'
  )
  ok(
    'names items by their display name',
    describeRoomItems(sourced([
      { noun: 'dagger', name: 'a rusty dagger' },
      { noun: 'kronars', name: 'some copper kronars' },
    ])),
    'On the floor: a rusty dagger, some copper kronars'
  )
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
