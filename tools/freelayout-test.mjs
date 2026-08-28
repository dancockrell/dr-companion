/**
 * Free placement geometry.
 *
 * The two rules are the whole feature: a panel never leaves the window, and
 * two panels never occupy the same pixels. Both are asserted directly, plus
 * the crowded case, because a resolver that cannot converge would hang a drag
 * handler rather than merely misplace a box.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const dir = mkdtempSync(join(tmpdir(), 'free-'))
const out = join(dir, 'freeLayout.js')
writeFileSync(
  out,
  ts.transpileModule(readFileSync('src/lib/freeLayout.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
)
const m = await import(pathToFileURL(out).href)

let fails = 0
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label.padEnd(50)} ${JSON.stringify(got)}`)
}
const ok = (label, cond, detail = '') => {
  if (!cond) fails++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label.padEnd(50)} ${detail}`)
}

const BOUNDS = { w: 1000, h: 800 }

console.log('-- nothing leaves the window --')
check('dragged past the right edge', m.clampToBounds({ x: 9999, y: 10, w: 200, h: 100 }, BOUNDS), { w: 200, h: 100, x: 800, y: 10 })
check('dragged above the top', m.clampToBounds({ x: 10, y: -500, w: 200, h: 100 }, BOUNDS), { w: 200, h: 100, x: 10, y: 0 })
check('wider than the canvas', m.clampToBounds({ x: 0, y: 0, w: 5000, h: 100 }, BOUNDS), { w: 1000, h: 100, x: 0, y: 0 })
check('smaller than the minimum', m.clampToBounds({ x: 0, y: 0, w: 5, h: 5 }, BOUNDS), { w: m.MIN_W, h: m.MIN_H, x: 0, y: 0 })

console.log('\n-- two panels never share pixels --')
const fixed = [{ x: 300, y: 300, w: 200, h: 200 }]
const landed = m.resolveCollisions({ x: 350, y: 350, w: 200, h: 200 }, fixed, BOUNDS)
ok('dropped on top of one, pushed clear', !m.overlaps(landed, fixed[0]), JSON.stringify(landed))
ok('and stayed in bounds', landed.x >= 0 && landed.y >= 0 && landed.x + landed.w <= BOUNDS.w, '')

console.log('\n-- the nearest edge wins, so it settles rather than jumps --')
const nudged = m.resolveCollisions({ x: 300, y: 480, w: 200, h: 200 }, fixed, BOUNDS)
ok('a small overlap at the bottom moves down', nudged.y >= 500, JSON.stringify(nudged))

console.log('\n-- a crowded canvas still converges --')
const many = []
for (let x = 0; x < 1000; x += 200) for (let y = 0; y < 800; y += 200) many.push({ x, y, w: 200, h: 200 })
const t0 = Date.now()
const squeezed = m.resolveCollisions({ x: 400, y: 400, w: 200, h: 200 }, many, BOUNDS)
ok('resolver returns', typeof squeezed.x === 'number', `${Date.now() - t0}ms`)
ok('and never escapes the window', squeezed.x >= 0 && squeezed.x + squeezed.w <= BOUNDS.w && squeezed.y >= 0 && squeezed.y + squeezed.h <= BOUNDS.h, JSON.stringify(squeezed))

console.log('\n-- first placement packs rather than piling --')
const a = m.firstFreeSlot({ w: 200, h: 100 }, [], BOUNDS)
const b = m.firstFreeSlot({ w: 200, h: 100 }, [a], BOUNDS)
check('first goes to the origin', a, { x: 0, y: 0, w: 200, h: 100 })
ok('second does not overlap the first', !m.overlaps(a, b), JSON.stringify(b))

console.log('\n-- the opening arrangement fills the canvas --')
{
  // The defect this replaced: a fixed 360x220 per panel, packed in a row. On a
  // wide canvas all ten fit side by side, so entering freeform put the map and
  // the game text in small boxes across the top and left four fifths of the
  // window empty. It behaved exactly as written and was useless to look at, so
  // the property to assert is coverage, not placement.
  const WIDE = { w: 3072, h: 1549 }
  const seeds = Array.from({ length: 10 }, (_, i) => m.gridSlot(i, 10, WIDE))

  const covered = seeds.reduce((s, r) => s + r.w * r.h, 0)
  const share = covered / (WIDE.w * WIDE.h)
  ok('ten panels cover most of a wide canvas', share > 0.75, `${Math.round(share * 100)}%`)

  // More than one row, which is the specific thing that was wrong.
  const rows = new Set(seeds.map((r) => r.y)).size
  ok('and use more than a single row', rows > 1, `${rows} rows`)

  ok('nothing starts outside the canvas',
    seeds.every((r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= WIDE.w && r.y + r.h <= WIDE.h),
    JSON.stringify(seeds[seeds.length - 1]))

  // Nothing overlaps at rest. Panels may be dragged into overlap on purpose;
  // they must not arrive that way.
  let collisions = 0
  for (let i = 0; i < seeds.length; i++)
    for (let j = i + 1; j < seeds.length; j++)
      if (m.overlaps(seeds[i], seeds[j])) collisions++
  ok('the opening arrangement does not overlap itself', collisions === 0, `${collisions} overlaps`)

  // A tall narrow window is the other shape, and a column count derived from
  // the panel count alone would letterbox every cell on one of the two.
  const TALL = { w: 700, h: 1600 }
  const tall = Array.from({ length: 6 }, (_, i) => m.gridSlot(i, 6, TALL))
  ok('a tall canvas gets more rows than columns',
    new Set(tall.map((r) => r.y)).size > new Set(tall.map((r) => r.x)).size,
    `${new Set(tall.map((r) => r.x)).size} cols x ${new Set(tall.map((r) => r.y)).size} rows`)

  // One panel should take the room it has rather than a 360px box in a corner.
  const solo = m.gridSlot(0, 1, WIDE)
  ok('a single panel fills the canvas', solo.w > WIDE.w * 0.9, JSON.stringify(solo))
}

console.log('\n-- stacking order survives a drop --')
// The bug this exists for, found before it shipped: clampToBounds builds a
// fresh object, and every drop goes through it. A `z` it forgot to copy would
// have reset the stacking order on every single drag - silently, with nothing
// erroring, and looking exactly like stacking that "does not stick".
const kept = m.clampToBounds({ x: 10, y: 10, w: 200, h: 100, z: 7 }, BOUNDS)
ok('z survives a clamp that changes nothing', kept.z === 7, JSON.stringify(kept))

// The path a drop near the edge actually takes: the clamp moves the rect.
const moved = m.clampToBounds({ x: -50, y: -50, w: 200, h: 100, z: 3 }, BOUNDS)
ok('z survives a clamp that moves the rect', moved.z === 3, JSON.stringify(moved))
ok('and the move still happened', moved.x === 0 && moved.y === 0, JSON.stringify(moved))

// Absent stays absent rather than becoming a zero. "Never raised" and
// "explicitly at the bottom" are the same on screen but not in storage, and
// inventing a value here would write one into every saved layout.
const none = m.clampToBounds({ x: 0, y: 0, w: 200, h: 100 }, BOUNDS)
ok('a rect with no z does not invent one', none.z === undefined, JSON.stringify(none))

console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
