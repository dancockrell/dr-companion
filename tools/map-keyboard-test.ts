// Keyboard navigation of the map: which room is focused first, where each
// arrow key goes, and what a screen reader is told about the room it lands on.
//
// This was eight bare `assert.equal` calls and one summary line, and that
// summary is why the suite could never be registered: tools/run-tests.mjs
// counts the OK and FAIL lines a suite prints, and one that prints neither is
// NOT RUN with "it asserted nothing" - correctly, because a run that died on
// its first assertion and a run that passed all eight are indistinguishable
// from a line only the passing one ever reaches. Each check names itself now,
// and the process still exits non-zero the moment one of them is false.
import {
  initialMapRoomId,
  mapRoomAccessibleName,
  nextMapRoomId,
} from '../src/lib/mapKeyboard.ts'

let pass = 0
let fail = 0
const ok = (what: string, cond: boolean) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${what}`)
  if (cond) pass++
  else fail++
}

const rooms = [
  { id: 1, x: 0, y: 0, title: 'Center', to: [2, 3] },
  { id: 2, x: 10, y: 1, title: 'East gate', gateway: { zone: 'next', name: 'Next zone' } },
  { id: 3, x: 0, y: 10, title: 'South' },
  { id: 4, x: -20, y: 0, title: 'West' },
] as any

ok('focus starts on the current room when this map contains it', initialMapRoomId(rooms, 3) === 3)
ok('focus falls back to the first room when the current one is elsewhere', initialMapRoomId(rooms, 99) === 1)
ok('right moves east', nextMapRoomId(rooms, 1, 'right') === 2)
ok('down moves south', nextMapRoomId(rooms, 1, 'down') === 3)
ok('left moves west', nextMapRoomId(rooms, 1, 'left') === 4)
ok('an edge room stays put rather than wrapping round the map', nextMapRoomId(rooms, 4, 'left') === 4)
ok('a gateway room announces its title, its destination and its pin', /East gate.*Open Next zone.*pin/.test(mapRoomAccessibleName(rooms[1], true)))
ok('and says nothing about a pin when the room has none', !/pin/.test(mapRoomAccessibleName(rooms[1], false)))

// The denominator, asserted: a truncated run must not read like a clean one.
const total = pass + fail
if (total < 8) {
  console.error(`FAILED: only ${total} checks ran, expected 8`)
  process.exit(1)
}
console.log(fail === 0 ? `\nmap keyboard: all ${total} checks passed` : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
