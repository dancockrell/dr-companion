/**
 * mapPins.ts - saved places, colour-coded, keyed per character the same way
 * profiles.ts already is (Home for one character is not Home for another).
 *
 * mapPins.ts imports storage.ts and profiles.ts by extensionless relative
 * path, which Vite resolves and Node's own module loader does not - so this
 * transpiles all three into one temp directory and rewrites the imports to
 * carry the .js Node needs, the same trick tools/layout-test.mjs uses.
 * profiles.ts's own import of ../types is `import type`, which
 * transpileModule erases entirely, so that one never needs compiling here.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const dir = mkdtempSync(join(tmpdir(), 'pins-'))
const compile = (src, name) => {
  const out = join(dir, name)
  writeFileSync(
    out,
    ts
      .transpileModule(readFileSync(src, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      })
      .outputText.replace(/from '(\.\/[^']+)'/g, (_, r) => `from '${r}.js'`)
  )
  return out
}
compile('src/lib/storage.ts', 'storage.js')
compile('src/lib/profiles.ts', 'profiles.js')
compile('src/lib/mapPlaceColors.ts', 'mapPlaceColors.js')
const pinsPath = compile('src/lib/mapPins.ts', 'mapPins.js')

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const {
  loadPins,
  addPin,
  removePin,
  updatePin,
  pinFor,
  setCorpseMarker,
  clearCorpseMarker,
  PIN_COLORS,
  PIN_COLOR_HEX,
  PIN_ICONS,
  PIN_PRESETS,
  COMMON_PLACE_PIN_COLORS,
} = await import(pathToFileURL(pinsPath).href)

let failed = 0
let checked = 0
const ok = (name, cond, detail = '') => {
  checked++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
  if (!cond) failed++
}

const HERO = ['Erathi', 'DR']
const OTHER = ['Erathi', 'DR-Fallen'] // same name, different instance - a different character

ok('a fresh character has no pins', loadPins(...HERO).length === 0)

const after1 = addPin(...HERO, { roomId: 101, zone: '1', label: 'Home', color: 'blue' })
ok('a pin was added', after1.length === 1)
ok('roomId survives', after1[0].roomId === 101)
ok('label survives', after1[0].label === 'Home')
ok('color survives', after1[0].color === 'blue')
ok('gets an id', typeof after1[0].id === 'string' && after1[0].id.length > 0)
ok('gets a timestamp', typeof after1[0].createdAt === 'number' && after1[0].createdAt > 0)

const after2 = addPin(...HERO, { roomId: 202, zone: '1', label: 'Bank', color: 'green' })
ok('a second pin adds, does not replace', after2.length === 2)
ok('loadPins reflects it', loadPins(...HERO).length === 2)

console.log('')
console.log('-- pins are per character, same key scheme as profiles --')
ok(
  'the same name on a different instance is a different character with no pins',
  loadPins(...OTHER).length === 0
)
addPin(...OTHER, { roomId: 9, zone: '1', label: 'Home', color: 'blue' })
ok("the other character's pin does not leak back", loadPins(...HERO).length === 2)
ok("this character's own pin does not leak the other way", loadPins(...OTHER).length === 1)

console.log('')
console.log('-- editing and removing --')
const bank = loadPins(...HERO).find((p) => p.label === 'Bank')
const afterEdit = updatePin(...HERO, bank.id, { label: 'Crossing Bank', color: 'gold' })
const edited = afterEdit.find((p) => p.id === bank.id)
ok('label updates', edited.label === 'Crossing Bank')
ok('color updates', edited.color === 'gold')
ok('roomId is untouched by an edit', edited.roomId === 202)

const afterRemove = removePin(...HERO, bank.id)
ok('removed pin is gone', afterRemove.length === 1)
ok('the other pin survives', afterRemove.some((p) => p.label === 'Home'))
ok('a second removal of the same id is a harmless no-op', removePin(...HERO, bank.id).length === 1)

console.log('')
console.log('-- pinFor: does this room already have a pin --')
const pins = loadPins(...HERO)
ok('finds the pin on a pinned room', pinFor(pins, 101)?.label === 'Home')
ok('finds nothing on an unpinned room', pinFor(pins, 999) === undefined)

console.log('')
console.log('-- the palette --')
ok('a small fixed set, not an open picker', PIN_COLORS.length >= 4 && PIN_COLORS.length <= 8)
ok(
  'every palette colour has a hex value to draw with',
  PIN_COLORS.every((c) => typeof PIN_COLOR_HEX[c] === 'string' && PIN_COLOR_HEX[c].startsWith('#'))
)

console.log('')
console.log('-- icons: optional, additive, do not touch anything else --')
const withIcon = addPin(...HERO, { roomId: 303, zone: '1', label: 'Guild', color: 'purple', icon: 'shield' })
const guildPin = withIcon.find((p) => p.roomId === 303)
ok('icon survives', guildPin.icon === 'shield')
ok('a pin saved with no icon simply has none', loadPins(...HERO).find((p) => p.roomId === 101).icon === undefined)
const iconEdit = updatePin(...HERO, guildPin.id, { icon: 'sword' })
ok('icon can be edited on its own', iconEdit.find((p) => p.id === guildPin.id).icon === 'sword')
ok(
  "editing the icon doesn't touch the label or colour",
  iconEdit.find((p) => p.id === guildPin.id).label === 'Guild' &&
    iconEdit.find((p) => p.id === guildPin.id).color === 'purple'
)
removePin(...HERO, guildPin.id)

console.log('')
console.log('-- the icon set --')
ok('several icons to choose from, not just one', PIN_ICONS.length >= 8)
ok('map-pin (the plain default) is one of them', PIN_ICONS.includes('map-pin'))

console.log('')
console.log('-- starter presets: many, and covering the categories Dan asked for --')
ok('banks and shops have one shared color language', COMMON_PLACE_PIN_COLORS.bank === 'gold' && COMMON_PLACE_PIN_COLORS.shop === 'blue')
ok('a generous list, not one-per-category minimum', PIN_PRESETS.length >= 10)
for (const want of ['Home', 'Bank', 'Healer', 'Guild', 'Hunting Spot', 'Return Point']) {
  ok(`covers "${want}"`, PIN_PRESETS.some((p) => p.label === want))
}
ok(
  'every preset names a real icon and a real colour',
  PIN_PRESETS.every((p) => PIN_ICONS.includes(p.icon) && PIN_COLORS.includes(p.color))
)

console.log('')
console.log('-- the corpse marker: one at a time, and it is not a normal pin --')
const afterDeath1 = setCorpseMarker(...HERO, 555, '1')
const corpse1 = afterDeath1.find((p) => p.system)
ok('a marker was dropped', !!corpse1, JSON.stringify(afterDeath1))
ok('at the death room', corpse1.roomId === 555)
ok('flagged as system, not a hand-made pin', corpse1.system === true)
ok('the other pins are untouched', afterDeath1.some((p) => p.label === 'Home'))

const afterDeath2 = setCorpseMarker(...HERO, 777, '1')
ok('a second death replaces the marker rather than stacking', afterDeath2.filter((p) => p.system).length === 1)
ok('at the new death room', afterDeath2.find((p) => p.system).roomId === 777)

const afterClear = clearCorpseMarker(...HERO)
ok('walking back to it clears the marker', afterClear.every((p) => !p.system))
ok('everything else survives being cleared', afterClear.some((p) => p.label === 'Home'))

console.log('')
console.log('-- storage survives garbage already in it --')
store.set('drc.pins.v1', '{not json')
ok('a corrupted store degrades to empty rather than throwing', loadPins(...HERO).length === 0)

ok('enough was checked for a pass to mean something', checked >= 20, `${checked} assertions`)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
