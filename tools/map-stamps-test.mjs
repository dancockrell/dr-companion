import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const dir = join('node_modules', '.drc-test')
mkdirSync(dir, { recursive: true })
const out = join(dir, 'mapStamps.mjs')
writeFileSync(out, ts.transpileModule(readFileSync('src/lib/mapStamps.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText)
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
check('every mapped level receives one cartographer seal', first.filter((stamp) => stamp.kind === 'seal').length === 1)
check('repeated water rooms produce a waters stamp', first.some((stamp) => stamp.kind === 'water'))
check('repeated forest rooms produce a woodland stamp', first.some((stamp) => stamp.kind === 'woodland'))
check('no more than four terrain facts compete with the seal', first.length <= 5, `${first.length} stamps`)
check('every stamp has a finite authored position', first.every((stamp) => Number.isFinite(stamp.x) && Number.isFinite(stamp.y)))
check('facts with the same centroid fan into distinct positions', new Set(first.map((stamp) => `${stamp.x}:${stamp.y}`)).size === first.length)

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

console.log('\n-- every shipped map can carry the layer --')
let zones = 0
let terrainZones = 0
let levels = 0
const missingSeals = []
for (const file of readdirSync('src/data/map').filter((name) => name !== 'index.json')) {
  const zone = JSON.parse(readFileSync(`src/data/map/${file}`, 'utf8'))
  for (const level of [...new Set(zone.rooms.map((r) => r.z ?? 0))]) {
    const rooms = zone.rooms
      .filter((r) => (r.z ?? 0) === level)
      .map((r) => room(r.id, r.name, r.x, r.y, r.label ? [r.label] : []))
    const stamps = deriveMapStamps({ zone: zone.id, name: zone.name }, rooms)
    levels++
    if (rooms.length > 0 && !stamps.some((stamp) => stamp.kind === 'seal')) missingSeals.push(`${zone.id}:${level}`)
    if (stamps.some((stamp) => stamp.kind !== 'seal')) terrainZones++
  }
  zones++
}
check('all shipped zones were audited', zones >= 85, `${zones}`)
check('every drawable level carries its zone seal', missingSeals.length === 0, `${levels} levels${missingSeals.length ? `, missing ${missingSeals.join(', ')}` : ''}`)
check('terrain information appears across most of the world', terrainZones >= 60, `${terrainZones} mapped levels`)

console.log('\n-- the visual layer stays below function --')
const canvas = readFileSync('src/components/shared/MapCanvas.tsx', 'utf8')
const layer = readFileSync('src/components/shared/MapStampLayer.tsx', 'utf8')
check('stamps paint after paper but before the trail', canvas.indexOf('<MapStampLayer') > canvas.indexOf('fill="url(#map-paper)"') && canvas.indexOf('<MapStampLayer') < canvas.indexOf('segments(trail)'))
check('stamps can never intercept map interaction', layer.includes('pointer-events-none') && layer.includes('aria-hidden="true"'))

if (failures) process.exit(1)
console.log('\nall map stamp checks passed')
