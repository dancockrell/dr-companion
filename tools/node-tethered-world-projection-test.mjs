import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const fail = (message) => { console.error(`FAIL ${message}`); process.exitCode = 1 }
const pass = (message) => console.log(`OK   ${message}`)
const outputPath = 'data/world/out/1-node-tethered-world.json'

execFileSync(process.execPath, ['tools/build-node-tethered-world-projection.mjs', '1'], { stdio: 'inherit' })
if (!existsSync(outputPath)) fail('the node-tethered projection is generated')
else {
  const projection = JSON.parse(readFileSync(outputPath, 'utf8'))
  const nodeIds = new Set(projection.nodes.map((node) => node.id))
  const townGreenNorth = projection.nodes.find((node) => node.id === '1-14')
  const north = projection.transitions.find((transition) => transition.fromNodeId === '1-14' && transition.command === 'north')
  if (projection.model === 'node-tethered-mud-projection') pass('world projection declares discrete MUD node semantics')
  else fail('projection does not declare node-tethered MUD semantics')
  if (projection.nodes.length === 1060 && projection.transitions.length === 2389) pass('projection retains every Crossing room node and legal local graph edge')
  else fail('projection count diverges from the authoritative primitive world')
  if (projection.nodes.every((node) => node.tetherPolicy === 'authoritative-room-node' && Number.isFinite(node.anchor.x) && Number.isFinite(node.anchor.y) && Number.isFinite(node.anchor.z))) pass('each room has one finite, authoritative presentation anchor')
  else fail('room anchors or tether policy are invalid')
  if (north?.toNodeId === '1-13' && townGreenNorth?.roomId === 14) pass('Town Green North keeps its true north graph transition')
  else fail('Town Green North lost its authoritative north transition')
  if (projection.transitions.every((transition) => nodeIds.has(transition.fromNodeId) && nodeIds.has(transition.toNodeId) && transition.presentation === 'animate-then-confirm-node-teleport')) pass('every animated transition remains a confirmed graph-node teleport')
  else fail('a transition implies free-world traversal or an unknown node')
}
