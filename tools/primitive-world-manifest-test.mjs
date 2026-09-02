import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

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
  if (guild?.primitives.some((primitive) => primitive.kind === 'guild-threshold-kit')) pass('guilds are explicitly represented as special primitive sets')
  else fail('guilds have no special primitive treatment')
  if (water?.primitives.some((primitive) => primitive.kind === 'water-ribbon-5m')) pass('water rooms receive water primitives')
  else fail('water has no primitive treatment')
  if (world.queues.unresolvedCellIds.every((id) => world.cells.find((cell) => cell.id === id)?.status === 'missing-description')) pass('unresolved cells remain explicit')
  else fail('unresolved cells are not honest')
}
