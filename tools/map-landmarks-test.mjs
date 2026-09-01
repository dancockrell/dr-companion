import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const dir = join('node_modules', '.drc-test')
mkdirSync(dir, { recursive: true })
const out = join(dir, 'mapLandmarks.mjs')
writeFileSync(out, ts.transpileModule(readFileSync('src/lib/mapLandmarks.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText)
const { landmarkFor, landmarksFor } = await import(pathToFileURL(out).href)

let failures = 0
const check = (label, value) => {
  console.log(`${value ? 'OK  ' : 'FAIL'} ${label}`)
  if (!value) failures++
}
const room = (title, tags = []) => ({ id: 1, uid: null, title, tags, x: 0, y: 0, z: 0 })

check('a bank becomes a bank landmark', landmarkFor(room('Teller', ['Bank']))?.kind === 'bank')
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
check('a real guild before the comma remains a guild', landmarkFor(room("Paladins' Guild, Sentinel's Way"))?.kind === 'guild')
check('an office has a distinct public-office symbol', landmarkFor(room('Estate Holder Office'))?.kind === 'office')
check('a courthouse has a distinct justice symbol', landmarkFor(room('Provincial Courthouse'))?.kind === 'justice')
check('one room never receives an overlapping pile of automatic pins', landmarksFor(room('Temple Grounds, Entry Gates', ['temple', 'gate'])).length === 1)

const canvas = readFileSync('src/components/shared/MapCanvas.tsx', 'utf8')
const hoverCard = readFileSync('src/components/shared/RoomHoverCard.tsx', 'utf8')
check('automatic landmarks render below saved pins', canvas.indexOf('Automatic world landmarks') < canvas.indexOf('A saved place'))
check('automatic landmarks do not add a second persistent pin bar', !canvas.includes('Landmarks · hover for meaning'))
check('every room tooltip offers an Elanthipedia lookup', hoverCard.includes('Look up this place on Elanthipedia') && hoverCard.includes('Special:Search'))

if (failures) process.exit(1)
console.log('\nall map landmark checks passed')
