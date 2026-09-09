/**
 * Layout persistence, and the deck density the player pinned.
 *
 * The case that matters is the upgrade path: someone who saved a layout before
 * decks existed must not end up with a broken or empty one, and a deck added
 * in a later version must appear for them rather than being silently absent.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const dir = mkdtempSync(join(tmpdir(), 'layout-'))
const compile = (src, name) => {
  const out = join(dir, name)
  writeFileSync(
    out,
    // Node ESM needs the extension that tsc leaves off relative imports.
    ts
      .transpileModule(readFileSync(src, 'utf8'), {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          // Let the compiler rewrite './x.ts' -> './x.js' rather than a regex
          // below. Six copies of that regex existed; one had learned about
          // explicit .ts extensions and five had not, so five suites broke the
          // day src/ adopted them (C14). tsc has owned this since 5.7.
          rewriteRelativeImportExtensions: true,
        },
      })
      .outputText
  )
  return out
}
compile('src/lib/cards.ts', 'cards.js')
// layout.ts imports the dock model for its defaults.
compile('src/lib/dock.ts', 'dock.js')
// And the shared localStorage read/write helper.
compile('src/lib/storage.ts', 'storage.js')
const layoutPath = compile('src/lib/layout.ts', 'layout.js')

// A tiny localStorage, because layout.ts persists through it.
const store = new Map()
globalThis.window = new EventTarget()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const m = await import(pathToFileURL(layoutPath).href)

let checked = 0
let fails = 0
const check = (label, got, want) => {
  checked++
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label.padEnd(52)} ${JSON.stringify(got)}`)
}

console.log('-- decks start on auto --')
const base = m.defaultLayout('power')
check('three decks', Object.keys(base.decks).sort(), ['allied', 'hostile', 'people'])
check('all auto', Object.values(base.decks), ['auto', 'auto', 'auto'])

console.log('\n-- cycling walks the list and returns to auto --')
let l = base
const seen = []
for (let i = 0; i < m.DECK_PREFS.length; i++) {
  l = m.cycleDeckPref(l, 'hostile')
  seen.push(l.decks.hostile)
}
check('one full lap', seen, ['full', 'compact', 'row', 'fan', 'count', 'auto'])
check('other decks untouched', l.decks.people, 'auto')

console.log('\n-- a pin survives a save and load --')
m.saveLayout('power', m.setDeckPref(base, 'hostile', 'fan'))
check('reloaded', m.loadLayout('power').decks.hostile, 'fan')

console.log('\n-- layout notifications cross both hook and window boundaries --')
let notifications = 0
const unsubscribe = m.onLayoutChange(() => notifications++)
m.saveLayout('power', base)
check('same-window save publishes', notifications, 1)
const crossWindow = new Event('storage')
Object.defineProperty(crossWindow, 'key', { value: 'drc.layout.v1.power' })
window.dispatchEvent(crossWindow)
check('matching cross-window storage publishes', notifications, 2)
const unrelated = new Event('storage')
Object.defineProperty(unrelated, 'key', { value: 'drc.prefs.v2' })
window.dispatchEvent(unrelated)
check('unrelated storage remains isolated', notifications, 2)
unsubscribe()

console.log('\n-- a layout saved before decks existed still loads --')
store.set(
  'drc.layout.v1.basic',
  JSON.stringify({ order: ['stats', 'vitals'], panels: {}, mapPlane: true, mapSplit: 0.5 })
)
const old = m.loadLayout('basic')
check('decks filled in', Object.values(old.decks), ['auto', 'auto', 'auto'])
check('their order is kept first', old.order.slice(0, 2), ['stats', 'vitals'])
check('missing panels appended', old.order.length, m.defaultLayout('basic').order.length)

/*
 * A layout saved while the map still existed.
 *
 * This is why `RETIRED_PANEL_IDS` is a list rather than a version bump: the
 * player keeps their arrangement and loses only the panel that is gone. Four
 * places had to be cleaned and only the first was already handled - `order`
 * fell out of the existing filter against the defaults, while `panels`,
 * `rects` and the persisted `dock` each kept a `map` key, and the dock went on
 * rendering a tab with nothing behind it.
 *
 * The fixture is deliberately a populated layout, not a bare one: a stranded
 * player is one who had arranged things, and a migration that only works on an
 * empty layout is the case nobody has.
 */
console.log('\n-- a layout saved while the map existed loses the map and nothing else --')
store.set(
  'drc.layout.v1.power',
  JSON.stringify({
    order: ['map', 'vitals', 'stats'],
    panels: { map: { height: 260 }, stats: { height: 140 } },
    rects: { map: { x: 10, y: 10, w: 400, h: 300 }, stats: { x: 0, y: 0, w: 200, h: 100 } },
    freeform: true,
    dock: {
      axis: 'row',
      regions: [
        { id: 'left', size: 0.5, panels: ['map'], active: 'map' },
        { id: 'right', size: 0.5, panels: ['map', 'stats'], active: 'map' },
      ],
    },
  })
)
const migrated = m.loadLayout('power')
check('order has no map', migrated.order.includes('map'), false)
check('the order they arranged survives', migrated.order.slice(0, 2), ['vitals', 'stats'])
check('panels has no map key', Object.keys(migrated.panels).includes('map'), false)
check('their other panel size survives', migrated.panels.stats, { height: 140 })
check('rects has no map key', Object.keys(migrated.rects).includes('map'), false)
check('their other placement survives', migrated.rects.stats, { x: 0, y: 0, w: 200, h: 100 })
check('freeform survives', migrated.freeform, true)
check(
  'the stored dock keeps no map tab',
  migrated.dock.regions.flatMap((r) => r.panels).includes('map'),
  false
)
check(
  'a region that held only the map is dissolved, not left empty',
  migrated.dock.regions.map((r) => r.id),
  ['right']
)
check(
  'and a region whose active tab was the map picks a surviving one',
  migrated.dock.regions[0].active,
  'stats'
)

/*
 * The keys whose reader was deleted. Asserted both ways on purpose: that the
 * retired ones go, *and* that a similarly named key stays. A "migration" that
 * cleared everything starting `drc.map` would pass the first half of this and
 * take an unrelated preference with it.
 */
console.log('\n-- retired storage keys are deleted, and only those --')
store.set('drc.map.v1', '{"docked":true}')
store.set('drc.map-height.v4', '0.58')
store.set('drc.map-height.v1', '480')
store.set('drc.mapkeep.v1', 'not a retired key')
check('three removed', m.stripRetiredKeys(), 3)
check('drc.map.v1 gone', store.has('drc.map.v1'), false)
check('drc.map-height.v4 gone', store.has('drc.map-height.v4'), false)
check('drc.map-height.v1 gone', store.has('drc.map-height.v1'), false)
check('a similarly named key is untouched', store.get('drc.mapkeep.v1'), 'not a retired key')
check('a second run removes nothing', m.stripRetiredKeys(), 0)

console.log('\n-- junk in storage falls back rather than throwing --')
store.set('drc.layout.v1.power', '{not json')
check('fallback', m.loadLayout('power').decks.hostile, 'auto')

console.log('')
// Far below the real count on purpose: a tripwire for a truncated or
// half-loaded run, not a regression test on the number of cases.
const MIN_EXPECTED = 8
if (checked < MIN_EXPECTED) {
  console.error(`FAILED: only ${checked} checks ran, expected at least ${MIN_EXPECTED}`)
  process.exit(1)
}
// `checked`, not a pass count: the denominator has to be the number of
// checks that ran, or it shrinks by one per failure and reports a smaller
// suite on exactly the run where you need to know the size did not change.
console.log(`${checked} checked, ${fails} failed`)
if (fails) {
  console.error('FAILED')
  process.exit(1)
}
console.log('all passed')
process.exit(0)
