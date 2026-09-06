import { createHash } from 'node:crypto'

export const COMPILER_VERSION = 'bounded-furnishing-v3'
const prefix='painted-river-port.'
// Literal supported nouns only. This is a candidate compiler, not a claim that
// matching prose proves material, count, local position or artistic completion.
const rules=[
  ['workbench', /\bworkbench(?:es)?\b/i],
  ['anvil', /\banvils?\b/i],
  ['long-worktable', /\blong (?:wooden )?worktable\b/i],
  ['stone-bench', /\b(?:stone|limestone|granite) bench(?:es)?\b/i],
  ['wooden-park-bench', /\bwooden bench(?:es)?\b/i],
  ['tool-rack', /\b(?:tool racks?|racks? of tools)\b/i],
]
const rejectedContext=/\b(no|without|absent|removed|destroyed|beyond|distant|through the window|painted|depicted|carved image|resound|clang|clangs|hear|heard|sound|sounds|center of the chamber)\b/i
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function overlaps(a,b,gap=0) {
  return a.minX < b.maxX+gap && a.maxX+gap > b.minX && a.minZ < b.maxZ+gap && a.maxZ+gap > b.minZ
}
// Slab test against an expanded rectangle: the segment's full corridor is
// reserved, not just its endpoint or a few sampled points.
export function blocksApproach(box,anchor,clearance=1) {
  let low=0,high=1
  for (const [d,min,max] of [[anchor.x,box.minX-clearance,box.maxX+clearance],[anchor.z,box.minZ-clearance,box.maxZ+clearance]]) {
    if (Math.abs(d)<1e-9) { if (min>0 || max<0) return false; continue }
    const a=min/d,b=max/d
    low=Math.max(low,Math.min(a,b)); high=Math.min(high,Math.max(a,b))
    if (low>high) return false
  }
  return true
}
export function compileRoomCompositions(world,sources,selections,provenance) {
  const authored=selections.roomCompositions.filter(r=>!r.generatedBy)
  const protectedIds=new Set(authored.map(r=>r.cellId))
  const available=new Map(provenance.assets.filter(a=>selections.nativeCatalog.assetIds.includes(a.assetId)).map(a=>[a.assetId,a]))
  const old=new Map(selections.roomCompositions.filter(r=>r.generatedBy===COMPILER_VERSION).map(r=>[r.cellId,r]))
  const generated=[], exceptions=[]
  let reused=0
  for (const cell of [...world.cells].sort((a,b)=>a.id.localeCompare(b.id))) {
    if (protectedIds.has(cell.id)) continue
    const description=sources[cell.sourceDescriptionId]?.lore
    if (!description || cell.status==='missing-description') continue
    if (sources[cell.sourceDescriptionId].room !== cell.roomId || /\b(seasonal|normal-season|confirmed game state)\b/i.test(description)) {
      exceptions.push({cellId:cell.id,reasons:['Shared-room evidence or conditional state requires resolution before automatic placement']})
      continue
    }
    const width=cell.board.footprint.width,depth=cell.board.footprint.depth
    if (!(width>0 && depth>0)) throw new Error('Invalid footprint '+cell.id)
    const wanted=rules.flatMap(([name,pattern])=>{
      const sentence=description.split(/(?<=[.!?])\s+/).find(s=>pattern.test(s) && !rejectedContext.test(s))
      return sentence ? [{assetId:prefix+name,evidence:sentence}] : []
    })
    if (!wanted.length) continue
    const requiredExits=cell.exits.map(e=>({move:e.move,targetCellId:e.targetCellId,boardAnchor:e.boardAnchor}))
    const approaches=requiredExits.flatMap(e=>e.boardAnchor ? [e.boardAnchor] : [{x:width/2,z:0},{x:-width/2,z:0},{x:0,z:depth/2},{x:0,z:-depth/2}])
    const inputHash=digest([COMPILER_VERSION,cell.sourceDescriptionHash,description,cell.board,requiredExits,wanted.map(w=>available.get(w.assetId)??w.assetId),selections.nativeCatalog.revision])
    if (old.get(cell.id)?.inputHash===inputHash) { generated.push(old.get(cell.id)); reused++; continue }
    const interior=cell.spatialMode==='interior-cutaway' || /\b(?:stone|tiled|wooden|onyx)[ -]floor\b/i.test(description)
    const pieces=[{surfaceKind:interior?'interior-floor-5m':'terrain-cell-5m',center:[0,0],envelope:[1,1],lift:0,role:'base',color:'#72716b'}]
    const occupied=[{minX:-2,maxX:2,minZ:-2,maxZ:2}]
    for (const spawn of cell.board.spawnPoints ?? []) occupied.push({minX:spawn.anchor.x-.7,maxX:spawn.anchor.x+.7,minZ:spawn.anchor.z-.7,maxZ:spawn.anchor.z+.7})
    const missing=['Room-specific shell, finishes, counts and landmark details require further compilation and review','Inferred furniture placement is not a recovered historical floor plan']
    for (const requirement of wanted) {
      const record=available.get(requirement.assetId)
      if (!record) { missing.push('Missing catalog asset: '+requirement.assetId); continue }
      const candidates=[]
      for (const yaw of [0,90,180,270]) for (const x of [-6,-3,0,3,6]) for (const z of [-6,-3,0,3,6]) {
        const angle=yaw*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle)
        const [bx,,bz]=record.bounds.min,[sx,,sz]=record.bounds.size
        const corners=[[bx,bz],[bx+sx,bz],[bx,bz+sz],[bx+sx,bz+sz]].map(([u,v])=>[x+cos*u+sin*v,z-sin*u+cos*v])
        const bounds={minX:Math.min(...corners.map(p=>p[0])),maxX:Math.max(...corners.map(p=>p[0])),minZ:Math.min(...corners.map(p=>p[1])),maxZ:Math.max(...corners.map(p=>p[1]))}
        if (bounds.minX < -width/2+.4 || bounds.maxX>width/2-.4 || bounds.minZ < -depth/2+.4 || bounds.maxZ>depth/2-.4) continue
        if (occupied.some(b=>overlaps(bounds,b,.35))) continue
        if (approaches.some(anchor=>blocksApproach(bounds,anchor))) continue
        // Prefer perimeter furniture facing the open center, deterministic ties.
        const facing=sin*x+cos*z
        candidates.push({x,z,yaw,bounds,score:Math.abs(x)+Math.abs(z)+facing*.2})
      }
      candidates.sort((a,b)=>b.score-a.score || a.yaw-b.yaw || a.x-b.x || a.z-b.z)
      const fit=candidates[0]
      if (!fit) { missing.push('No clear bounded placement: '+requirement.assetId); continue }
      occupied.push(fit.bounds)
      pieces.push({assetId:requirement.assetId,center:[fit.x/width,fit.z/depth],envelope:[(fit.bounds.maxX-fit.bounds.minX+.001)/width,(fit.bounds.maxZ-fit.bounds.minZ+.001)/depth],yawDegrees:fit.yaw,lift:0,role:'furnishing',evidence:requirement.evidence,compiledBounds:fit.bounds})
    }
    if (pieces.length===1) { exceptions.push({cellId:cell.id,reasons:missing}); continue }
    generated.push({cellId:cell.id,descriptionHash:cell.sourceDescriptionHash,status:'partial-generated-review-required',generatedBy:COMPILER_VERSION,inputHash,requiredExits,requiredFootprint:cell.board.footprint,evidence:'Literal source phrases retained on each furnishing; source binding still requires per-room review.',placementPolicy:'Measured native bounds; reserved central 4m space, spawn clearances and 2m-wide approach corridors. Unlocated exits reserve all four cardinal approaches without inventing endpoints. Authored compositions override generated results.',missing,pieces})
  }
  return {roomCompositions:[...authored,...generated],report:{compiler:COMPILER_VERSION,generatedRooms:generated.length,reusedRooms:reused,exceptions}}
}
