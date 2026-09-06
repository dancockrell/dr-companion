import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
// The block size is one constant, imported rather than retyped: a test that
// hardcodes the number it is checking only ever proves somebody edited both.
import { CELL_BLOCK_METRES, CELL_PITCH_METRES, packedRoomPositions } from '../src/lib/isometric-board-layout.mjs'

const fail = (message) => { console.error(`FAIL ${message}`); process.exitCode = 1 }
const pass = (message) => console.log(`OK   ${message}`)

const packingFixture = [{ id: 1, x: 0, y: 0 }, { id: 2, x: 40, y: 0 }, { id: 3, x: 0, y: 0 }, { id: 4, x: 0, y: 0, z: 1 }]
const interiorFixture = [
  {id:1,name:'Smith, Salesroom',x:0,y:0,exits:[{move:'out',to:3},{move:'go doorway',to:2}]},
  {id:2,name:'Smith, Workroom',x:400,y:0,exits:[{move:'out',to:1}]},
  {id:3,name:'Town, Street',x:0,y:40,exits:[{move:'go shop',to:1}]},
]
const beforeInterior = packedRoomPositions(interiorFixture.map(({name,...room})=>room))
const afterInterior = packedRoomPositions(interiorFixture)
const separation = (positions,a,b) => Math.hypot(positions.get(a).x-positions.get(b).x,positions.get(a).z-positions.get(b).z)
if (separation(afterInterior,1,2) < separation(beforeInterior,1,2) &&
    JSON.stringify(afterInterior.get(1)) === JSON.stringify(beforeInterior.get(1)))
  pass('internal workroom compacts while external-facing salesroom stays fixed')
else fail('interior compaction moves entrance or fails to reduce separation')
for (const variant of [
  interiorFixture.map(r=>r.id===2?{...r,name:'Other, Workroom'}:r),
  interiorFixture.map(r=>r.id===2?{...r,exits:[]}:r),
  interiorFixture.map(r=>r.id===1?{...r,exits:[{move:'out',to:3},{move:'go portal',to:2}]}:r),
]) {
  const unchanged = packedRoomPositions(variant.map(({name,...room})=>room))
  if (JSON.stringify([...packedRoomPositions(variant)]) === JSON.stringify([...unchanged]))
    pass('unrelated, one-way and magical connections do not infer interior proximity')
  else fail('ineligible connection changed interior placement')
}
const packed = packedRoomPositions(packingFixture)
if (packed.get(1).x === 0 && packed.get(2).x === CELL_PITCH_METRES) pass('adjacent source street slots have exactly one presentation pitch')
else fail('street slots are not compact')
if (new Set([...packed.values()].map(p => `${p.x},${p.y},${p.z}`)).size === 4) pass('coincident source rooms retain distinct physical slots')
else fail('packing overlaps coincident source rooms')
if (JSON.stringify([...packed]) === JSON.stringify([...packedRoomPositions([...packingFixture].reverse())])) pass('packing is independent of input order')
else fail('packing depends on input ordering')
if (packed.get(4).y === 5 && packed.get(4).x === 0 && packed.get(4).z === 0) pass('different floors can reuse a horizontal slot')
else fail('packing loses vertical floor identity')

// Packed presentation now separates the old coincident source nodes too.
const KNOWN_COINCIDENT = [
]

execFileSync(process.execPath, ['tools/build-primitive-world-manifest.mjs', '1'], { stdio: 'inherit' })
const outputPath = 'data/world/out/1-primitive-world.json'
if (!existsSync(outputPath)) fail('primitive world manifest is generated')
else {
  const world = JSON.parse(readFileSync(outputPath, 'utf8'))
  const townGreenNorth = world.cells.find((cell) => cell.id === '1-14')
  const byId = new Map(world.cells.map(c => [c.id, c]))
  const rejected = byId.get('1-656')
  if (rejected.status === 'missing-description' && rejected.sourceDescriptionId === null &&
      rejected.rejectedSourceDescriptionId === '1::Workroom' &&
      rejected.descriptionBindingStatus === 'rejected-title-family-mismatch' &&
      rejected.palette === 'neutral-unresolved' && rejected.exits.length > 0)
    pass('rejected workroom source remains unresolved with evidence and real exits in runtime manifest')
  else fail('runtime manifest loses description rejection or real graph')
  const compass = { north: [0, -1], northeast: [1, -1], east: [1, 0], southeast: [1, 1], south: [0, 1], southwest: [-1, 1], west: [-1, 0], northwest: [-1, -1] }
  const rooms = world.cells.map(cell => ({ id: cell.roomId, ...cell.sourceGrid,
    name: cell.title,
    exits: cell.exits.map(exit => ({ move: exit.move, to: exit.targetRoomId })) }))
  const seeds = packedRoomPositions(rooms.map(({ exits, ...room }) => room))
  const repaired = packedRoomPositions(rooms)
  let oldBad = 0, newBad = 0, regressions = 0
  for (const room of rooms) for (const exit of room.exits) {
    if (!compass[exit.move] || !seeds.has(exit.to)) continue
    const [dx, dz] = compass[exit.move]
    const metric = map => {
      const a = map.get(room.id), b = map.get(exit.to)
      if (a.y !== b.y) return null
      return { correct: Math.sign(b.x-a.x) === dx && Math.sign(b.z-a.z) === dz,
        exact: b.x-a.x === dx*CELL_PITCH_METRES && b.z-a.z === dz*CELL_PITCH_METRES }
    }
    const before = metric(seeds), after = metric(repaired)
    if (!before) continue
    oldBad += !before.correct; newBad += !after.correct
    regressions += before.correct && !after.correct || before.exact && !after.exact
  }
  if (!regressions && newBad < oldBad) pass(`full-city repair improves compass conflicts ${oldBad} -> ${newBad} without regressing correct or exact neighbours`)
  else fail(`full-city repair regresses constraints: ${regressions}, conflicts ${oldBad} -> ${newBad}`)
  if (JSON.stringify([...repaired]) === JSON.stringify([...packedRoomPositions([...rooms].reverse())])) pass('graph-aware whole-city packing is input-order independent')
  else fail('graph-aware whole-city packing depends on input order')
  const greenIds = new Set(['1-14', '1-15', '1-16', '1-17', '1-23', '1-225'])
  for (const id of greenIds) for (const exit of byId.get(id).exits) {
    if (!greenIds.has(exit.targetCellId) || !compass[exit.move]) continue
    const a = byId.get(id).position, b = byId.get(exit.targetCellId).position
    const [dx, dz] = compass[exit.move]
    if (b.x - a.x === dx * CELL_PITCH_METRES && b.z - a.z === dz * CELL_PITCH_METRES) pass(`${id} ${exit.move} has an exact matching geometric neighbor`)
    else fail(`${id} ${exit.move} is displaced or mirrored`)
  }
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

    // Named, counted, and judged against a written-down list. This printed
    // `NOT CHECKED  2 pair(s) of rooms share exact map coordinates` and left
    // it there, which is the worst of the three states: the pairs *were*
    // found, so nothing went unchecked - what the suite declined to do was
    // decide whether two was the right number. An open-ended skip cannot tell
    // the two known pairs from a third that appears tomorrow, and a third
    // would print in the same shape and read as harmlessly.
    //
    // So the two are accepted debt, named with their cause, and anything else
    // fails. The list is diffed both ways: a pair that stops being coincident
    // fails too, because an allowlist that outlives its reason hides the next
    // real one.
    const key = ([a, b]) => [a, b].sort().join('/')
    const found = new Set(coincident.map(key))
    const allowed = new Set(KNOWN_COINCIDENT.map(key))
    const unexpected = [...found].filter((p) => !allowed.has(p))
    const stale = [...allowed].filter((p) => !found.has(p))

    const comparisons = (positioned.length * (positioned.length - 1)) / 2
    console.log(`   ${comparisons} same-storey room pairs compared for coincidence; ${found.size} coincident`)
    if (unexpected.length === 0)
      pass(`no room pair shares a map coordinate except the ${allowed.size} known duplicate mapdb nodes (${[...allowed].join(', ')})`)
    else
      fail(
        `${unexpected.length} NEW pair(s) of rooms share exact map coordinates and will always overlap: ` +
          `${unexpected.join(', ')}. Either the mapdb gained another duplicate node or the manifest ` +
          `dropped a coordinate; neither is a scale problem and neither may be waved through.`
      )
    if (stale.length === 0)
      pass(`every allowlisted duplicate pair is still coincident, so the list has not gone stale (${allowed.size} entries)`)
    else
      fail(
        `KNOWN_COINCIDENT lists ${stale.join(', ')}, which no longer share a coordinate. ` +
          `Remove the entry - a stale allowlist is a hole nobody sees.`
      )
  }
  if (townGreenNorth?.exits.every((exit) => typeof exit.tetherKind === 'string') && townGreenNorth?.exits.find((exit) => exit.direction === 'north')?.boardAnchor?.z === -CELL_PITCH_METRES / 2) pass('true exits carry typed tethers and camera-stable edge anchors')
  else fail('typed tether or board-edge anchor metadata is missing')
}
