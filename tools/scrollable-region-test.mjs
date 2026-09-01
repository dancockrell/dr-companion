import { readFileSync } from 'node:fs'
import { scrollableRegionProps } from '../src/lib/scrollableRegion.ts'

let checks = 0
let failures = 0
function ok(condition, label) {
  checks++
  if (!condition) failures++
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`)
}

function exercise(orientation, key) {
  const calls = []
  const el = {
    clientHeight: 100,
    clientWidth: 200,
    scrollHeight: 900,
    scrollWidth: 1200,
    scrollBy: (value) => calls.push(['by', value]),
    scrollTo: (value) => calls.push(['to', value]),
  }
  let prevented = false
  const props = scrollableRegionProps('Test region', orientation)
  props.onKeyDown({ key, target: el, currentTarget: el, preventDefault: () => { prevented = true } })
  return { calls, prevented, props }
}

ok(exercise('vertical', 'PageDown').calls[0]?.[1].top === 80, 'vertical Page Down moves by a viewport-relative page')
ok(exercise('horizontal', 'ArrowRight').calls[0]?.[1].left === 40, 'horizontal arrows move the horizontal axis')
ok(exercise('horizontal', 'PageDown').calls[0]?.[1].left === 160, 'horizontal Page Down moves by a viewport-relative page')
const both = exercise('both', 'End')
ok(both.calls[0]?.[1].top === 900 && both.calls[0]?.[1].left === 1200, 'two-axis End reaches both extents')
ok(exercise('vertical', 'Home').calls[0]?.[0] === 'to', 'Home returns a region to its origin')
ok(exercise('vertical', 'ArrowRight').calls.length === 0, 'an irrelevant axis is not stolen')

{
  const props = scrollableRegionProps('Child safety', 'both')
  const parent = { scrollBy: () => { throw new Error('child key was stolen') } }
  let prevented = false
  props.onKeyDown({ key: 'ArrowDown', target: {}, currentTarget: parent, preventDefault: () => { prevented = true } })
  ok(!prevented, 'keys from child controls are left to the child')
  ok(props.tabIndex === 0 && props.role === 'region' && props['aria-label'] === 'Child safety', 'the region is focusable and contextually named')
}

const files = [
  'src/components/dashboard/TaskFlowPanel.tsx',
  'src/components/shared/ArmorManager.tsx',
  'src/components/room/BattleActionBar.tsx',
  'src/components/room/ClassicRoomText.tsx',
  'src/components/shared/CombatRadar.tsx',
  'src/components/room/FloorItems.tsx',
  'src/components/shared/ExperienceStrip.tsx',
  'src/components/shared/MapToolRail.tsx',
  'src/components/shared/Portrait.tsx',
  'src/components/shared/InventoryPanel.tsx',
]
for (const file of files) {
  const source = readFileSync(file, 'utf8')
  ok(source.includes('scrollableRegionProps'), `${file} uses the shared keyboard scrolling contract`)
  ok(!source.includes('no-scrollbar'), `${file} retains a visible overflow affordance`)
  ok(!source.includes('touch-none') && !source.includes("touchAction: 'none'"), `${file} retains native touch scrolling`)
}

if (checks < 38) {
  console.log(`FAIL only ${checks} checks ran; expected at least 38`)
  process.exit(1)
}
console.log(`\n${checks} checks, ${failures} failed`)
process.exit(failures ? 1 : 0)
