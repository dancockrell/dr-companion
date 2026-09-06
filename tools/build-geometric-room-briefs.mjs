import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const inputPath = 'data/art/room-prompts-priority.json'
const placeMapPath = 'data/art/room-place-map.json'
const outputDir = 'data/art/out'
const outputPath = join(outputDir, 'geometric-room-briefs.json')
const reviewPath = join(outputDir, 'geometric-room-briefs-crossing.md')

const places = JSON.parse(readFileSync(inputPath, 'utf8'))
const placeOf = JSON.parse(readFileSync(placeMapPath, 'utf8')).placeOf

const mapRooms = new Map()
for (const file of readdirSync('src/data/map').filter((name) => name.endsWith('.json') && name !== 'index.json')) {
  const zone = file.slice(0, -5)
  const map = JSON.parse(readFileSync(join('src/data/map', file), 'utf8'))
  for (const room of map.rooms ?? []) mapRooms.set(`${zone}-${room.id}`, room)
}

const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()
// Legacy place keys discard establishment names (for example "Workroom").
// They are routing candidates, not evidence that two rooms share prose.
const titleFamily = (value) => normalize(value).toLowerCase().split(',')[0].trim()
const lower = (entry) => `${entry.title} ${entry.place} ${entry.lore}`.toLowerCase()
const has = (text, ...terms) => terms.some((term) => new RegExp('\\b' + term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(text))
const hashes = (value) => createHash('sha256').update(value).digest('hex').slice(0, 16)

const classify = (entry) => {
  // Figurative traffic is not a water feature. Keep the original description
  // intact in the brief; only this conservative feature scan removes idioms.
  const text = lower(entry).replace(/stream of (customers|people|traffic|visitors)/g, 'flow of visitors')
  const tags = []
  const specialKinds = []
  if (has(text, 'guild')) { tags.push('guild'); specialKinds.push('guild') }
  if (has(text, 'temple', 'shrine', 'sanctuary', 'chapel', 'church')) { tags.push('sacred'); specialKinds.push('sacred') }
  if (has(text, 'bank', 'treasury', 'mint')) { tags.push('banking'); specialKinds.push('banking') }
  if (has(text, 'market', 'bazaar', 'mongers', 'merchant')) { tags.push('market'); specialKinds.push('market') }
  if (has(text, 'gate', 'customs', 'portcullis', 'town wall')) { tags.push('gate'); specialKinds.push('gate') }
  if (has(text, 'bridge', 'causeway', 'trollferry')) tags.push('bridge')
  if (has(text, 'river', 'stream', 'water', 'dock', 'quay', 'jetty', 'wharf', 'harbor', 'harbour', 'beach', 'shore')) tags.push('water')
  if (has(text, 'office', 'hall', 'chamber', 'infirmary', 'workroom', 'salesroom', 'showroom', 'interior', 'corridor', 'hallway', 'tunnel', 'cavern', 'catacomb', 'inside ', 'foyer')) tags.push('interior')
  if (has(text, 'square', 'plaza', 'green', 'arena', 'theater', 'carousel', 'fountain')) { tags.push('landmark'); specialKinds.push('landmark') }
  if (!tags.length) tags.push('ordinary')
  const spatialMode = tags.includes('interior')
    ? 'interior-cutaway'
    : tags.includes('water') && tags.includes('bridge')
      ? 'bridge-water'
      : tags.includes('water')
        ? 'waterfront'
        : 'exterior-cell'
  return { tags: [...new Set(tags)], specialKinds: [...new Set(specialKinds)], spatialMode, tier: specialKinds.length ? 'special' : tags.includes('bridge') || tags.includes('water') || tags.includes('interior') ? 'feature' : 'ordinary' }
}

const exitPhrase = (room) => {
  const exits = (room?.exits ?? []).map((exit) => exit.move || exit.dir).filter(Boolean)
  if (!exits.length) return 'Keep the room intimate and do not invent a visible route that the map does not support.'
  const visible = exits.slice(0, 5).join(', ')
  return `Make the real outgoing routes legible through restrained anchors for ${visible}; additional routes may remain off-camera rather than being invented.`
}

const modePhrase = (classification) => {
  if (classification.spatialMode === 'interior-cutaway') return 'Treat it as a small, readable cutaway set with an honest floor plan, strong wall/floor silhouettes, and door or arch anchors only where the room supports them.'
  if (classification.spatialMode === 'bridge-water') return 'Treat the crossing and water as the compositional spine: preserve the bridge approach, the two banks, and safe open space for figures without inventing a grand harbour.'
  if (classification.spatialMode === 'waterfront') return 'Let the water edge, quay, dock, bank, or shore establish the major silhouette and keep the route along it clear for movement.'
  return 'Arrange the blocks as a readable local cell with a clear central play space and a deliberate perimeter, rather than a generic postcard street.'
}

const makePrompt = (key, entry, representativeRoom, cellRoom = null) => {
  const classification = classify(entry)
  const title = normalize(cellRoom?.name || entry.title || entry.place || key.split('::')[1])
  const placeContext = cellRoom && cellRoom.name !== entry.title
    ? ` It belongs to the described place ${normalize(entry.title || entry.place)}; preserve that relationship without copying a neighboring room wholesale.`
    : ''
  const lore = normalize(entry.lore)
  const paragraphOne = `Create a detailed tabletop-fantasy interpretation of ${title} in ${entry.zoneName}. ${lore}${placeContext} Let every described material, landmark, boundary, and route carry the scene; do not replace the authored place with a generic fantasy town. ${exitPhrase(cellRoom ?? representativeRoom)}`
  const paragraphTwo = `${modePhrase(classification)} Design it as part of the connected city-wide batch, using measured reusable footprints, entrance sockets, continuous street sections and supported vertical connections. Preserve fine geometry, material detail and complex shadows at the fixed isometric camera. Reserve usable occupant space without uniformly enlarging buildings or furniture. Generic square platforms and permanently open demo houses are superseded; interior visibility is a presentation state, not missing exterior architecture. Do not invent geography, inhabitants, or unsupported landmarks.`
  return `${paragraphOne}\n\n${paragraphTwo}`
}

const bindings = []
for (const [roomKey, placeKey] of Object.entries(placeOf)) {
  const split = roomKey.lastIndexOf('-')
  const zone = roomKey.slice(0, split)
  const roomId = Number(roomKey.slice(split + 1))
  const room = mapRooms.get(roomKey)
  const source = places[placeKey]
  const descriptionBindingStatus = !source ? 'missing-source'
    : !room ? 'missing-map-room'
      : !titleFamily(source.title) || titleFamily(source.title) !== titleFamily(room.name)
        ? 'rejected-title-family-mismatch' : 'compatible-title-family-needs-room-review'
  bindings.push({
    roomKey,
    zone,
    roomId,
    placeKey,
    mapStatus: room ? 'mapped' : 'missing-map-room',
    map: room ? {
      name: room.name,
      x: room.x,
      y: room.y,
      z: room.z,
      exits: (room.exits ?? []).map(({ dir, move, to }) => ({ dir, move, to })),
    } : null,
    descriptionBindingStatus,
    rejectedSourceDescriptionId: descriptionBindingStatus === 'rejected-title-family-mismatch' ? placeKey : null,
    briefStatus: descriptionBindingStatus === 'compatible-title-family-needs-room-review' ? 'described' : 'missing-description',
  })
}
bindings.sort((a, b) => a.zone.localeCompare(b.zone, undefined, { numeric: true }) || a.roomId - b.roomId)

const representativeByPlace = new Map()
for (const binding of bindings) if (binding.briefStatus === 'described' && !representativeByPlace.has(binding.placeKey) && binding.map) representativeByPlace.set(binding.placeKey, binding.map)

const briefs = Object.entries(places).map(([key, entry]) => {
  const classification = classify(entry)
  const representativeRoom = representativeByPlace.get(key) ?? mapRooms.get(`${entry.zone}-${entry.room}`) ?? null
  const prompt = makePrompt(key, entry, representativeRoom)
  const roomBindings = bindings.filter((binding) => binding.placeKey === key && binding.briefStatus === 'described').map((binding) => binding.roomKey)
  return {
    id: key,
    zone: entry.zone,
    zoneName: entry.zoneName,
    representativeRoom: entry.room,
    title: entry.title,
    place: entry.place,
    lore: normalize(entry.lore),
    descriptionHash: hashes(normalize(entry.lore)),
    classification,
    prompt,
    roomBindings,
  }
}).sort((a, b) => a.zone.localeCompare(b.zone, undefined, { numeric: true }) || a.title.localeCompare(b.title))

const missingDescriptions = bindings.filter((binding) => binding.briefStatus !== 'described')
const specialPlaces = briefs.filter((brief) => brief.classification.tier === 'special')
const featurePlaces = briefs.filter((brief) => brief.classification.tier === 'feature')
const crossing = briefs.filter((brief) => brief.zone === '1')
const briefsByPlace = new Map(briefs.map((brief) => [brief.id, brief]))

// The unit consumed by the 3D rebuild is always a room cell, even when the
// authored prose describes a larger named place.  This preserves the room's
// own graph position and exits while retaining honest provenance for shared
// place-level text.
const roomBriefs = bindings.map((binding) => {
  const placeBrief = binding.briefStatus === 'described' ? briefsByPlace.get(binding.placeKey) : null
  if (!placeBrief) return {
    id: binding.roomKey,
    zone: binding.zone,
    roomId: binding.roomId,
    title: binding.map?.name ?? null,
    placeId: binding.placeKey,
    briefStatus: 'missing-description',
    sourceDescriptionId: null,
    descriptionBindingStatus: binding.descriptionBindingStatus,
    rejectedSourceDescriptionId: binding.rejectedSourceDescriptionId,
    classification: { tags: ['unresolved'], specialKinds: [], spatialMode: 'unresolved', tier: 'unresolved' },
    prompt: null,
    map: binding.map,
  }
  const room = mapRooms.get(binding.roomKey) ?? null
  return {
    id: binding.roomKey,
    zone: binding.zone,
    roomId: binding.roomId,
    title: room?.name ?? placeBrief.title,
    placeId: binding.placeKey,
    briefStatus: 'described',
    sourceDescriptionId: placeBrief.id,
    descriptionBindingStatus: binding.descriptionBindingStatus,
    sourceDescriptionHash: placeBrief.descriptionHash,
    classification: placeBrief.classification,
    prompt: makePrompt(placeBrief.id, places[binding.placeKey], representativeByPlace.get(binding.placeKey), room),
    map: binding.map,
  }
})
const describedRoomBriefs = roomBriefs.filter((brief) => brief.briefStatus === 'described')
const specialRoomBriefs = describedRoomBriefs.filter((brief) => brief.classification.tier === 'special')
const featureRoomBriefs = describedRoomBriefs.filter((brief) => brief.classification.tier === 'feature')

mkdirSync(outputDir, { recursive: true })
writeFileSync(outputPath, JSON.stringify({
  schemaVersion: 1,
  source: { prompts: inputPath, placeMap: placeMapPath, mapDirectory: 'src/data/map' },
  generatedAt: new Date().toISOString(),
  counts: {
    describedPlaces: briefs.length,
    roomBindings: bindings.length,
    describedRoomBriefs: describedRoomBriefs.length,
    specialPlaces: specialPlaces.length,
    featurePlaces: featurePlaces.length,
    specialRoomBriefs: specialRoomBriefs.length,
    featureRoomBriefs: featureRoomBriefs.length,
    missingDescriptionBindings: missingDescriptions.length,
  },
  briefs,
  roomBindings: bindings,
  roomBriefs,
  specialPlaceIds: specialPlaces.map((brief) => brief.id),
  featurePlaceIds: featurePlaces.map((brief) => brief.id),
  specialRoomIds: specialRoomBriefs.map((brief) => brief.id),
  featureRoomIds: featureRoomBriefs.map((brief) => brief.id),
  missingDescriptions,
}, null, 2) + '\n')

const review = [
  '# Crossing geometric room briefs',
  '',
  'Generated review catalogue. Every entry contains exactly two prose paragraphs; source descriptions remain authoritative.',
  '',
  `- Described Crossing places: ${crossing.length}`,
  `- Crossing special places: ${crossing.filter((brief) => brief.classification.tier === 'special').length}`,
  `- Crossing feature places (bridge, water, or interior): ${crossing.filter((brief) => brief.classification.tier === 'feature').length}`,
  '',
]
for (const brief of crossing) {
  review.push(`## ${brief.title} — \`${brief.id}\``, '', `Tags: ${brief.classification.tags.join(', ')} · mode: ${brief.classification.spatialMode} · tier: ${brief.classification.tier}`, '', brief.prompt, '')
}
writeFileSync(reviewPath, review.join('\n'))

console.log(`wrote ${briefs.length} description-grounded briefs and ${bindings.length} room bindings`)
console.log(`${specialPlaces.length} special places, ${featurePlaces.length} bridge/water/interior feature places, ${missingDescriptions.length} bindings lack a source description`)
