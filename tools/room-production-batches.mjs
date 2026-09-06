// Scheduling only: a cohort is not evidence that rooms share literal furnishings.
// Keep exact directions/commands in the room record; never rotate graph semantics.
export function planProductionBatches(rooms) {
  const cohorts = new Map()
  const exceptions = []
  const kitDemand = new Map()
  const ids = new Set()
  for (const room of [...rooms].sort((a,b)=>a.id.localeCompare(b.id))) {
    if (ids.has(room.id)) throw new Error('Duplicate room: '+room.id)
    ids.add(room.id)
    const reasons = []
    if (!room.description) reasons.push('missing-description')
    if (room.evidenceScope !== 'representative-room') reasons.push('room-evidence-review')
    if (room.connections.some(e=>e.compassBearingMatches === false)) reasons.push('layout-conflict')
    if (room.connections.some(e=>!e.targetLoaded)) reasons.push('external-endpoint')
    const families = [...new Set(room.assetRequirements.map(a=>a.family))].sort()
    if (!families.length) reasons.push('unclassified-kit')
    if (reasons.length) exceptions.push({roomId:room.id,reasons})
    // Unresolved prose must not acquire assets through family inference.
    if (!room.description || !families.length) continue
    // Commands, socket count, materials and furnishing families are template
    // parameters, not reasons to author another template for every room.
    const structuralPriority=['interior-shell-and-fittings','riverine-and-maritime','rock-cave-and-underground','street-and-junction','garden-and-boundary','building-frontage']
    const primaryFamily=structuralPriority.find(f=>families.includes(f)) ?? families[0]
    const signature = JSON.stringify([room.spatialClassification,primaryFamily])
    if (!cohorts.has(signature)) cohorts.set(signature, {
      signature, spatialClassification:room.spatialClassification, primaryFamily,
      parameterSource:'Per-room assetRequirements and exact connections in this manifest',
      roomIds:[], representativeRoomIds:[],
      status:'planned-not-generated',
    })
    const cohort=cohorts.get(signature)
    cohort.roomIds.push(room.id)
    // Review long and short descriptions as well as the first stable example.
    cohort.representativeRoomIds.push({id:room.id,length:room.description.length})
    for (const family of families) {
      if (!kitDemand.has(family)) kitDemand.set(family, {family,roomIds:[],unbuiltRoomIds:[]})
      const demand=kitDemand.get(family)
      demand.roomIds.push(room.id)
      if (room.recipeStatus==='unbuilt') demand.unbuiltRoomIds.push(room.id)
    }
  }
  const batches=[...cohorts.values()].sort((a,b)=>b.roomIds.length-a.roomIds.length || a.signature.localeCompare(b.signature))
  for (const batch of batches) {
    const byLength=[...batch.representativeRoomIds].sort((a,b)=>a.length-b.length || a.id.localeCompare(b.id))
    batch.representativeRoomIds=[...new Set([batch.roomIds[0],byLength[0].id,byLength.at(-1).id])]
  }
  return {
    status:'planning-only-no-new-scenes',
    policy:'Build and validate reusable templates by cohort; retain per-room evidence, exact exits and authored overrides. Review representative scenes plus every exception; sampling never approves unresolved rooms.',
    kitPriority:[...kitDemand.values()].sort((a,b)=>b.unbuiltRoomIds.length-a.unbuiltRoomIds.length || a.family.localeCompare(b.family)),
    batches, exceptions,
    counts:{inputRooms:rooms.length,scheduledRooms:batches.reduce((n,b)=>n+b.roomIds.length,0),cohorts:batches.length,representativeReviews:batches.reduce((n,b)=>n+b.representativeRoomIds.length,0),exceptionRooms:exceptions.length},
  }
}
