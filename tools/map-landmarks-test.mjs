import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const dir = join('node_modules', '.drc-test')
mkdirSync(dir, { recursive: true })
const colorsOut = join(dir, 'mapPlaceColors.mjs')
writeFileSync(colorsOut, ts.transpileModule(readFileSync('src/lib/mapPlaceColors.ts', 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    // Deterministic output: every relative specifier comes out `.js` whatever
    // the source wrote. The string patches below are stubbing work and can
    // only stay correct if what they match does not follow src/'s import
    // style. It used to, and C14 changing that style broke six suites at once.
    rewriteRelativeImportExtensions: true,
  },
}).outputText)
const out = join(dir, 'mapLandmarks.mjs')
writeFileSync(out, ts.transpileModule(readFileSync('src/lib/mapLandmarks.ts', 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    // Deterministic output: every relative specifier comes out `.js` whatever
    // the source wrote. The string patches below are stubbing work and can
    // only stay correct if what they match does not follow src/'s import
    // style. It used to, and C14 changing that style broke six suites at once.
    rewriteRelativeImportExtensions: true,
  },
}).outputText.replace('./mapPlaceColors.js', './mapPlaceColors.mjs'))
const { landmarkFor, landmarksFor } = await import(pathToFileURL(out).href)

let checked = 0
let failures = 0
const check = (label, value) => {
  checked++
  console.log(`${value ? 'OK  ' : 'FAIL'} ${label}`)
  if (!value) failures++
}
const room = (title, tags = []) => ({ id: 1, uid: null, title, tags, x: 0, y: 0, z: 0 })

const bank = landmarkFor(room('Teller', ['Bank']))
check('a bank becomes a gold bank landmark', bank?.kind === 'bank' && bank.color === 'gold')
check('a hospital outranks its shop wording', landmarkFor(room('Herbal Remedies Shop', ['Hospital']))?.kind === 'healer')
check('a guild room becomes a guild landmark', landmarkFor(room("Bards' Guild"))?.kind === 'guild')
check('a dock gets its own boat-travel landmark', landmarkFor(room('Uaro Dock'))?.kind === 'dock')
const weaponKind = landmarkFor(room("Milgrym's Weapons", ['shop']))?.kind
const alchemyKind = landmarkFor(room('Alchemy Society, Workroom'))?.kind
check(`a weapon shop is not flattened into generic retail (${weaponKind})`, weaponKind === 'weapon')
check(`an alchemy workroom is not flattened into generic crafting (${alchemyKind})`, alchemyKind === 'alchemy')
check('gateway metadata can identify a terse portal room', landmarkFor({ ...room('Shimmering Chamber'), gateway: { zone: 'Taisidon', name: 'portal' } })?.kind === 'portal')
check('a smithy becomes a crafting landmark', landmarkFor(room("Tobb's Smithy"))?.kind === 'craft')
check('a goblin area becomes a hunting landmark', landmarkFor(room('Wild Goblins'))?.kind === 'hunt')
check('an ordinary street stays ordinary', landmarkFor(room('Magen Road')) === null)
check('Bank Street is a street, not a bank', landmarkFor(room('The Crossing, Bank Street')) === null)
check('Ratha Bank Street is a street, not a bank', landmarkFor(room('Ratha, Bank Street')) === null)
check('Market Road is a road, not a shop', landmarkFor(room('Outer Hibarnhvidar, Market Road')) === null)
check('Temple Hill Lane is a lane, not a temple', landmarkFor(room('Temple Hill, Temple Hill Lane')) === null)
check('a real bank before the comma remains a bank', landmarkFor(room('First Provincial Bank, Lobby'))?.kind === 'bank')
const shop = landmarkFor(room('General Store', ['shop']))
check('a shop becomes a blue shop landmark', shop?.kind === 'shop' && shop.color === 'blue')
check('a real guild before the comma remains a guild', landmarkFor(room("Paladins' Guild, Sentinel's Way"))?.kind === 'guild')
check('an office has a distinct public-office symbol', landmarkFor(room('Estate Holder Office'))?.kind === 'office')
check('a courthouse has a distinct justice symbol', landmarkFor(room('Provincial Courthouse'))?.kind === 'justice')
check('a food court is not a courthouse', landmarkFor(room('Market Plaza, Food Court', ['Food Court']))?.kind !== 'justice')
check('a locksmith is not flattened into a generic shop', landmarkFor(room("Ragge's Locksmith", ['shop']))?.kind === 'locksmith')
check('a jeweler is not flattened into a generic shop', landmarkFor(room("Arthe Dale Jewelers", ['shop']))?.kind === 'jeweler')
check('a tailor is not flattened into a generic shop', landmarkFor(room("Marcipur's Stitchery", ['tailor', 'shop']))?.kind === 'tailor')
check('a bakery gets a food landmark', landmarkFor(room("Tiv's Bakery"))?.kind === 'food')
check('a stable gets a stable landmark', landmarkFor(room('North Gate Stables'))?.kind === 'stable')
check('a theatre gets a performance landmark', landmarkFor(room('Theatre of the Moon'))?.kind === 'performance')
check('a bathhouse gets a bath landmark', landmarkFor(room('Public Bathhouse'))?.kind === 'bath')
check('an auction house is not flattened into a generic shop', landmarkFor(room('Crossing Auction House', ['shop']))?.kind === 'auction')
check('a warehouse gets a storage landmark', landmarkFor(room('Shipping Warehouse'))?.kind === 'storage')
check('one room never receives an overlapping pile of automatic pins', landmarksFor(room('Temple Grounds, Entry Gates', ['temple', 'gate'])).length === 1)

/*
 * Six source checks stood here, against MapCanvas.tsx and RoomHoverCard.tsx:
 * how automatic landmarks layered under saved pins, and what a room tooltip
 * said. Both files are gone with the map (docs/NO-3D.md).
 *
 * They were deleted rather than pointed somewhere else. What they asserted
 * was about drawing, and nothing in this app draws a map now. The landmark
 * *vocabulary* they rested on is what survives, because
 * tools/build-world-content.mjs and tools/build-scene-registry.mjs read it
 * to build what Godot consumes - and that is exactly what every check above
 * this line tests. tools/world-content-test.mjs and
 * tools/scene-editor-test.mjs check the consuming side.
 */

console.log('')
// Far below the real count on purpose: a tripwire for a truncated or
// half-loaded run, not a regression test on the number of cases.
const MIN_EXPECTED = 24
if (checked < MIN_EXPECTED) {
  console.error(`FAILED: only ${checked} checks ran, expected at least ${MIN_EXPECTED}`)
  process.exit(1)
}
// `checked`, not a pass count: the denominator has to be the number of
// checks that ran, or it shrinks by one per failure and reports a smaller
// suite on exactly the run where you need to know the size did not change.
console.log(`${checked} checked, ${failures} failed`)
if (failures) {
  console.error('FAILED')
  process.exit(1)
}
console.log('all passed')
