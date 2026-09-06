import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileRoomCompositions, interiorShell, overlaps, blocksApproach, solvePlacements } from './compile-room-compositions.mjs'
const read=p=>JSON.parse(readFileSync(p,'utf8'))
const fit=(x,score)=>({bounds:{minX:x,maxX:x+1,minZ:0,maxZ:1},score})
const repairDomains=[[fit(0,10),fit(3,5)],[fit(0,9)]]
const repaired=solvePlacements(repairDomains)
assert.equal(repaired.placed,2,'Repair moves earlier preferred furniture to fit both requirements')
assert.equal(repaired.placements[0].bounds.minX,3)
assert.equal(solvePlacements(repairDomains,0).placed,1,'Zero-budget result retains valid greedy incumbent')
assert.deepEqual(solvePlacements(repairDomains),repaired,'Search is deterministic')
assert.equal(solvePlacements([[fit(0,1)],[fit(0,2)]]).placed,1,'Impossible overlap is never accepted')
assert.equal(solvePlacements([[],[fit(0,1)]]).placed,1,'Unavailable first requirement does not suppress later objects')
assert(solvePlacements(repairDomains,2).visited<=2,'Budget counts attempted search work')
assert.throws(()=>solvePlacements(repairDomains,-1))
const world=read('godot/assets/crossing/world.json'), sources=read('data/art/room-prompts-priority.json'), selections=read('godot/assets/shared_asset_selections.json'), provenance=read('godot/assets/crossing/provenance.json')
const result=compileRoomCompositions(world,sources,selections,provenance)
assert.deepEqual(result.roomCompositions,selections.roomCompositions)
const generated=result.roomCompositions.filter(r=>r.generatedBy)
assert(generated.length>0)
assert.equal(result.report.reusedRooms,generated.length)
assert.deepEqual(compileRoomCompositions({...world,cells:[...world.cells].reverse()},sources,selections,provenance).roomCompositions,result.roomCompositions)
for (const recipe of generated) {
  const cell=world.cells.find(c=>c.id===recipe.cellId)
  assert.equal(recipe.status,'partial-generated-review-required')
  assert(recipe.placementSearch.visited<=recipe.placementSearch.budget)
  assert.equal(recipe.placementSearch.placed,recipe.pieces.filter(p=>p.role==='furnishing').length)
  assert.deepEqual(recipe.requiredExits,cell.exits.map(e=>({move:e.move,targetCellId:e.targetCellId,boardAnchor:e.boardAnchor,tetherKind:e.tetherKind,direction:e.direction})))
  for (const p of recipe.pieces.filter(p=>p.proceduralMesh)) {
    assert.equal(p.definition.shape.kind,'room')
    assert.equal(p.bindings.length,cell.exits.length)
    for (const binding of p.bindings) {
      const edge=cell.exits.find(e=>e.move===binding.move && e.targetCellId===binding.targetCellId)
      assert(edge?.boardAnchor)
      const normal={north:[0,-1],south:[0,1],east:[1,0],west:[-1,0]}[p.definition.shape.room.openings[binding.openingIndex].wall]
      assert.equal(Math.sign(edge.boardAnchor.x),normal[0])
      assert.equal(Math.sign(edge.boardAnchor.z),normal[1])
    }
  }
  const furnishings=recipe.pieces.filter(p=>p.role==='furnishing')
  const bounds=furnishings.map(p=>p.compiledBounds)
  for (let i=0;i<bounds.length;i++) {
    const b=bounds[i]
    assert(b.minX>=-cell.board.footprint.width/2 && b.maxX<=cell.board.footprint.width/2)
    assert(b.minZ>=-cell.board.footprint.depth/2 && b.maxZ<=cell.board.footprint.depth/2)
    assert(!overlaps(b,{minX:-2,maxX:2,minZ:-2,maxZ:2}))
    for (const e of cell.exits) if (e.boardAnchor) assert(!blocksApproach(b,e.boardAnchor))
    for (let j=i+1;j<bounds.length;j++) assert(!overlaps(b,bounds[j],.35))
    for (const spawn of cell.board.spawnPoints) assert(!overlaps(b,{minX:spawn.anchor.x-.7,maxX:spawn.anchor.x+.7,minZ:spawn.anchor.z-.7,maxZ:spawn.anchor.z+.7},.35))
    assert(sources[cell.sourceDescriptionId].lore.includes(furnishings[i].evidence))
  }
}
const cell=world.cells.find(c=>c.id===generated[0].cellId)
assert(world.cells.every(c=>c.cartographicContent?.id===c.roomId), 'All Crossing cells join their own cartographic record')
const locker=world.cells.find(c=>c.id==='1-326')
assert.equal(locker.cartographicContent.block,'building-interior')
assert.equal(result.roomCompositions.find(r=>r.cellId==='1-326').pieces[0].surfaceKind,'interior-floor-5m')
const single={...world,cells:[cell]}, empty={...selections,roomCompositions:[]}
for (const lore of ['There is no workbench here.','A distant anvil stands beyond the window.','An anvil is depicted on the sign.']) {
  assert.equal(compileRoomCompositions(single,{...sources,[cell.sourceDescriptionId]:{room:cell.roomId,lore}},empty,provenance).report.generatedRooms,0)
}
assert.equal(compileRoomCompositions({...single,cells:[{...cell,status:'missing-description'}]},sources,empty,provenance).report.generatedRooms,0)
const changed=compileRoomCompositions(single,{...sources,[cell.sourceDescriptionId]:{room:cell.roomId,lore:'A workbench stands here.'}},selections,provenance)
assert.equal(changed.report.reusedRooms,0)
assert(blocksApproach({minX:2,maxX:4,minZ:2,maxZ:4},{x:9,z:9}))
assert(!blocksApproach({minX:2,maxX:4,minZ:2,maxZ:4},{x:-9,z:0}))
const shellCell={board:{footprint:{width:17.6,depth:17.6}},cartographicContent:{block:'building-interior'},exits:[{move:'out',targetCellId:'next',boardAnchor:null}]}
assert.equal(interiorShell(shellCell,'The room has plaster walls.'),null)
shellCell.exits[0].boardAnchor={x:9,z:9}
assert.equal(interiorShell(shellCell,'The room has plaster walls.'),null)
shellCell.exits[0].boardAnchor={x:0,z:9}
assert.equal(interiorShell(shellCell,'The room has plaster walls.').pieces[0].definition.shape.room.openings[0].wall,'south')
shellCell.exits[0].tetherKind='stairs'
assert.equal(interiorShell(shellCell,'The room has plaster walls.'),null)
console.log('Compiled room contracts, bounds, approaches, evidence, caching and override checks passed: '+generated.length+' rooms')
