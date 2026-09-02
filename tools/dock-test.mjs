/**
 * Regions, boundaries and folding.
 *
 * The behaviour that has to hold: shrinking never squeezes panels into
 * unreadability, it folds them into a deck; widening gives them back; and a
 * boundary drag moves space between two neighbours without changing the total
 * or triggering a fold nobody asked for.
 *
 * Oscillation is tested explicitly. Fold and unfold using the same threshold
 * would flip back and forth on a one-pixel resize, which is exactly the
 * jitter this model exists to remove.
 */
import { readFileSync } from 'node:fs'

const m = await import('../src/lib/dock.ts')

let fails = 0
const ok = (label, cond, detail = '') => {
  if (!cond) fails++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label.padEnd(52)} ${detail}`)
}
const shape = (d) => d.regions.map((r) => r.panels.join('+')).join(' | ')

console.log('-- wide enough: everything keeps its own region --')
let dock = m.splitEach(['map', 'room', 'actions'])
let wide = m.foldCramped(dock, 1200)
ok('three regions at 1200px', wide.regions.length === 3, shape(wide))

console.log('\n-- too narrow: panels fold into a deck rather than squeezing --')
const narrow = m.foldCramped(dock, 500)
// 500px carries two regions of 250, both clear of the 220 minimum. Folding to
// one would be over-collapsing, which the greedy version did.
ok('folds to what the space carries', narrow.regions.length === 2, shape(narrow))
const panelsKept = narrow.regions.flatMap((r) => r.panels).sort()
ok('no panel is lost in the fold', panelsKept.join(',') === 'actions,map,room', panelsKept.join(','))
ok('every region now clears the minimum', m.measure(narrow, 500).every((s) => s >= m.MIN_REGION), JSON.stringify(m.measure(narrow, 500).map(Math.round)))

console.log('\n-- something is always on screen --')
const tiny = m.foldCramped(dock, 40)
ok('one region survives', tiny.regions.length === 1, shape(tiny))
ok('carrying all three panels', tiny.regions[0].panels.length === 3, '')

console.log('\n-- widening gives a panel back --')
const back = m.unfoldIfRoom(tiny, 1400)
ok('a region splits off again', back.regions.length > 1, shape(back))

console.log('\n-- and it does not oscillate on a one pixel resize --')
let d2 = m.foldCramped(dock, 660)
const before = d2.regions.length
for (let i = 0; i < 8; i++) {
  d2 = m.unfoldIfRoom(m.foldCramped(d2, 660), 660)
}
ok('stable across repeated passes', d2.regions.length === before, `${before} -> ${d2.regions.length}`)

console.log('\n-- a boundary moves space between neighbours, not into thin air --')
const three = m.splitEach(['a', 'b', 'c'])
const moved = m.moveBoundary(three, 0, 120, 1200)
const s0 = m.measure(three, 1200)
const s1 = m.measure(moved, 1200)
ok('first region grew', s1[0] > s0[0], `${Math.round(s0[0])} -> ${Math.round(s1[0])}`)
ok('second shrank by the same', Math.abs((s0[1] - s1[1]) - (s1[0] - s0[0])) < 0.01, '')
ok('total unchanged', Math.abs(s1.reduce((a, b) => a + b, 0) - 1200) < 0.01, '')

console.log('\n-- a boundary drag never forces a fold --')
const shoved = m.moveBoundary(three, 0, 99999, 1200)
ok('neighbour keeps the minimum', m.measure(shoved, 1200)[1] >= m.MIN_REGION - 0.01, JSON.stringify(m.measure(shoved, 1200).map(Math.round)))

console.log('\n-- dock boundaries expose the shared keyboard separator contract --')
const dockView = readFileSync('src/components/dashboard/DockView.tsx', 'utf8')
ok('boundaries are keyboard-focusable separators', /role="separator"/.test(dockView) && /tabIndex=\{0\}/.test(dockView), '')
ok('boundaries publish orientation, range, and current value', /aria-orientation/.test(dockView) && /aria-valuemin/.test(dockView) && /aria-valuemax/.test(dockView) && /aria-valuenow/.test(dockView), '')
ok('arrows and limits use the same clamped moveBoundary path', /'ArrowLeft', 'ArrowRight'/.test(dockView) && /'ArrowUp', 'ArrowDown'/.test(dockView) && /'Home', 'End'/.test(dockView) && /onChange\(moveBoundary/.test(dockView), '')
ok('vertical pointer boundaries read clientY', /horizontal \? e\.clientX : e\.clientY/.test(dockView), '')

console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
