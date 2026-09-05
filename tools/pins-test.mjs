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
  savedPinsLabel,
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
ok('gold pins use the canonical accent token value', PIN_COLOR_HEX.gold === '#d4a84b')
const markerSource = readFileSync('src/lib/playerMarker.ts', 'utf8')
ok(
  'the default player marker reuses the canonical pin red',
  markerSource.includes('color: PIN_COLOR_HEX.red') && !markerSource.includes("color: '#e0554f'")
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
ok('the fantasy gap starts with a real dragon glyph', PIN_ICONS.includes('fantasy-dragon'))

console.log('')
console.log('-- starter presets: many, and covering the categories Dan asked for --')
ok('banks and shops have one shared color language', COMMON_PLACE_PIN_COLORS.bank === 'gold' && COMMON_PLACE_PIN_COLORS.shop === 'blue')
ok('a generous list, not one-per-category minimum', PIN_PRESETS.length >= 10)
for (const want of ['Home', 'Bank', 'Healer', 'Guild', 'Hunting Spot', 'Return Point', 'Dragon']) {
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

console.log('')
console.log('-- one source for what a bank looks like --')
{
  // Increment I2 went looking for a contradiction between the pin presets and
  // the map's own place colours, and did not find one: `mapPlaceColors.ts`
  // already holds the single table, and the pin presets, the automatic
  // landmarks and Quick Travel all read it. So this is not a fix, it is the
  // guard the fix never got. The contradiction is cheap to reintroduce by
  // typing 'gold' in one of the three, and nothing would have said so.
  const consumers = [
    'src/lib/mapPins.ts',
    'src/lib/mapLandmarks.ts',
    'src/components/shared/QuickTravel.tsx',
  ]
  const table = readFileSync('src/lib/mapPlaceColors.ts', 'utf8')
  const categories = [...table.matchAll(/^ {2}(\w+): '(\w+)'/gm)].map(([, key]) => key)
  ok(
    'the shared place-colour table still has entries to check',
    categories.length >= 3,
    `${categories.length} categories`
  )
  for (const file of consumers) {
    const source = readFileSync(file, 'utf8')
    ok(`${file} reads the shared place-colour table`, source.includes('COMMON_PLACE_PIN_COLORS'))
    for (const category of categories) {
      // One shape of second opinion: a competing `category: 'colour'` entry,
      // i.e. somebody starting a rival table next to the real one.
      const rivalTable = new RegExp(`\\b${category}\\b[^\\n]{0,24}: '(blue|gold|green|red|purple|slate)'`, 'i')
      ok(`${file} starts no rival table for ${category}`, !rivalTable.test(source))
    }
  }

  // The other shape, and the one that was actually here: presets that belong
  // to a category but type the colour word instead of reading the table. Nine
  // of the ten shop presets did, all of them 'blue', all correct until the day
  // the table changes. A rival-table check cannot see these, because the line
  // says `label: 'Jeweler'` and never says `shop` at all - so count the
  // lookups instead. A sabotage that turns one back into a literal drops the
  // count, which is the point: the number is what disappears when the
  // mechanism breaks.
  const presets = readFileSync('src/lib/mapPins.ts', 'utf8')
  const shopLookups = (presets.match(/COMMON_PLACE_PIN_COLORS\.shop/g) ?? []).length
  ok(
    'every shop preset reads the shared colour rather than typing it',
    shopLookups >= 10,
    `${shopLookups} lookups`
  )
}

{
  // Every pin written before `provenance` existed was made by a person, and a
  // pin the app cannot attribute is one that cannot be safely undone by
  // "remove what the worker added". The migration runs on read rather than
  // once, so a store restored from a backup arrives migrated too - which is
  // what this writes straight into localStorage to check.
  store.clear()
  store.set(
    'drc.pins.v1',
    JSON.stringify({
      'DR:erathi': [
        { id: 'old-1', roomId: 7, zone: '1', label: 'Written before provenance', color: 'blue', createdAt: 1 },
      ],
    })
  )
  const migrated = loadPins(...HERO)
  ok('an old pin still loads', migrated.length === 1, `${migrated.length}`)
  ok('and is attributed to the player', migrated[0].provenance === 'player', String(migrated[0].provenance))

  store.clear()
  const made = addPin(...HERO, { roomId: 8, zone: '1', label: 'By hand', color: 'gold' })
  ok('a new pin with nothing said is the player’s', made[0].provenance === 'player', String(made[0].provenance))

  const promoted = addPin(...HERO, {
    roomId: 9,
    zone: '1',
    label: 'From a claim',
    color: 'purple',
    provenance: 'ai-candidate',
  })
  ok('and one that says otherwise keeps what it said', promoted[1].provenance === 'ai-candidate', String(promoted[1].provenance))
  ok('without changing the pin beside it', promoted[0].provenance === 'player')

  const corpse = setCorpseMarker(...HERO, 10, '1')
  const marker = corpse.find((pin) => pin.system === true)
  ok(
    'the corpse marker the app drops is still the player’s map',
    marker !== undefined && marker.provenance === 'player',
    String(marker && marker.provenance)
  )
  clearCorpseMarker(...HERO)
  store.clear()
}

{
  // #175 finding 3: the saved-pins control announced "1 saved pins".
  //
  // The property is the sentence a screen reader reads, so that is what is
  // asserted - not that the source contains a ternary. One is the only count
  // that can expose it and it is the count nobody sits on, which is how it
  // shipped; the plural cases are here so a fix that hard-codes the singular
  // fails too, rather than trading one wrong announcement for another.
  ok('no saved pins reads as plural', savedPinsLabel(0) === '0 saved pins', savedPinsLabel(0))
  ok('one saved pin reads as singular', savedPinsLabel(1) === '1 saved pin', savedPinsLabel(1))
  ok('two saved pins read as plural', savedPinsLabel(2) === '2 saved pins', savedPinsLabel(2))
  ok('eleven saved pins read as plural', savedPinsLabel(11) === '11 saved pins', savedPinsLabel(11))

  // The label is only worth testing here if the control actually says it.
  // Left as source inspection deliberately: MapPinBar is a component this
  // suite has no renderer for, so this asserts the wiring and the DOM proof
  // is in the increment's own verify line.
  const bar = readFileSync('src/components/shared/MapPinBar.tsx', 'utf8')
  ok(
    'MapPinBar announces the count through savedPinsLabel',
    /savedPinsLabel\(pins\.length\)/.test(bar) && !/saved \$\{/.test(bar) && !/saved pins`/.test(bar),
    'no second copy of the wording in the component'
  )
}

ok('enough was checked for a pass to mean something', checked >= 26, `${checked} assertions`)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
