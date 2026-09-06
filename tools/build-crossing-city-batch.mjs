// One production batch, not a selection of attractive rooms. Read the complete
// descriptions and retain evidence beside every asset requirement and exit.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

execFileSync(process.execPath, ['tools/build-primitive-world-manifest.mjs', '1'], { stdio: 'inherit' })
const world = JSON.parse(readFileSync('godot/assets/crossing/world.json', 'utf8'))
const sources = JSON.parse(readFileSync('data/art/room-prompts-priority.json', 'utf8'))
const selections = JSON.parse(readFileSync('godot/assets/shared_asset_selections.json', 'utf8'))
const recipes = new Map(selections.roomCompositions.map(r => [r.cellId, r]))
const archivePath = 'data/world/crossing-archive-candidates.json'
const archive = existsSync(archivePath) ? JSON.parse(readFileSync(archivePath, 'utf8')) : null
const researchCandidates = new Map((archive?.rooms ?? []).map(r => [r.cellId, r]))
const byId = new Map(world.cells.map(c => [c.id, c]))
const familyRules = [
  ['street-and-junction', /\b(cobblestone|cobblestones|paving|paved|street|road|lane|boulevard)\b/i],
  ['garden-and-boundary', /\b(hedge|hedges|hedgerow|lawn|grass|garden|trees|tree|flowers)\b/i],
  ['riverine-and-maritime', /\b(river|dock|docks|quay|wharf|harbor|harbour|shore|beach|mudflats|marsh)\b/i],
  ['rock-cave-and-underground', /\b(cave|cavern|tunnel|sewer|bedrock|stalactites)\b/i],
  ['interior-shell-and-fittings', /\b(ceiling|corridor|hallway|showroom|salesroom|workroom|chamber|foyer)\b/i],
  ['building-frontage', /\b(building|buildings|facade|facades|cottage|cottages|roof|roofs|shop|shops)\b/i],
  ['vertical-connection', /\b(stairs|staircase|stairway|ladder|ladders|ramp|ramps|upstairs|downstairs)\b/i],
  ['workshop-and-commercial-display', /\b(counter|rack|racks|workbench|anvil|forge|shelves|shelf|display|displays|stall|stalls)\b/i],
]
const compass = { north: [0,-1], northeast: [1,-1], east: [1,0], southeast: [1,1], south: [0,1], southwest: [-1,1], west: [-1,0], northwest: [-1,-1] }
const rooms = world.cells.map(cell => {
  const source = sources[cell.sourceDescriptionId]
  const description = source?.lore ?? ''
  const recipe = recipes.get(cell.id)
  const requirements = familyRules.flatMap(([family, pattern]) => {
    const match = pattern.exec(description)
    return match ? [{ family, evidence: description.slice(Math.max(0, match.index - 60), match.index + match[0].length + 100), status: 'requires-design-review' }] : []
  })
  const connections = cell.exits.map(exit => {
    const target = byId.get(exit.targetCellId)
    const direction = compass[exit.move]
    const delta = target ? { x: target.position.x - cell.position.x, y: target.position.y - cell.position.y, z: target.position.z - cell.position.z } : null
    const bearingMatches = direction && delta ? Math.sign(delta.x) === direction[0] && Math.sign(delta.z) === direction[1] : null
    const sourceBearingMatches = direction && target ? Math.sign(target.sourceGrid.x-cell.sourceGrid.x) === direction[0] && Math.sign(target.sourceGrid.y-cell.sourceGrid.y) === direction[1] : null
    return { command: exit.move, targetCellId: exit.targetCellId, tetherKind: exit.tetherKind,
      sourceAnchor: exit.boardAnchor, targetLoaded: Boolean(target), presentationDelta: delta,
      compassBearingMatches: bearingMatches, sourceCompassBearingMatches: sourceBearingMatches,
      bearingConflictOrigin: bearingMatches === false ? (sourceBearingMatches === false ? 'source-map' : 'presentation-layout') : null,
      socketBindingStatus: 'unverified',
      requires: ['source endpoint', 'destination endpoint or explicit external tether', 'clear approach', 'legal-command verification'] }
  })
  // Neither a description nor a nonempty model list constitutes completion.
  const complete = Boolean(description && recipe?.status === 'approved-complete' && recipe.missing?.length === 0 && recipe.visualReview?.capture && recipe.connectionReview?.allExitsBound)
  return { id: cell.id, title: cell.title, sourceDescriptionId: cell.sourceDescriptionId,
    descriptionHash: cell.sourceDescriptionHash, description,
    evidenceScope: source ? (source.room === cell.roomId ? 'representative-room' : 'shared-place-binding-needs-room-review') : 'missing',
    descriptionResearch: !description && researchCandidates.has(cell.id) ? {
      sourceRevision: archive.source.revision, status: researchCandidates.get(cell.id).status,
      candidateIds: researchCandidates.get(cell.id).candidates.map(c=>c.archiveRoomId),
      report: archivePath,
    } : null,
    sourceUrl: source?.sourceUrl ?? null, sourceGrid: cell.sourceGrid, position: cell.position,
    spatialClassification: cell.spatialMode, classificationStatus: 'heuristic-needs-review',
    assetRequirements: requirements, currentModels: recipe?.pieces.map(p => p.assetId).filter(Boolean) ?? [],
    currentSurfaces: recipe?.pieces.map(p => p.surfaceKind).filter(Boolean) ?? [],
    recipeStatus: recipe?.status ?? 'unbuilt', remainingRecipeWork: recipe?.missing ?? [],
    connections, productionStatus: complete ? 'complete' : description ? 'incomplete' : 'needs-description' }
})
const families = familyRules.map(([id]) => ({ id, roomIds: rooms.filter(r => r.assetRequirements.some(a => a.family === id)).map(r => r.id) }))
const counts = {
  rooms: rooms.length, directedExits: rooms.reduce((n,r) => n+r.connections.length,0),
  descriptions: rooms.filter(r=>r.description).length,
  missingDescriptions: rooms.filter(r=>!r.description).length,
  partialRecipes: rooms.filter(r=>r.recipeStatus === 'partial-authored').length,
  complete: rooms.filter(r=>r.productionStatus === 'complete').length,
  compassMismatches: rooms.reduce((n,r)=>n+r.connections.filter(e=>e.compassBearingMatches === false).length,0),
  sourceCompassMismatches: rooms.reduce((n,r)=>n+r.connections.filter(e=>e.sourceCompassBearingMatches === false).length,0),
}
const batch = { schemaVersion: 1, scope: 'All Crossing rooms in authoritative zone 1; one production batch', counts,
  acceptance: ['every room has reviewed source evidence', 'no unbuilt or placeholder room', 'all legal exits have deliberate endpoints', 'interiors and vertical relationships reviewed', 'assets have provenance and measured bounds', 'all room captures reviewed at gameplay framing', 'tests and dense-scene performance accepted'],
  families, rooms }
writeFileSync('data/world/crossing-city-batch.json', JSON.stringify(batch,null,2)+'\n')
writeFileSync('docs/CROSSING_CITY_BATCH.md', [
  '# Crossing: single city-wide production batch', '',
  'Current completion authority: the entire zone, not Town Green or another neighborhood. Small commits are checkpoints inside this one batch. This report is generated; update the sources and recipes, not the report.', '',
  'Run: node tools/build-crossing-city-batch.mjs. Add --check-complete for the release acceptance gate (expected to fail while unfinished).', '',
  '## Current inventory', '', ...Object.entries(counts).map(([k,v])=>'- '+k+': '+v), '',
  '## Coordinated asset families', '', ...families.map(f=>'- '+f.id+': '+f.roomIds.length+' rooms'), '',
  'Families are evidence-backed work queues, not permission to fill every matching room with a generic model. The JSON retains the full bound description, excerpt, commands, geometry diagnostics and current recipe for every room. Shared-place descriptions and heuristic classifications need review.', '',
  '## Required architecture', '',
  'Street continuations, intersections, waterfronts and building approaches must be composed as connected arrangements. Footprints need not all be square. A legal graph edge remains authoritative even when literal geometric adjacency is impossible; communicate the exception with a typed tether. Interior visibility layers are not evidence of physical upstairs/downstairs. Only supported elevation relationships may be represented as such.', '',
  '## Missing descriptions', '', ...rooms.filter(r=>!r.description).map(r=>'- '+r.id+' — '+r.title), '',
  'Historical recovery candidates are recorded in data/world/crossing-archive-candidates.json. Refresh them with tools/audit-crossing-archive.ps1 after regenerating this batch, then regenerate the batch again to attach the candidates. Archive matches never approve prose, topology or models automatically.', '',
  '## Completion gate', '', ...batch.acceptance.map(v=>'- '+v), '',
  'A populated inventory is not a populated city. No current partial recipe is certified complete by this batch compiler.', '',
].join('\n'))
console.log(JSON.stringify(counts))
if (process.argv.includes('--check-complete') && counts.complete !== counts.rooms) {
  console.error('INCOMPLETE: '+(counts.rooms-counts.complete)+' rooms remain below the complete acceptance state')
  process.exitCode = 1
}
