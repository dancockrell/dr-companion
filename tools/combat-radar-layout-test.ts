import assert from 'node:assert/strict'
import { fanRadarSlots } from '../src/lib/combatRadarLayout.ts'

const sameDirection = fanRadarSlots([
  { key: 'melee', angleDeg: 0, radiusPct: 15 },
  { key: 'pole', angleDeg: 0, radiusPct: 24 },
  { key: 'missile', angleDeg: 0, radiusPct: 36 },
], 50, 50, 8)

assert.deepEqual(sameDirection.get('melee'), { x: 50, y: 35 })
assert.deepEqual(sameDirection.get('pole'), { x: 50, y: 26 })
assert.deepEqual(sameDirection.get('missile'), { x: 50, y: 14 })

const crowded = [
  { key: 'c', angleDeg: 0, radiusPct: 15 },
  { key: 'a', angleDeg: 0, radiusPct: 15 },
  { key: 'b', angleDeg: 0, radiusPct: 15 },
]
const first = fanRadarSlots(crowded, 50, 50, 8)
const reordered = fanRadarSlots([...crowded].reverse(), 50, 50, 8)

assert.deepEqual([...first], [...reordered], 'layout is stable when bridge ordering changes')
assert.deepEqual(first.get('a'), { x: 42, y: 35 })
assert.deepEqual(first.get('b'), { x: 50, y: 35 })
assert.deepEqual(first.get('c'), { x: 58, y: 35 })

const right = fanRadarSlots([
  { key: 'a', angleDeg: 90, radiusPct: 15 },
  { key: 'b', angleDeg: 90, radiusPct: 15 },
], 50, 50, 8)
assert.equal(right.get('a')?.x, 65)
assert.equal(right.get('b')?.x, 65)
assert.equal(right.get('a')?.y, 46)
assert.equal(right.get('b')?.y, 54)

console.log('all combat radar layout checks passed')
