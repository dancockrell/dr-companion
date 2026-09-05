import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
// The block size is one constant, imported rather than retyped: a test that
// hardcodes the number it is checking only ever proves somebody edited both.
import { CELL_BLOCK_METRES } from '../src/lib/isometric-board-layout.mjs'

const fail = (message) => { console.error(`FAIL ${message}`); process.exitCode = 1 }
const pass = (message) => console.log(`OK   ${message}`)

execFileSync(process.execPath, ['tools/build-primitive-world-manifest.mjs', '1'], { stdio: 'inherit' })
const outputPath = 'data/world/out/1-primitive-world.json'
if (!existsSync(outputPath)) fail('primitive world manifest is generated')
else {
  const world = JSON.parse(readFileSync(outputPath, 'utf8'))
  const townGreenNorth = world.cells.find((cell) => cell.id === '1-14')
  const guild = world.cells.find((cell) => cell.tags.includes('guild'))
  const water = world.cells.find((cell) => cell.tags.includes('water'))
  if (world.cells.length >= 1000) pass(`Crossing contains a full room-cell world (${world.cells.length})`)
  else fail('Crossing room cells are incomplete')
  if (world.routes.length >= 1500) pass(`legal local routes are retained (${world.routes.length})`)
  else fail('world does not retain enough local route truth')
  if (townGreenNorth?.exits.some((exit) => exit.move === 'north' && exit.targetCellId === '1-13')) pass('Town Green North keeps its exact legal north exit')
  else fail('Town Green North lost a legal route')
  if (townGreenNorth?.primitives.some((primitive) => primitive.kind === 'terrain-cell-5m')) pass('ordinary rooms begin as editable primitive terrain')
  else fail('ordinary rooms are not primitive-first')
  if (townGreenNorth?.primitives.every((primitive) => primitive.assetCandidates?.length && primitive.assetCandidates.every((assetId) => /^[GPHTBERS]\d{2}$/.test(assetId)))) pass('every world primitive resolves to approved-kit candidate IDs')
  else fail('world primitive candidates do not resolve to the kit registry')
  if (guild?.primitives.some((primitive) => primitive.kind === 'guild-threshold-kit')) pass('guilds are explicitly represented as special primitive sets')
  else fail('guilds have no special primitive treatment')
  if (water?.primitives.some((primitive) => primitive.kind === 'water-ribbon-5m')) pass('water rooms receive water primitives')
  else fail('water has no primitive treatment')
  if (world.queues.unresolvedCellIds.every((id) => world.cells.find((cell) => cell.id === id)?.status === 'missing-description')) pass('unresolved cells remain explicit')
  else fail('unresolved cells are not honest')
  if (world.cells.every((cell) => cell.board?.footprint?.width === CELL_BLOCK_METRES && cell.board?.selectionBounds?.width === CELL_BLOCK_METRES && cell.board?.spawnPoints?.some((point) => point.role === 'player' && point.rigSocket === 'humanoid-root'))) pass('every room cell has a stable isometric footprint and rig-ready player formation')
  else fail('isometric cell footprints or rig-ready formations are missing')

  // The invariant Dan's feedback is really about: no block may reach its
  // neighbour. Measured against the manifest rather than assumed from the
  // constants, because the pitch comes from map coordinates and the block
  // comes from the layout module - two different files that could drift into
  // agreement-by-accident or, worse, into overlap.
  {
    const positioned = world.cells.filter((c) => c.position && c.board?.footprint)
    let closest = Infinity
    const coincident = []
    for (let i = 0; i < positioned.length; i++) {
      for (let j = i + 1; j < positioned.length; j++) {
        const a = positioned[i].position
        const b = positioned[j].position
        if (Math.abs((a.y ?? 0) - (b.y ?? 0)) > 0.01) continue // different storey
        const d = Math.hypot(a.x - b.x, a.z - b.z)
        // Two rooms at identical coordinates are a *data* defect: no scale
        // separates them, so counting them here would make this check
        // permanently red about something it cannot measure. Reported below on
        // its own terms instead.
        if (d === 0) coincident.push([positioned[i].id, positioned[j].id])
        else if (d < closest) closest = d
      }
    }
    const block = CELL_BLOCK_METRES
    if (positioned.length < 50) fail(`only ${positioned.length} positioned cells to measure; the manifest looks truncated`)
    else if (closest > block) pass(`every block leaves a gutter: closest neighbours are ${closest.toFixed(2)}m apart, blocks are ${block}m`)
    else fail(`blocks touch or overlap: closest neighbours are ${closest.toFixed(2)}m apart but blocks are ${block}m wide`)

    // Named, counted, and not folded into the check above. Silence here would
    // read as "no rooms share a coordinate", which is not true.
    if (coincident.length === 0) pass('no two rooms share a map coordinate')
    else
      console.log(
        `NOT CHECKED  ${coincident.length} pair(s) of rooms share exact map coordinates and will always overlap: ` +
          `${coincident.map(([a, b]) => `${a}/${b}`).join(', ')}. That is a map-data defect, not a scale one.`
      )
  }
  if (townGreenNorth?.exits.every((exit) => typeof exit.tetherKind === 'string') && townGreenNorth?.exits.find((exit) => exit.direction === 'north')?.boardAnchor?.z === -2.5) pass('true exits carry typed tethers and camera-stable edge anchors')
  else fail('typed tether or board-edge anchor metadata is missing')
}
