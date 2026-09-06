#!/usr/bin/env node
/**
 * The render check for the honest first screen (issue #382).
 *
 * Drives a real browser against a dev server and saves what it saw, rather
 * than describing it. Three states, in order, each reached by clicking the
 * control a person would click:
 *
 *   a. default, no flags, setup complete, nothing else stored - the empty
 *      state with its call to action;
 *   b. after pressing "Start the demo" - the banner and the mock world;
 *   c. after pressing "Leave the demo" - back to the empty state, with no
 *      invented character left behind;
 *   d. each window this app can open, with the demo on - the popped-out panel
 *      windows and the map route - because the banner has to be in every one
 *      of them and not only the main window (issue #400);
 *   e. the empty state at every size the window can be, because the demo
 *      button being *present* and the demo button being *reachable* turned
 *      out to be different facts (issue #418).
 *
 * # What this cannot tell you
 *
 * Chrome is not the app. `isTauri()` is false here, so `LichLauncher` renders
 * nothing and the attach control's real behaviour is not exercised at all -
 * only whether the screen offers a route to it. `tools/app-eyes.mjs` is the
 * tool that attaches to the real WebView2. This is deliberately the cheaper
 * check, and it says which half it covers rather than implying both.
 *
 * Usage: node tools/first-screen-shots.mjs [http://127.0.0.1:5182/]
 */
import { launch } from './browser.mjs'
import {
  EMPTY_STATE_PROBE,
  EMPTY_STATE_SIZES,
  EMPTY_STATE_CONTROLS,
} from './empty-state-probe.mjs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const base = process.argv[2] ?? 'http://127.0.0.1:5182/'
const out = (name) => join(root, 'docs/verification', name)

const BANNER = 'Demo: this is invented data. Attach to Lich to see your character.'

let bad = 0
const check = (label, cond, detail) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label.padEnd(52)} ${detail ?? ''}`)
  if (!cond) bad += 1
}

const b = await launch({ width: 1280, height: 860, headless: true })
try {
  // A profile that has been through setup and nothing else: exactly the state
  // the first-run walkthrough was in when it saw Dan the Bold.
  await b.goto(base)
  await b.run(`
    localStorage.clear();
    localStorage.setItem('dr-companion-prefs-v1', JSON.stringify({ setupComplete: true }));
    return true;
  `)
  await b.goto(base)

  const a = await b.eval('document.body.innerText')
  await b.screenshot(out('first-screen-2026-09-06-empty.png'))
  check('a. no character is claimed', !/Dan the Bold/.test(a))
  check('a. no invented vitals', !/84 of 100/.test(a))
  check('a. the call to action is on screen', /Nothing is connected yet/.test(a))
  check('a. attaching to Lich is named', /Attach to Lich/.test(a))
  check('a. the demo is offered', /Start the demo/.test(a))
  check('a. no demo banner while not in the demo', !a.includes(BANNER))

  const clicked = await b.click('button', /Start the demo/)
  check('b. the demo button is clickable', !!clicked && !clicked.dead, JSON.stringify(clicked))
  // The mock bridge publishes on a timer; wait for the character rather than
  // for a fixed sleep.
  await b.waitFor('header[aria-label="Character and location"]', 15000)
  const bText = await b.eval('document.body.innerText')
  await b.screenshot(out('first-screen-2026-09-06-demo.png'))
  check('b. the banner says it in a sentence', bText.includes(BANNER))
  check('b. and there is a character to warn about', /Dan the Bold|MOCK/i.test(bText))
  check('b. the way out is offered', /Leave the demo/.test(bText))

  const left = await b.click('button', /Leave the demo/)
  check('c. the exit is clickable', !!left && !left.dead, JSON.stringify(left))
  await b.waitFor('main', 15000)
  const c = await b.eval('document.body.innerText')
  check('c. the banner is gone', !c.includes(BANNER))
  check('c. the invented character is gone', !/Dan the Bold/.test(c))
  check('c. the empty state is back', /Nothing is connected yet/.test(c))

  /*
   * d. the windows this app can open, each one visited with the demo on.
   *
   * Issue #400: the banner was mounted inside the main window's return, so a
   * popped-out panel showed a full invented stat block with nothing saying
   * so. The checks above could not see it, because they only ever visited the
   * main window - which is why this loop exists rather than one more
   * assertion about the main screen.
   *
   * What each route actually renders, said plainly rather than implied:
   * `?view=panel&id=...` is the popped-out panel window, the one the defect
   * was demonstrated in. `?view=map` is currently NOT the map window -
   * App.tsx's `MAP_WINDOW_ENABLED` is false, so it falls through to the app
   * view - so that row checks the fall-through, not `MapWindow`. It is here
   * because the route is what a person would type and the fall-through is
   * what they get; if the flag comes back, the case starts covering the map
   * window with no edit.
   */
  await b.goto(base)
  await b.run(`
    localStorage.setItem('dr-companion-prefs-v1', JSON.stringify({ setupComplete: true, bridgeMode: 'mock' }));
    return true;
  `)
  const windows = [
    ['?view=panel&id=stats', 'stats pop-out'],
    ['?view=panel&id=map', 'map pop-out'],
    ['?view=map', 'map route (falls through to the app view today)'],
  ]
  const missing = []
  const seen = []
  for (const [query, label] of windows) {
    await b.goto(base + query, { waitFor: '#root > *' })
    // The mock publishes on a timer, so wait for the thing being asserted
    // rather than for a fixed sleep.
    let text = ''
    for (let i = 0; i < 60; i += 1) {
      text = await b.eval('document.body.innerText')
      if (text.includes(BANNER)) break
      await new Promise((r) => setTimeout(r, 250))
    }
    seen.push(`${label}: ${JSON.stringify(text.slice(0, 50))}`)
    if (!text.includes(BANNER)) missing.push(label)
    if (query.includes('id=stats')) await b.screenshot(out('demo-banner-popouts-2026-09-06-panel.png'))
    if (query === '?view=map') await b.screenshot(out('demo-banner-popouts-2026-09-06-map.png'))
  }
  check(
    `d. every window kind carries the banner (${windows.length} visited)`,
    missing.length === 0 && seen.length === windows.length,
    missing.length ? `missing in ${missing.join(', ')}` : seen.join(' | ')
  )
  check('d. and every one of them rendered something', seen.every((s) => s.length > 25), seen.join(' | '))

  // The control that makes the row above mean something: the same route with
  // the demo off must not show it, so a pass is not a banner welded on.
  await b.goto(base)
  await b.run(`
    localStorage.setItem('dr-companion-prefs-v1', JSON.stringify({ setupComplete: true, bridgeMode: 'live' }));
    return true;
  `)
  await b.goto(base + '?view=panel&id=stats', { waitFor: '#root > *' })
  const live = await b.eval('document.body.innerText')
  check(
    'd. control: with the demo off the pop-out has no banner',
    !live.includes(BANNER),
    JSON.stringify(live.slice(0, 50))
  )

  /*
   * e. the empty state at every size the window can be (issue #418).
   *
   * The clean VM found "Start the demo" and "Connection help" below the
   * bottom edge of the app's own default window, with the heading above the
   * top and no scrollbar between them - the demo the whole first-run flow
   * offers was unreachable on any screen shorter than about 1100px.
   *
   * Asserted by measurement, not by class names: each control is located by
   * the words a person reads, and the question asked of it is whether a click
   * would land on it (`document.elementFromPoint` at its centre), then
   * whether scrolling a box a person can actually scroll would bring it
   * there. See `empty-state-probe.mjs` for why both halves are needed and
   * what a `scrollIntoView` version of this got wrong.
   */
  await b.goto(base)
  await b.run(`
    localStorage.setItem('dr-companion-prefs-v1', JSON.stringify({ setupComplete: true, bridgeMode: 'live' }));
    return true;
  `)
  await b.goto(base + '?bridge=live')

  let measured = 0
  let overflowSeen = 0
  for (const [w, h, why] of EMPTY_STATE_SIZES) {
    const got = await b.resize(w, h)
    check(
      `e. ${w}x${h} is the size the page actually got`,
      got.w === w && got.h === h,
      `${why} - page reports ${got.w}x${got.h}`
    )
    // The layout settles on a frame, not on a promise.
    await new Promise((r) => setTimeout(r, 400))
    const m = await b.run(EMPTY_STATE_PROBE)
    if (m.hostOverflows) overflowSeen += 1

    const missing = m.controls.filter((c) => !c.found)
    const stuck = m.controls.filter((c) => c.found && !c.visibleAfterScroll)
    measured += m.controls.length
    check(
      `e. ${w}x${h}: every control is on screen or scrollable to`,
      missing.length === 0 && stuck.length === 0,
      [
        missing.length ? `not rendered at all: ${missing.map((c) => c.needle).join(', ')}` : '',
        stuck.length
          ? stuck.map((c) => `"${c.needle}" at ${c.top}..${c.bottom}: ${c.why}`).join('; ')
          : '',
        `host overflow-y ${m.hostOverflowY}, ${m.hostScrollHeight}/${m.hostClientHeight}`,
      ]
        .filter(Boolean)
        .join(' | ')
    )
    // Overflow without a scrollbar is the defect itself, so it is checked
    // separately from whether today's content happens to fit.
    check(
      `e. ${w}x${h}: the container scrolls rather than clipping`,
      m.hostOverflowY === 'auto' || m.hostOverflowY === 'scroll',
      `overflow-y is ${m.hostOverflowY}`
    )
    // The paper record, at the size the clean VM's screen clamped to.
    if (w === 992) await b.screenshot(out('empty-state-2026-09-06-after.png'))
  }
  // The denominator. A probe that found nothing, a size list that emptied, or
  // a throw halfway down would otherwise look exactly like a clean sweep.
  check(
    'e. the sweep actually measured every control at every size',
    measured === EMPTY_STATE_SIZES.length * EMPTY_STATE_CONTROLS.length,
    `${measured} of ${EMPTY_STATE_SIZES.length * EMPTY_STATE_CONTROLS.length}`
  )
  // And the positive control on the scrolling half: at least one size must
  // genuinely overflow, or "reachable by scrolling" was never exercised and
  // this whole section would pass against a container that cannot scroll.
  check(
    'e. control: at least one size overflows, so scrolling was exercised',
    overflowSeen > 0,
    `${overflowSeen} of ${EMPTY_STATE_SIZES.length} sizes overflowed`
  )

  const errors = b.consoleErrors()
  check('no page exceptions', errors.length === 0, errors.join(' | '))
} finally {
  await b.close()
}

console.log(bad === 0 ? '\nall render checks passed' : `\n${bad} render check(s) failed`)
process.exit(bad === 0 ? 0 : 1)
