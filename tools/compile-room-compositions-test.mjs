import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileRoomCompositions, overlaps, blocksApproach } from './compile-room-compositions.mjs'
const read=p=>JSON.parse(readFileSync(p,'utf8'))
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
  assert.deepEqual(recipe.requiredExits,cell.exits.map(e=>({move:e.move,targetCellId:e.targetCellId,boardAnchor:e.boardAnchor})))
  const bounds=recipe.pieces.slice(1).map(p=>p.compiledBounds)
  for (let i=0;i<bounds.length;i++) {
    const b=bounds[i]
    assert(b.minX>=-cell.board.footprint.width/2 && b.maxX<=cell.board.footprint.width/2)
    assert(b.minZ>=-cell.board.footprint.depth/2 && b.maxZ<=cell.board.footprint.depth/2)
    assert(!overlaps(b,{minX:-2,maxX:2,minZ:-2,maxZ:2}))
    for (const e of cell.exits) if (e.boardAnchor) assert(!blocksApproach(b,e.boardAnchor))
    for (let j=i+1;j<bounds.length;j++) assert(!overlaps(b,bounds[j],.35))
    for (const spawn of cell.board.spawnPoints) assert(!overlaps(b,{minX:spawn.anchor.x-.7,maxX:spawn.anchor.x+.7,minZ:spawn.anchor.z-.7,maxZ:spawn.anchor.z+.7},.35))
    assert(sources[cell.sourceDescriptionId].lore.includes(recipe.pieces[i+1].evidence))
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
console.log('Compiled room contracts, bounds, approaches, evidence, caching and override checks passed: '+generated.length+' rooms')
