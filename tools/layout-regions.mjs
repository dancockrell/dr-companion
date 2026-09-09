#!/usr/bin/env node
/**
 * How much of the window each region of the play screen actually gets.
 *
 * Dan, 9 September 2026, after his first live session: *"its really hard to
 * run ... the game screen needs to be quite large so that I can actually play
 * the game as mud"*, and then the arrangement: *"it's not best to put the
 * screen in the middle ... put it in the right corner and have a bottom bar of
 * icons for various functions and then on the left you have room for your text
 * heavy windows."*
 *
 * That is an argument about area, so it is settled with area rather than with
 * opinions about a screenshot. This drives the app the way a person drives it
 * (`browser.mjs`, real clicks, the demo bridge - no `?demo=` private door),
 * measures every named region's rectangle at a given window size, and prints
 * the pixel area and the share of the window each one holds.
 *
 * # Three states, never two
 *
 * A region can be **measured**, **absent** (the selector matches nothing,
 * which is a real answer: the layout does not have that region) or **hidden**
 * (it matches but has no area). Collapsing "absent" into "0 px" would make a
 * region this build never renders indistinguishable from one rendered at zero
 * size, and the whole point of a before/after table is that those two mean
 * opposite things.
 *
 * # Why the landmarks are aria-labels
 *
 * They are the names the app already gives its own regions, they are asserted
 * by other suites, and they survive restyling - a class name does not. Where a
 * landmark exists in only one of the two layouts that is reported as absent
 * rather than quietly dropped from the table, because "the action grid is
 * gone" is exactly the kind of fact this measurement is for.
 *
 * Usage:
 *   node tools/layout-regions.mjs <base-url> <label> [WxH ...]
 *
 * Writes `docs/verification/layout-2026-09-09-<label>-<WxH>.png` per size and
 * prints one table per size. Exits non-zero only if the app never reached a
 * playable screen - the numbers themselves are evidence, not a pass/fail.
 */
import { launch } from './browser.mjs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const base = process.argv[2] ?? 'http://127.0.0.1:5199/'
const label = process.argv[3] ?? 'before'
const sizes = (process.argv.slice(4).length ? process.argv.slice(4) : ['1997x935', '1180x820', '1366x768'])
  .map((s) => s.split('x').map(Number))

/**
 * The regions worth arguing about, in the order Dan's sentence names them.
 *
 * `any` holds several selectors because one physical region can be reached by
 * different names in the two layouts being compared - the left text column is
 * `Game workspace` in both, but the container that gives it its width is the
 * console row before and the text region after. Listing both is not a fork:
 * there is one row in the table either way, and the row says which selector
 * answered.
 */
export const REGIONS = [
  ['game text', ['[aria-label="Game workspace"]']],
  ['command line', ['input[aria-label="Game command"]', 'input[aria-label="Not attached"]']],
  ['room art', ['[aria-label="Battle workspace"]']],
  ['scene pane', ['[aria-label="Scene pane"]']],
  ['text region', ['[aria-label="Text"]']],
  ['icon bar', ['[aria-label="Functions"]']],
  ['board slot', ['[aria-label="Board"]']],
  ['console row', ['[aria-label="Console"]']],
  ['left rail', ['[aria-label="Character side"]']],
  ['right rail', ['[aria-label="Context side"]']],
  ['action grid', ['[aria-label="Functions and scripts"]']],
  ['vitals', ['[aria-label="Vitals"]']],
  ['experience', ['[aria-label="Experience and learning progress"]']],
  ['top bar', ['header[aria-label="Character and location"]']],
]

const PROBE = `
  const want = ${JSON.stringify(REGIONS)};
  const W = window.innerWidth, H = window.innerHeight;
  const rows = want.map(([name, selectors]) => {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const area = Math.max(0, Math.round(r.width)) * Math.max(0, Math.round(r.height));
      return {
        name, sel,
        state: area > 0 ? 'measured' : 'hidden',
        w: Math.round(r.width), h: Math.round(r.height),
        x: Math.round(r.left), y: Math.round(r.top),
        area,
        share: +(area / (W * H)).toFixed(4),
      };
    }
    return { name, sel: null, state: 'absent', w: 0, h: 0, x: 0, y: 0, area: 0, share: 0 };
  });
  return { window: { w: W, h: H, area: W * H }, rows };
`

/**
 * Characters per line in the transcript, measured rather than computed from
 * the font size.
 *
 * A `ch` is the advance of "0", and the game text is not all zeroes, so a
 * width divided by a nominal character width is a guess. This measures the
 * real advance of a real sentence in the transcript's own computed font and
 * divides the region's usable width by it.
 */
const CPL_PROBE = `
  const el = document.querySelector('[aria-label="Game workspace"]');
  if (!el) return { state: 'absent' };
  // The deepest element that actually holds game lines, so the font measured
  // is the font the lines are drawn in rather than the section's inherited one.
  const line = el.querySelector('[data-game-line]') || el.querySelector('p, span, div');
  const target = line || el;
  const cs = getComputedStyle(target);
  const c = document.createElement('canvas').getContext('2d');
  c.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
  const sample = 'You see a small silver coin lying on the ground here.';
  const advance = c.measureText(sample).width / sample.length;
  const box = (line ? line.parentElement || el : el).getBoundingClientRect();
  return {
    state: 'measured',
    fontSize: cs.fontSize,
    lineHeight: cs.lineHeight,
    advance: +advance.toFixed(2),
    boxWidth: Math.round(box.width),
    charsPerLine: Math.floor(box.width / advance),
  };
`

const out = (name) => join(root, 'docs/verification', name)

async function measure(b, w, h) {
  await b.resize(w, h)
  await b.eval('1')
  // One animation frame is not enough: the column allocator reads a
  // ResizeObserver and re-renders, so the first frame after a resize can still
  // hold the previous widths. Wait for two frames plus a tick.
  // `run` wraps its body in a *synchronous* IIFE, so the wait is an
  // expression handed to `eval`, which awaits promises for us.
  await b.eval('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))')
  await new Promise((r) => setTimeout(r, 300))
  const regions = await b.run(PROBE)
  const cpl = await b.run(CPL_PROBE)
  await b.screenshot(out(`layout-2026-09-09-${label}-${w}x${h}.png`))
  return { size: `${w}x${h}`, regions, cpl }
}

const results = []
const b = await launch({ width: sizes[0][0], height: sizes[0][1], headless: true })
let failed = 0
try {
  await b.goto(base)
  await b.run(`
    localStorage.clear();
    localStorage.setItem('dr-companion-prefs-v1', JSON.stringify({ setupComplete: true }));
    return true;
  `)
  await b.goto(base)
  const started = await b.click('button', /Start the demo/)
  if (!started || started.dead) {
    console.log('FAIL the demo button was not clickable; nothing was measured')
    failed = 1
  } else {
    await b.waitFor('header[aria-label="Character and location"]', 20000)
    for (const [w, h] of sizes) results.push(await measure(b, w, h))
  }
} finally {
  await b.close()
}

for (const r of results) {
  console.log(`\n=== ${label} @ ${r.size} (${r.regions.window.area.toLocaleString()} px) ===`)
  console.log('region'.padEnd(14), 'state'.padEnd(9), 'w x h'.padEnd(12), 'area'.padStart(10), 'share')
  for (const row of r.regions.rows) {
    console.log(
      row.name.padEnd(14),
      row.state.padEnd(9),
      (row.state === 'absent' ? '-' : `${row.w}x${row.h}`).padEnd(12),
      (row.state === 'absent' ? '-' : row.area.toLocaleString()).padStart(10),
      row.state === 'absent' ? '-' : `${(row.share * 100).toFixed(1)}%`
    )
  }
  console.log(
    'characters per line:',
    r.cpl.state === 'measured'
      ? `${r.cpl.charsPerLine} at ${r.cpl.fontSize}/${r.cpl.lineHeight} (advance ${r.cpl.advance}px, box ${r.cpl.boxWidth}px)`
      : 'not measured (no game workspace)'
  )
}

writeFileSync(out(`layout-2026-09-09-${label}.json`), JSON.stringify(results, null, 2))
console.log(`\n${results.length} of ${sizes.length} sizes measured; wrote docs/verification/layout-2026-09-09-${label}.json`)
if (results.length !== sizes.length) failed = 1
process.exit(failed)
