import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const zone = process.argv[2] ?? '1'
const outputDir = 'data/world/out'
const primitiveWorldPath = join(outputDir, `${zone}-primitive-world.json`)
const outputPath = join(outputDir, `${zone}-node-tethered-world.json`)

execFileSync(process.execPath, ['tools/build-primitive-world-manifest.mjs', zone], { stdio: 'inherit' })
const world = JSON.parse(readFileSync(primitiveWorldPath, 'utf8'))
const nodeIds = new Set(world.cells.map((cell) => cell.id))
const nodes = world.cells.map((cell) => ({
  id: cell.id,
  roomId: cell.roomId,
  title: cell.title,
  anchor: cell.position,
  tetherPolicy: 'authoritative-room-node',
}))

const transitions = world.routes.map((route) => {
  if (!nodeIds.has(route.from) || !nodeIds.has(route.to)) throw new Error(`Route ${route.from} -> ${route.to} has no room node`)
  const from = nodes.find((node) => node.id === route.from).anchor
  const to = nodes.find((node) => node.id === route.to).anchor
  const visualDistanceMetres = Number(Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z).toFixed(2))
  return {
    id: `${route.from}:${route.move}:${route.to}`,
    fromNodeId: route.from,
    toNodeId: route.to,
    command: route.move,
    direction: route.direction,
    presentation: 'animate-then-confirm-node-teleport',
    visualDistanceMetres,
  }
})

const output = {
  schemaVersion: 1,
  model: 'node-tethered-mud-projection',
  generatedFrom: {
    primitiveWorldPath,
    roomTruth: 'Each node is one authoritative MUD room; transitions are graph edges, not free-world pathfinding.',
    actorTruth: 'Live actors are tethered to their reported room node. Local positions are renderer slots only.',
  },
  nodes,
  transitions,
}

mkdirSync(outputDir, { recursive: true })
writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n')
console.log(`wrote node-tethered ${zone} projection: ${nodes.length} room nodes, ${transitions.length} graph transitions`)
