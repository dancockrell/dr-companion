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
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      })
      .outputText.replace(/from '(\.\/[^']+)'/g, (_, r) => `from '${r}.js'`)
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
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const m = await import(pathToFileURL(layoutPath).href)

let fails = 0
const check = (label, got, want) => {
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

console.log('\n-- a layout saved before decks existed still loads --')
store.set(
  'drc.layout.v1.basic',
  JSON.stringify({ order: ['map', 'vitals'], panels: {}, mapPlane: true, mapSplit: 0.5 })
)
const old = m.loadLayout('basic')
check('decks filled in', Object.values(old.decks), ['auto', 'auto', 'auto'])
check('their order is kept first', old.order.slice(0, 2), ['map', 'vitals'])
check('missing panels appended', old.order.length, m.defaultLayout('basic').order.length)

console.log('\n-- junk in storage falls back rather than throwing --')
store.set('drc.layout.v1.power', '{not json')
check('fallback', m.loadLayout('power').decks.hostile, 'auto')

console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
