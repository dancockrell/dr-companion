import assert from 'node:assert/strict'
import { initialMapRoomId, mapRoomAccessibleName, nextMapRoomId } from '../src/lib/mapKeyboard.ts'

const rooms = [
  { id: 1, x: 0, y: 0, title: 'Center', to: [2, 3] },
  { id: 2, x: 10, y: 1, title: 'East gate', gateway: { zone: 'next', name: 'Next zone' } },
  { id: 3, x: 0, y: 10, title: 'South' },
  { id: 4, x: -20, y: 0, title: 'West' },
] as any
assert.equal(initialMapRoomId(rooms, 3), 3)
assert.equal(initialMapRoomId(rooms, 99), 1)
assert.equal(nextMapRoomId(rooms, 1, 'right'), 2)
assert.equal(nextMapRoomId(rooms, 1, 'down'), 3)
assert.equal(nextMapRoomId(rooms, 1, 'left'), 4)
assert.equal(nextMapRoomId(rooms, 4, 'left'), 4)
assert.match(mapRoomAccessibleName(rooms[1], true), /East gate.*Open Next zone.*pin/)
assert.doesNotMatch(mapRoomAccessibleName(rooms[1], false), /pin/)
console.log('map keyboard: 8 checks passed')
