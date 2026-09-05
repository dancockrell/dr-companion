import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
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

/**
 * The population, computed rather than typed.
 *
 * This list used to be ten hand-written paths, and it had drifted: it named
 * `CombatRadar.tsx`, which has a drag-scrolled column, and missed
 * `BattleColumn.tsx`, which has the same one. Both carried `touch-none`, so
 * both were unscrollable by finger, and only one of them was being asked.
 *
 * A hand-typed list answers "are the files I remembered correct", which is a
 * question nobody has. Every component that uses the shared scroll contract or
 * drag-scrolls is the population, and it is one walk away.
 */
function componentFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...componentFiles(path))
    else if (path.endsWith('.tsx')) out.push(path.split('\\').join('/'))
  }
  return out
}

const files = componentFiles('src/components').filter((f) => {
  const source = readFileSync(f, 'utf8')
  return source.includes('scrollableRegionProps') || source.includes('useDragScroll')
})

// A floor, because a walk that silently found nothing would print no failures
// and read exactly like a codebase with no scrollable regions in it.
const MIN_REGIONS = 8
if (files.length < MIN_REGIONS) {
  console.error(`FAILED: found only ${files.length} scrollable regions (floor ${MIN_REGIONS}); the walk or the filter is broken`)
  process.exit(1)
}
console.log(`\nscrollable regions found by walking src/components: ${files.length}`)

/**
 * Comments are not classes.
 *
 * These checks match text, so a comment explaining *why* a file no longer sets
 * `touch-none` reads to them exactly like the file still setting it - which is
 * what happened the moment the fix was written down next to the fix. A check
 * that fails on its own documentation is measuring the wrong thing, and the
 * lesson people take from it is to stop writing the documentation.
 *
 * Only whole-line `//` comments are stripped. A `//` inside a string is left
 * alone, so a URL in a className cannot silently eat the rest of the line.
 */
function withoutComments(source) {
  return source
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n')
}

/**
 * What these two checks used to say, and why they now say something else.
 *
 * They were "no `no-scrollbar`" and "no `touch-none`", flatly, for a typed
 * list of files. That rule was never run - the suite was written and never
 * registered - and when it finally ran it contradicted `battlespace-test.mjs`,
 * which is registered, green, and asserts the exact opposite for the battle
 * workspace: `no-scrollbar` *and* `overflow-y-auto` *and* drag handlers,
 * deliberately. `CombatRadar` says the same thing in prose: the roster sits
 * over a picture, "where a permanently-visible scrollbar track reads as chrome
 * on top of the room".
 *
 * Two tests answering one question is the drift this repo forbids, and the
 * dormant one does not get to overrule the maintained one on the strength of
 * having never run. But it is not worthless either, because underneath the
 * mechanism there is a property both agree on:
 *
 *   **a region that scrolls must be operable.**
 *
 * A visible scrollbar is one way. Drag-to-scroll is another. Hiding the
 * scrollbar is fine when a drag handler replaces it; `touch-action: none` is
 * fine when a drag handler is what the finger is meant to use. What is never
 * fine is a region that scrolls, shows nothing, and answers no gesture - and
 * that is what these now check.
 *
 * The mechanism-level assertions stay where they belong: `battlespace-test.mjs`
 * owns the battle workspace's specific look, because that is a design decision
 * about one component rather than a rule about all of them.
 */
for (const file of files) {
  const source = withoutComments(readFileSync(file, 'utf8'))
  const dragScrolls = source.includes('useDragScroll') || source.includes('onPointerMove')
  const hidesScrollbar = source.includes('no-scrollbar')
  const takesTouch = source.includes('touch-none') || source.includes("touchAction: 'none'")

  ok(source.includes('scrollableRegionProps'), `${file} uses the shared keyboard scrolling contract`)
  ok(
    !hidesScrollbar || dragScrolls,
    `${file} is operable: it shows a scrollbar, or hides it and drags instead`
  )
  ok(
    !takesTouch || dragScrolls,
    `${file} answers a finger: it leaves touch scrolling alone, or takes it and drags instead`
  )
}

if (checks < 38) {
  console.log(`FAIL only ${checks} checks ran; expected at least 38`)
  process.exit(1)
}
console.log(`\n${checks} checks, ${failures} failed`)
process.exit(failures ? 1 : 0)
