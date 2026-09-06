#!/usr/bin/env node
/**
 * Can a mouse reach a panel's own header controls, in every window this app
 * opens, at every size it can be? (Issue #435.)
 *
 * # What went wrong
 *
 * `MapPanel`'s "Open the map in its own window" button was reported at
 * `left: 2685` on the packaged app - not a styling complaint, because at that
 * x it is outside every window this app can open and the only route to the
 * map's own window is gone. Same family as issue #418: a control that
 * *exists* and a control a person can *reach* are different facts, and only
 * one of them is what somebody gets.
 *
 * # Why a rect is enough here, when #418 needed a click
 *
 * `empty-state-probe.mjs` deliberately does not trust rects: it asks
 * `document.elementFromPoint`, because a control below the fold is fine if its
 * box scrolls, and a rect cannot tell those apart. Horizontal escape has no
 * such rescue. The boxes above these headers clip on x or are the window
 * itself, and neither the wheel nor the keyboard moves a page sideways here,
 * so a control whose rect ends past `innerWidth` is a control nobody reaches.
 * The probe reports the *header's* width beside each rect, which turns "this
 * button is at 2685" into "this header is 2900 wide inside a 1180 window" -
 * the cause rather than the symptom.
 *
 * # The denominators, and there are three
 *
 * Counting controls that escaped can never notice a panel that rendered
 * nothing: an unmounted header and a header that fits both produce zero. So
 * nothing here is allowed to conclude until three separate counts are met.
 *
 *   1. **Every panel in the registry was reached**, at every size.
 *      `panelIds()` parses `PANEL_TITLES` out of
 *      `src/components/dashboard/panels.tsx` and throws rather than returning
 *      a short list, so a panel added tomorrow is measured without anybody
 *      remembering this file, and a broken parse reports itself.
 *   2. **Every document actually rendered the app.** The demo banner is the
 *      marker: it proves the bundle booted, the seeded profile was read, and
 *      `WindowShell` mounted. A blank page, an error page or an unseeded
 *      profile all fail it.
 *   3. **The Tauri stand-in took.** The pop-out and "bring it back" controls
 *      only render when `isTauri()` is true, so in a plain browser they do not
 *      exist at all and a run that measured none of them would be measuring
 *      nothing. At least one such control must be found, and the run says how
 *      many it saw.
 *
 * # What this stand-in cannot say
 *
 * Chrome is not the app. `isTauri()` is made true here by installing a
 * `__TAURI_INTERNALS__` whose `invoke` resolves - enough for the controls to
 * render and be measured, and nothing like a backend. Anything gated on a
 * real command's *answer* is therefore not exercised, and the main window is
 * measured in a browser where `LichLauncher` renders nothing, so it is
 * shorter here than in the app. The real-app measurements this check was
 * written from are in `docs/verification/popout-mode-2026-09-06.md`; this is
 * the cheap check that runs on every build, and it says which half it covers
 * rather than implying both.
 *
 * Usage: node tools/panel-controls-shots.mjs [http://127.0.0.1:5182/]
 */
import { launch } from './browser.mjs'
import { panelIds, CONTROL_SIZES, CONTROL_PROBE } from './panel-controls-probe.mjs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const base = process.argv[2] ?? 'http://127.0.0.1:5182/'
const out = (name) => join(root, 'docs/verification', name)

const BANNER = 'Demo: this is invented data. Attach to Lich to see your character.'

let bad = 0
const check = (label, cond, detail) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label.padEnd(56)} ${detail ?? ''}`)
  if (!cond) bad += 1
}

/**
 * Enough of `__TAURI_INTERNALS__` for `isTauri()` to be true and for the
 * handful of commands these panels fire on mount to resolve rather than
 * reject. Installed with `addInit` because the store decides all of this at
 * module-evaluation time - anything run after a navigation has missed it.
 */
const TAURI_STUB = `
  window.__TAURI_INTERNALS__ = {
    invoke: (cmd) => Promise.resolve(cmd === 'panel_windows' ? [] : null),
    transformCallback: (cb) => { const id = 'cb' + Math.random(); window[id] = cb; return id; },
  };
`

const ids = panelIds(root)
console.log(`panels in the registry: ${ids.length} (${ids.join(', ')})`)

const b = await launch({ width: 1180, height: 820, headless: true })
let gatedControlsSeen = 0
try {
  await b.goto(base)
  await b.run(`
    localStorage.clear();
    localStorage.setItem('dr-companion-prefs-v1', JSON.stringify({ setupComplete: true, bridgeMode: 'mock' }));
    return true;
  `)
  await b.addInit(TAURI_STUB)

  for (const [w, h, why] of CONTROL_SIZES) {
    console.log(`\n--- ${w}x${h}: ${why} ---`)
    let reached = 0

    // Every window kind: the main one, then one route per panel in the
    // registry. The routes are what `open_panel_window` opens, spelled the
    // same way `src-tauri/src/lib.rs` spells them.
    const windows = [['(main)', base], ...ids.map((id) => [id, `${base}?view=panel&id=${id}`])]

    for (const [name, url] of windows) {
      await b.goto(url, { waitFor: 'body' })
      await b.resize(w, h)
      // The mock bridge publishes on a timer, and a panel that has not been
      // handed a character yet has not laid its header out yet.
      await b.waitFor('button', 15000).catch(() => {})
      const seen = await b.run(CONTROL_PROBE)
      const rendered = seen.text.includes(BANNER.slice(0, 40)) || (await b.eval(`(document.body.innerText || '').includes(${JSON.stringify(BANNER)})`))
      if (rendered) reached += 1
      check(`${name} rendered the app`, rendered, rendered ? '' : `text="${(seen.text || '').replace(/\n/g, ' / ').slice(0, 70)}"`)

      gatedControlsSeen += seen.controls.filter((c) => /own window|Bring it back/i.test(c.label)).length
      const escaped = seen.escaped
      check(
        `${name} header controls are inside the window`,
        escaped.length === 0,
        `${seen.controls.length} control(s) in headers` +
          (escaped.length
            ? ` | OUT: ${escaped.map((e) => `"${e.label}" at ${e.left}..${e.right} in a ${e.headerWidth}px header, window ${seen.vw}px`).join('; ')}`
            : '')
      )
      // Named apart from `panel-controls-2026-09-06.png`, which is the real
      // app. A browser shot and a WebView2 shot under one filename would be
      // two different claims wearing the same name.
      if (name === 'map') await b.screenshot(out(`panel-controls-browser-2026-09-06-${w}x${h}.png`))
    }

    check(
      `every panel in the registry was reached at ${w}x${h}`,
      reached === windows.length,
      `${reached} of ${windows.length} windows rendered`
    )
  }

  // Denominator 3. Without this, a stub that stopped working would take every
  // pop-out control off the page and the run would report a clean sweep of
  // controls that were never there - the exact shape of failure this file's
  // header is about.
  check(
    'the Tauri stand-in took, so pop-out controls existed to measure',
    gatedControlsSeen > 0,
    `${gatedControlsSeen} isTauri()-gated control(s) measured across the run`
  )
} finally {
  await b.close()
}

console.log(`\n${bad === 0 ? 'no failures' : `${bad} failed`}`)
process.exit(bad === 0 ? 0 : 1)
