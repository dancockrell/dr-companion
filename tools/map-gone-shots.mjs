#!/usr/bin/env node
/**
 * The eyes-on half of the map deletion (D6, issue #518).
 *
 *   npm run dev -- --port 5184 --strictPort false
 *   node tools/map-gone-shots.mjs http://127.0.0.1:5184/
 *
 * `tools/mud-client-e2e.mjs` asserts the absence out of the source, which is
 * the right shape for a suite that has to run in two seconds on every change
 * and has no renderer. What a source check cannot tell you is what a player
 * who arrives at one of these routes actually sees, and that is the whole of
 * #518: the old fall-through was honest and inert, one sentence on an empty
 * surface with no way out.
 *
 * So this renders the two routes that were reachable before the deletion and
 * are the ones a saved layout or an open window points at now:
 *
 *   ?view=map            the standalone map window
 *   ?view=panel&id=map   the map panel, popped out
 *
 * Both are asserted, not merely photographed, and the third shot is the
 * control: `?view=panel&id=stats` still renders a panel, so "the map route
 * shows the gone state" is a statement about the map rather than about a
 * broken build in which nothing renders at all.
 *
 * # What it cannot tell you
 *
 * Chrome is not the app. `isTauri()` is false here, so nothing attaches to
 * anything and no window is really popped out. That is fine for this
 * question - both routes are decided by `windowView()` and `PANEL_CONTENT`,
 * neither of which asks whether it is inside Tauri - and it is stated because
 * a check that reached its screen by a private door is not checking the screen
 * a person sees.
 */
import { launch } from './browser.mjs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const base = process.argv[2] ?? 'http://127.0.0.1:5184/'
const out = (name) => join(root, 'docs/verification', `map-gone-2026-09-09-${name}.png`)

let bad = 0
let checks = 0
const check = (label, condition, detail = '') => {
  checks += 1
  if (!condition) bad += 1
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label.padEnd(56)}  ${detail}`)
}

const b = await launch({ width: 1280, height: 860, headless: true })
try {
  await b.goto(base)

  /*
   * A layout saved while the map still existed, written straight into the
   * storage `loadLayout` reads.
   *
   * This is the fixture that matters. A fresh install cannot be stranded by a
   * panel it never had, so photographing one would prove nothing; the player
   * this increment can hurt is the one who had the map open, arranged around
   * it, and comes back to a build without it.
   */
  await b.run(`
    localStorage.clear();
    localStorage.setItem('dr-companion-prefs-v1', JSON.stringify({ setupComplete: true, bridgeMode: 'live' }));
    localStorage.setItem('drc.layout.v1.power', JSON.stringify({
      order: ['map', 'vitals', 'stats'],
      panels: { map: { height: 260 }, stats: { height: 140 } },
      rects: { map: { x: 10, y: 10, w: 400, h: 300 } },
      freeform: false,
      dock: { axis: 'row', regions: [
        { id: 'left', size: 0.5, panels: ['map'], active: 'map' },
        { id: 'right', size: 0.5, panels: ['map', 'stats'], active: 'map' },
      ] },
    }));
    localStorage.setItem('drc.map.v1', JSON.stringify({ docked: true, width: 420 }));
    localStorage.setItem('drc.map-height.v4', '0.58');
    return true;
  `)

  // 1. The main window, loaded against that layout.
  await b.goto(base, { waitFor: '#root > *' })
  const app = await b.eval('document.body.innerText')
  await b.screenshot(out('01-app-with-a-migrated-layout'))
  check('the app renders rather than failing on the old layout', app.trim().length > 20)
  check(
    'and says nothing about a map that is missing',
    !/Map hidden while the window is this short/.test(app),
    JSON.stringify(app.slice(0, 60))
  )

  // The migration, read back out of storage rather than inferred from the
  // picture: a `map` key that survived would be invisible on screen.
  const stored = JSON.parse(await b.eval(`localStorage.getItem('drc.layout.v1.power')`) || 'null')
  check('the saved layout still exists', stored !== null && Array.isArray(stored.order))
  check(
    'and the retired storage keys were deleted',
    (await b.eval(`localStorage.getItem('drc.map.v1')`)) === null &&
      (await b.eval(`localStorage.getItem('drc.map-height.v4')`)) === null
  )

  // 2. The control. A route that still works, so a gone state below means the
  //    map is gone rather than that this build renders nothing.
  await b.goto(`${base}?view=panel&id=stats`, { waitFor: '#root > *' })
  const real = await b.eval('document.body.innerText')
  await b.screenshot(out('02-control-a-panel-that-exists'))
  check('a surviving panel id still renders', real.trim().length > 10 && !/No panel called/.test(real))

  // 3. The map panel, popped out. This is #518's route: `map` led every
  //    default order, so it is the id most likely to be in a saved layout or
  //    an open window.
  await b.goto(`${base}?view=panel&id=map`, { waitFor: '#root > *' })
  const gonePanel = await b.eval('document.body.innerText')
  await b.screenshot(out('03-map-panel-gone'))
  check('the map panel window names itself gone', /No panel called\s+map/.test(gonePanel), JSON.stringify(gonePanel.slice(0, 40)))
  check('and lists the ids that do exist', /vitals/.test(gonePanel) && /stats/.test(gonePanel))
  check('and says where the map went', /Godot/.test(gonePanel) && /NO-3D/.test(gonePanel))
  check('and offers a way back to the app', /Open the app in this window/.test(gonePanel))

  // 4. The old standalone map window. Not a gone state: `?view=map` is an
  //    ordinary app window now, which is what the D3 flag already made it.
  await b.goto(`${base}?view=map`, { waitFor: '#root > *' })
  const mapWindow = await b.eval('document.body.innerText')
  await b.screenshot(out('04-view-map-is-the-app'))
  check('?view=map is the app, not an empty window', mapWindow.trim().length > 20 && !/No panel called/.test(mapWindow))
  check('and it is the same app the control showed', mapWindow.includes(app.trim().slice(0, 24)))

  const errors = b.consoleErrors()
  check('nothing threw on any of those routes', errors.length === 0, errors.slice(0, 2).join(' | '))
} finally {
  await b.close()
}

/**
 * Far below the real count on purpose: a tripwire for a run that lost its
 * browser or its dev server partway, not a regression test on the number of
 * cases. A run that took no pictures must not be able to report a pass.
 */
const FLOOR = 8
if (checks < FLOOR) {
  console.log(`\nFAIL only ${checks} checks ran; this file has at least ${FLOOR}`)
  process.exit(1)
}
console.log(`\n${checks} checked, ${bad} failed`)
process.exit(bad ? 1 : 0)
