import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const dir = join('node_modules', '.drc-test')
mkdirSync(dir, { recursive: true })
const colorsOut = join(dir, 'mapPlaceColors.mjs')
writeFileSync(colorsOut, ts.transpileModule(readFileSync('src/lib/mapPlaceColors.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText)
const landmarksOut = join(dir, 'mapLandmarks.mjs')
writeFileSync(landmarksOut, ts.transpileModule(readFileSync('src/lib/mapLandmarks.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replace("'./mapPlaceColors'", "'./mapPlaceColors.mjs'"))
const out = join(dir, 'mapStamps.mjs')
writeFileSync(out, ts.transpileModule(readFileSync('src/lib/mapStamps.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replace("'./mapLandmarks'", "'./mapLandmarks.mjs'"))
const { deriveMapStamps } = await import(`${pathToFileURL(out).href}?v=${Date.now()}`)

let failures = 0
const check = (label, value, detail = '') => {
  console.log(`${value ? 'OK  ' : 'FAIL'} ${label.padEnd(58)}${detail}`)
  if (!value) failures++
}
const room = (id, title, x, y, tags = []) => ({ id, uid: null, title, x, y, z: 0, tags })

const sample = [
  room(1, 'River Bank', 0, 0),
  room(2, 'River Shore', 10, 0),
  room(3, 'River Crossing', 20, 0),
  room(4, 'Old Forest Road', 0, 20),
  room(5, 'Old Forest Road', 10, 20),
  room(6, 'Old Forest Road', 20, 20),
]
const first = deriveMapStamps({ zone: 'test', name: 'Test Vale' }, sample)
const second = deriveMapStamps({ zone: 'test', name: 'Test Vale' }, sample)

console.log('-- stable, restrained and factual --')
check('the same zone produces the same stamps every time', JSON.stringify(first) === JSON.stringify(second))
check('maps do not receive a compulsory floating compass', first.every((stamp) => stamp.kind !== 'seal'))
check('repeated water rooms produce a waters stamp', first.some((stamp) => stamp.kind === 'water'))
check('repeated forest rooms produce a woodland stamp', first.some((stamp) => stamp.kind === 'woodland'))
check('a small mixed map receives layered terrain fabric', first.length >= 6 && first.length <= 10, `${first.length} stamps`)
check('small maps include illustrations and background fabric', new Set(first.map((stamp) => stamp.role)).has('illustration') && new Set(first.map((stamp) => stamp.role)).has('background'))
check('every stamp has a finite authored position', first.every((stamp) => Number.isFinite(stamp.x) && Number.isFinite(stamp.y)))
check('facts with the same centroid fan into distinct positions', new Set(first.map((stamp) => `${stamp.x}:${stamp.y}`)).size === first.length)
check('the zone id authors a distinct composition', JSON.stringify(first) !== JSON.stringify(deriveMapStamps({ zone: 'other', name: 'Test Vale' }, sample)))
check('every drawing stays attached to its source geography', first.every((stamp) => Math.min(...sample.map((source) => Math.hypot(stamp.x - source.x, stamp.y - source.y))) <= 34))

console.log('\n-- dense sheets receive repeated cartographic fabric --')
const denseTown = Array.from({ length: 240 }, (_, index) =>
  room(index + 1, `Old Town, ${index % 3 === 0 ? 'Market Street' : index % 3 === 1 ? 'Long Lane' : 'Civic Plaza'}`, (index % 24) * 20, Math.floor(index / 24) * 20)
)
const townStamps = deriveMapStamps({ zone: 'town', name: 'Old Town' }, denseTown)
check('a large town receives dozens of street-lining stamps', townStamps.filter((stamp) => stamp.kind === 'settlement').length >= 22, `${townStamps.filter((stamp) => stamp.kind === 'settlement').length} building groups`)
check('a dense sheet still preserves substantial blank paper', townStamps.length <= 32, `${townStamps.length} total marks`)
check('town fabric is explicitly a faint background layer', townStamps.filter((stamp) => stamp.kind === 'settlement' && stamp.role === 'background').length >= 21)
check('town fabric remains beside its mapped streets', townStamps.every((stamp) => Math.min(...denseTown.map((source) => Math.hypot(stamp.x - source.x, stamp.y - source.y))) <= 34))

const namedFeatures = deriveMapStamps({ zone: 'features', name: 'Pilgrim Road' }, [
  room(1, 'St. Ratha Church', 0, 0),
  room(2, 'Oxenwaithe Bridge', 80, 0),
  room(3, 'Stone Harbor, Pier', 160, 0),
  room(4, 'Baronial Keep, Gatehouse', 240, 0),
])
for (const kind of ['worship', 'bridge', 'harbor', 'fortification']) {
  check(`one named ${kind} can mark its actual place`, namedFeatures.some((stamp) => stamp.kind === kind))
}
check('named landmarks sit on their mapped room', namedFeatures.every((stamp) => namedFeatures.some((source) => source.x === stamp.x && source.y === stamp.y)))
check('named landmarks are rendered as oversized hero art', namedFeatures.filter((stamp) => ['worship', 'bridge', 'harbor', 'fortification'].includes(stamp.kind)).every((stamp) => stamp.role === 'hero'))

const services = deriveMapStamps({ zone: 'services', name: 'Civic Quarter' }, [
  room(1, 'First Provincial Bank, Civic Plaza', 0, 0),
  room(2, 'Empaths Guild, Mercy Lane', 140, 0),
  room(3, 'Moon Mage Academy, Observatory Way', 280, 0),
  room(4, 'Courthouse, Civic Plaza', 420, 0),
])
for (const kind of ['service-bank', 'service-healer', 'service-arcane', 'service-civic']) {
  check(`${kind} receives an oversized generated service drawing`, services.some((stamp) => stamp.kind === kind && stamp.role === 'hero'))
}
check('a sheet never prints more than ten giant landmarks', services.filter((stamp) => stamp.role === 'hero').length <= 10)

console.log('\n-- word boundaries prevent plausible nonsense --')
const astral = deriveMapStamps({ zone: '999', name: 'Microcosm' }, [
  room(1, 'Astral Plane, Pillar of Unity', 0, 0),
  room(2, 'Astral Plane, Pillar of Unity', 10, 0),
])
check('Unity does not contain a hidden city stamp', !astral.some((stamp) => stamp.kind === 'settlement'))
check('one isolated mention cannot rename a whole landscape', !deriveMapStamps({ zone: 'x', name: 'Plain' }, [
  room(1, 'Garden Door', 0, 0),
  room(2, 'Plain Room', 10, 0),
  room(3, 'Plain Room', 20, 0),
]).some((stamp) => stamp.kind === 'woodland'))
check('a street named after a church does not invent a church', !deriveMapStamps({ zone: 'street', name: 'Town' }, [
  room(1, 'Town, Church Street', 0, 0),
  room(2, 'Town, Church Street', 20, 0),
]).some((stamp) => stamp.kind === 'worship'))
check('Bank Street does not invent a bank complex', !deriveMapStamps({ zone: 'bank-street', name: 'Town' }, [
  room(1, 'Crossing, Bank Street', 0, 0),
  room(2, 'Crossing, Bank Street', 20, 0),
]).some((stamp) => stamp.kind === 'service-bank'))
const themedRooms = deriveMapStamps({ zone: 'showrooms', name: 'Market Plaza' }, [
  room(1, 'Market Plaza, Water Room', 0, 0, ['Water Room']),
  room(2, 'Market Plaza, Forest Room', 20, 0, ['Forest Room']),
  room(3, 'Market Plaza, Ocean Room', 40, 0, ['Ocean Room']),
  room(4, 'Market Plaza, River Room', 60, 0, ['River Room']),
  room(5, 'Market Plaza, Armor Room', 80, 0, ['Armor Room']),
  room(6, 'Market Plaza, Office', 100, 0, ['Office']),
])
check('themed indoor rooms do not invent outdoor geography', !themedRooms.some((stamp) => ['water', 'woodland'].includes(stamp.kind)))
check('an armor display room does not become a giant forge', !themedRooms.some((stamp) => stamp.kind === 'service-forge'))
check('a generic office does not become a civic monument', !themedRooms.some((stamp) => stamp.kind === 'service-civic'))
check('a food court does not become a civic monument', !deriveMapStamps({ zone: 'food-court', name: 'Market Plaza' }, [
  room(1, 'Market Plaza, Food Court', 0, 0, ['Food Court']),
]).some((stamp) => stamp.kind === 'service-civic'))
check('the real plaza context still receives settlement ink', themedRooms.some((stamp) => stamp.kind === 'settlement'))

console.log('\n-- specific landscapes stay specific --')
const repeated = (word) => [room(1, word, 0, 0), room(2, word, 10, 0), room(3, word, 20, 0)]
check('marsh country is not flattened into generic water', deriveMapStamps({ zone: 'm', name: 'Marsh' }, repeated('Sedge Marsh')).some((stamp) => stamp.kind === 'wetland'))
check('beaches receive a coast mark', deriveMapStamps({ zone: 'c', name: 'Coast' }, repeated('Crystalline Beach')).some((stamp) => stamp.kind === 'coast'))
check('farmland is distinct from wild woodland', deriveMapStamps({ zone: 'f', name: 'Farm' }, repeated('Barley Field')).some((stamp) => stamp.kind === 'cultivated'))
check('a field of rubble is not imaginary farmland', !deriveMapStamps({ zone: 'r', name: 'Rubble' }, repeated('Field of Rubble')).some((stamp) => stamp.kind === 'cultivated'))
check('snow country receives a frozen mark', deriveMapStamps({ zone: 's', name: 'Snow' }, repeated('Snowy Trail')).some((stamp) => stamp.kind === 'frozen'))
check('barrows describe burial ground, not generic ruins', deriveMapStamps({ zone: 'b', name: 'Barrow' }, repeated('Ancient Barrow')).some((stamp) => stamp.kind === 'burial'))
check('desert country receives a dry-country mark', deriveMapStamps({ zone: 'd', name: 'Desert' }, repeated('Sandy Dune')).some((stamp) => stamp.kind === 'arid'))

console.log('\n-- every shipped map can carry the layer --')
let zones = 0
let terrainZones = 0
let levels = 0
let repeatedCompositions = 0
let busiestComposition = 0
let straySeals = 0
let marketV2Reachable = false
let highlandV2Reachable = false
for (const file of readdirSync('src/data/map').filter((name) => name !== 'index.json')) {
  const zone = JSON.parse(readFileSync(`src/data/map/${file}`, 'utf8'))
  for (const level of [...new Set(zone.rooms.map((r) => r.z ?? 0))]) {
    const rooms = zone.rooms
      .filter((r) => (r.z ?? 0) === level)
      .map((r) => room(r.id, r.name, r.x, r.y, r.label ? [r.label] : []))
    const stamps = deriveMapStamps({ zone: zone.id, name: zone.name }, rooms)
    levels++
    if (stamps.some((stamp) => stamp.kind === 'seal')) straySeals++
    if (stamps.length) terrainZones++
    if (stamps.length >= 4) repeatedCompositions++
    busiestComposition = Math.max(busiestComposition, stamps.length)
    if (stamps.some((stamp) => stamp.kind === 'market' && stamp.role !== 'background' && stamp.variant % 2 === 1)) marketV2Reachable = true
    if (stamps.some((stamp) => stamp.kind === 'highland' && stamp.role === 'background')) highlandV2Reachable = true
  }
  zones++
}
check('all shipped zones were audited', zones >= 85, `${zones}`)
check('no drawable level carries a meaningless compass', straySeals === 0, `${levels} levels`)
check('terrain information appears across most of the world', terrainZones >= 60, `${terrainZones} mapped levels`)
check('many shipped maps receive a multi-stamp composition', repeatedCompositions >= 35, `${repeatedCompositions} mapped levels`)
check('no shipped sheet exceeds the legibility ceiling', busiestComposition <= 64, `${busiestComposition} marks on the busiest sheet`)
check('the approved market replacement is reachable on shipped maps', marketV2Reachable)
check('the approved highland replacement is reachable on shipped maps', highlandV2Reachable)

console.log('\n-- the visual layer stays below function --')
const canvas = readFileSync('src/components/shared/MapCanvas.tsx', 'utf8')
const layer = readFileSync('src/components/shared/MapStampLayer.tsx', 'utf8')
const derivation = readFileSync('src/lib/mapStamps.ts', 'utf8')
check('stamps paint after paper but before the trail', canvas.indexOf('<MapStampLayer') > canvas.indexOf('fill="url(#map-paper)"') && canvas.indexOf('<MapStampLayer') < canvas.indexOf('segments(trail)'))
check('stamps can never intercept map interaction', layer.includes('pointer-events-none') && layer.includes('aria-hidden="true"'))
check('every impression identifies its stamp family for live QA', layer.includes('data-map-stamp-kind'))
check('every impression declares background, illustration, or hero role', layer.includes('data-map-stamp-role'))
check('layout never searches blank paper or globally spreads stamps', !derivation.includes('illustrationPoint') && !derivation.includes('spreadStamps') && derivation.includes('structuralPlacement'))
check('map art uses generated raster engravings', layer.includes('<image') && layer.includes('STAMP_ART') && layer.includes('href={image.href}'))
check('featured art has deterministic variant selection', layer.includes('featuredVariants[stamp.variant % featuredVariants.length]'))
check('the primitive path renderer has been removed', !layer.includes('<path') && !layer.includes('<circle') && !layer.includes('<text') && !layer.includes('function Tree') && !layer.includes('function Peak') && !layer.includes('MapDrawing'))
check('engraved ink is integrated into parchment', layer.includes("mixBlendMode: 'multiply'") && layer.includes('preserveAspectRatio="xMidYMid meet"'))
check('pixel-rejected atlas crops are recorded with reasons', layer.includes('REJECTED_STAMP_ART') && layer.includes('adjacent roof fragment') && layer.includes('second cut-off ridge'))
const runtimeCatalog = layer.slice(layer.indexOf('const STAMP_ART'), layer.indexOf('/**\n * Pictorial cartography'))
check('rejected atlas crops cannot be selected at runtime', !runtimeCatalog.includes("atlas/13.png") && !runtimeCatalog.includes("atlas/21.png"))
for (const assetPath of ['public/map-stamps/market-v2.png', 'public/map-stamps/highland-v2.png']) {
  const asset = existsSync(assetPath) ? readFileSync(assetPath) : Buffer.alloc(0)
  check(`${assetPath.split('/').pop()} is a reviewed transparent replacement`, asset.length > 100_000 && asset[25] === 6 && layer.includes(`/${assetPath.replace('public/', '')}`), `${asset.length} bytes`)
}
const stampKinds = ['water', 'woodland', 'highland', 'underground', 'settlement', 'ruins', 'wetland', 'coast', 'arid', 'cultivated', 'frozen', 'burial', 'worship', 'fortification', 'bridge', 'harbor', 'market', 'service-bank', 'service-healer', 'service-guild', 'service-inn', 'service-forge', 'service-library', 'service-training', 'service-gate', 'service-arcane', 'service-civic']
for (const kind of stampKinds) {
  const assetPath = `public/map-stamps/${kind}.png`
  const asset = existsSync(assetPath) ? readFileSync(assetPath) : Buffer.alloc(0)
  const pngSignature = asset.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
  const colorType = asset.length > 25 ? asset[25] : -1
  check(`${kind} has a generated transparent PNG`, layer.includes(`'/map-stamps/${kind}.png'`) && pngSignature && [4, 6].includes(colorType) && statSync(assetPath).size > 10_000)
}
for (let index = 1; index <= 30; index++) {
  const name = String(index).padStart(2, '0')
  const assetPath = `public/map-stamps/atlas/${name}.png`
  const asset = existsSync(assetPath) ? readFileSync(assetPath) : Buffer.alloc(0)
  const isRejected = index === 13 || index === 21
  check(
    `Magnific atlas cell ${name} is a transparent ${isRejected ? 'retained source asset' : 'runtime asset'}`,
    asset.length > 10_000 && asset[25] === 6 && (isRejected || runtimeCatalog.includes(`/map-stamps/atlas/${name}.png`)),
    `${asset.length} bytes`
  )
}
check('gateway destinations are visibly continued off the sheet', canvas.includes('data-map-gateway-callout="true"') && canvas.includes('shortGatewayLabel') && canvas.includes('hasGatewaysOnLevel'))
check('duplicate gateways share one destination label', canvas.includes('byDestination') && canvas.includes('candidates.reduce'))
check('fit shows the whole connected sheet instead of cropping it', canvas.includes("preserveAspectRatio: 'xMidYMid meet'") && !canvas.includes("preserveAspectRatio: 'xMidYMid slice'"))

if (failures) process.exit(1)
console.log('\nall map stamp checks passed')
