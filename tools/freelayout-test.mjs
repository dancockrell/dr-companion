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

console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
