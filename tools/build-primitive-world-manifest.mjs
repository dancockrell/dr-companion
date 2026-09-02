import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const zone = process.argv[2] ?? '1'
const briefsPath = 'data/art/out/geometric-room-briefs.json'
const outputDir = 'data/world/out'
const outputPath = join(outputDir, `${zone}-primitive-world.json`)
const reviewPath = join(outputDir, `${zone}-primitive-world-review.md`)

// Keep the world artifact deterministic: it is an editable, Godot-friendly
// arrangement of primitives, not an imported scene reconstruction.
execFileSync(process.execPath, ['tools/build-geometric-room-briefs.mjs'], { stdio: 'inherit' })
const catalogue = JSON.parse(readFileSync(briefsPath, 'utf8'))
const cellsForZone = catalogue.roomBriefs
  .filter((brief) => brief.zone === zone && brief.map)
  .sort((a, b) => a.roomId - b.roomId)

if (!cellsForZone.length) throw new Error(`No mapped room cells found for zone ${zone}`)

const minX = Math.min(...cellsForZone.map((cell) => cell.map.x))
const minY = Math.min(...cellsForZone.map((cell) => cell.map.y))
const maxX = Math.max(...cellsForZone.map((cell) => cell.map.x))
const maxY = Math.max(...cellsForZone.map((cell) => cell.map.y))
const localIds = new Set(cellsForZone.map((cell) => cell.id))
const mapUnitToMetres = 0.25

const primitiveRecipe = (cell) => {
  const tags = cell.classification.tags
  const items = [{ kind: cell.classification.spatialMode === 'interior-cutaway' ? 'interior-floor-5m' : 'terrain-cell-5m', role: 'base' }]
  if (cell.classification.spatialMode === 'interior-cutaway') items.push({ kind: 'cutaway-wall-kit', role: 'shell' })
  else items.push({ kind: 'rough-edge-boundary-kit', role: 'boundary' })
  if (tags.includes('water')) items.push({ kind: 'water-ribbon-5m', role: 'landform' })
  if (tags.includes('bridge')) items.push({ kind: 'bridge-span-5m', role: 'landform' })
  if (cell.classification.tier === 'special') items.push({ kind: 'special-landmark-silhouette', role: 'landmark' })
  if (tags.includes('guild')) items.push({ kind: 'guild-threshold-kit', role: 'landmark' })
  if (tags.includes('sacred')) items.push({ kind: 'sacred-threshold-kit', role: 'landmark' })
  if (tags.includes('market')) items.push({ kind: 'market-canopy-kit', role: 'landmark' })
  if (tags.includes('banking')) items.push({ kind: 'civic-vault-threshold-kit', role: 'landmark' })
  return items
}

const palette = (cell) => {
  const tags = cell.classification.tags
  if (cell.briefStatus === 'missing-description') return 'neutral-unresolved'
  if (cell.classification.spatialMode === 'interior-cutaway') return 'warm-interior'
  if (tags.includes('water')) return 'river-blue-green'
  if (tags.includes('sacred')) return 'quiet-stone-jewel'
  if (tags.includes('guild')) return 'district-service'
  return 'crossing-ground-street'
}

const worldPosition = (map) => ({
  x: Number(((map.x - minX) * mapUnitToMetres).toFixed(2)),
  y: Number(((map.z ?? 0) * 5).toFixed(2)),
  z: Number((-(map.y - minY) * mapUnitToMetres).toFixed(2)),
})

const cells = cellsForZone.map((cell) => ({
  id: cell.id,
  roomId: cell.roomId,
  title: cell.title,
  position: worldPosition(cell.map),
  sourceGrid: { x: cell.map.x, y: cell.map.y, z: cell.map.z ?? 0 },
  status: cell.briefStatus,
  sourceDescriptionId: cell.sourceDescriptionId,
  sourceDescriptionHash: cell.sourceDescriptionHash,
  tier: cell.classification.tier,
  tags: cell.classification.tags,
  spatialMode: cell.classification.spatialMode,
  palette: palette(cell),
  primitives: primitiveRecipe(cell),
  exits: cell.map.exits.map((exit) => ({
    move: exit.move,
    direction: exit.dir,
    targetRoomId: exit.to,
    targetCellId: typeof exit.to === 'number' && localIds.has(`${zone}-${exit.to}`) ? `${zone}-${exit.to}` : null,
  })),
}))

const routes = cells.flatMap((cell) => cell.exits
  .filter((exit) => exit.targetCellId)
  .map((exit) => ({ from: cell.id, to: exit.targetCellId, move: exit.move, direction: exit.direction })))

const specialCellIds = cells.filter((cell) => cell.tier === 'special').map((cell) => cell.id)
const featureCellIds = cells.filter((cell) => cell.tier === 'feature').map((cell) => cell.id)
const unresolvedCellIds = cells.filter((cell) => cell.status === 'missing-description').map((cell) => cell.id)

const output = {
  schemaVersion: 1,
  generatedFrom: {
    roomBriefCatalogue: briefsPath,
    zone,
    mapUnitToMetres,
    coordinateConvention: 'DragonRealms map x becomes Godot x; inverted map y becomes Godot z; map level becomes 5m y steps.',
  },
  bounds: {
    source: { minX, minY, maxX, maxY },
    metres: { width: Number(((maxX - minX) * mapUnitToMetres).toFixed(2)), depth: Number(((maxY - minY) * mapUnitToMetres).toFixed(2)) },
  },
  cells,
  routes,
  queues: { specialCellIds, featureCellIds, unresolvedCellIds },
}

mkdirSync(outputDir, { recursive: true })
writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n')

const label = catalogue.briefs.find((brief) => brief.zone === zone)?.zoneName ?? `zone ${zone}`
writeFileSync(reviewPath, [
  `# ${label} primitive world`,
  '',
  'Generated Godot handoff. Every cell is a deterministic primitive assembly; material/hero-prop passes may refine a cell later without moving its truth-bearing exits.',
  '',
  `- Cells: ${cells.length}`,
  `- Legal local routes: ${routes.length}`,
  `- Special cells: ${specialCellIds.length}`,
  `- Bridge/water/interior feature cells: ${featureCellIds.length}`,
  `- Explicitly unresolved cells: ${unresolvedCellIds.length}`,
  `- World bounds: ${output.bounds.metres.width}m × ${output.bounds.metres.depth}m`,
  '',
].join('\n'))

console.log(`wrote ${label} primitive world: ${cells.length} cells, ${routes.length} local routes`)
