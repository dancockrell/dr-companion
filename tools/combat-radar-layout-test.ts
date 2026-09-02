import { fanRadarSlots } from '../src/lib/combatRadarLayout.ts'

/**
 * Was bare `assert.deepEqual`/`assert.equal` calls with no OK/FAIL lines.
 * `run-tests.mjs` counts checks by grepping `^OK\b`/`^FAIL\b` from a suite's
 * own output (see its `countChecks`) - a suite that never prints either is
 * indistinguishable from one that asserted nothing, so this always reported
 * NOT RUN there regardless of whether the assertions actually passed. Found
 * when this suite was wired into the main `test` chain for the first time
 * and the summary line read "no failures, but 1 not checked" despite every
 * assertion below being true. Converted to the same counted `ok()` pattern
 * every other suite in `tools/` already uses.
 */
let checked = 0
let fails = 0
const ok = (label: string, cond: boolean, detail = '') => {
  checked++
  if (!cond) fails++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label.padEnd(58)}${detail}`)
}
const eq = (label: string, actual: unknown, expected: unknown) => {
  const cond = JSON.stringify(actual) === JSON.stringify(expected)
  ok(label, cond, cond ? '' : `got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`)
}

const sameDirection = fanRadarSlots([
  { key: 'melee', angleDeg: 0, radiusPct: 15 },
  { key: 'pole', angleDeg: 0, radiusPct: 24 },
  { key: 'missile', angleDeg: 0, radiusPct: 36 },
], 50, 50, 8)

eq('three slots stacked on the same angle: melee', sameDirection.get('melee'), { x: 50, y: 35 })
eq('three slots stacked on the same angle: pole', sameDirection.get('pole'), { x: 50, y: 26 })
eq('three slots stacked on the same angle: missile', sameDirection.get('missile'), { x: 50, y: 14 })

const crowded = [
  { key: 'c', angleDeg: 0, radiusPct: 15 },
  { key: 'a', angleDeg: 0, radiusPct: 15 },
  { key: 'b', angleDeg: 0, radiusPct: 15 },
]
const first = fanRadarSlots(crowded, 50, 50, 8)
const reordered = fanRadarSlots([...crowded].reverse(), 50, 50, 8)

eq('layout is stable when bridge ordering changes', [...first], [...reordered])
eq('crowded fan: a', first.get('a'), { x: 42, y: 35 })
eq('crowded fan: b', first.get('b'), { x: 50, y: 35 })
eq('crowded fan: c', first.get('c'), { x: 58, y: 35 })

const right = fanRadarSlots([
  { key: 'a', angleDeg: 90, radiusPct: 15 },
  { key: 'b', angleDeg: 90, radiusPct: 15 },
], 50, 50, 8)
ok('two slots fanned at 90°: a.x', right.get('a')?.x === 65, `${right.get('a')?.x}`)
ok('two slots fanned at 90°: b.x', right.get('b')?.x === 65, `${right.get('b')?.x}`)
ok('two slots fanned at 90°: a.y', right.get('a')?.y === 46, `${right.get('a')?.y}`)
ok('two slots fanned at 90°: b.y', right.get('b')?.y === 54, `${right.get('b')?.y}`)

const ran = checked
ok('enough was checked for a pass to mean something', ran >= 10, `${ran} assertions`)

console.log(fails ? `\n${fails} failed` : '\nall combat radar layout checks passed')
process.exit(fails ? 1 : 0)
