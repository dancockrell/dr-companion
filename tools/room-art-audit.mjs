import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT_ARCHETYPES = 'data/art/out/archetypes'
const OUT_ROOMS = 'data/art/out/rooms'
const REPORT = 'data/art/room-art-audit.json'
const placeMap = JSON.parse(readFileSync('data/art/room-place-map.json', 'utf8'))
const archetypePrompts = JSON.parse(readFileSync('data/art/archetype-prompts.json', 'utf8'))
const curation = existsSync('data/art/room-art-curation.json')
  ? JSON.parse(readFileSync('data/art/room-art-curation.json', 'utf8'))
  : { places: {}, archetypes: {} }

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

function renderedFiles(dir, subjectSlug) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.startsWith(subjectSlug + '--') && f.endsWith('.webp'))
    .sort((a, b) => statSync(join(dir, b)).mtimeMs - statSync(join(dir, a)).mtimeMs)
}

const placeUsage = {}
for (const placeKey of Object.values(placeMap.placeOf)) {
  if (!placeKey) continue
  placeUsage[placeKey] = (placeUsage[placeKey] ?? 0) + 1
}

const report = {
  generatedAt: new Date().toISOString(),
  summary: {
    placesWithRenders: 0,
    placesWithMultipleCandidates: 0,
    archetypesWithRenders: 0,
    archetypesWithMultipleCandidates: 0,
  },
  places: [],
  archetypes: [],
}

for (const placeKey of Object.keys(placeUsage).sort()) {
  const files = renderedFiles(OUT_ROOMS, slug(placeKey))
  if (!files.length) continue
  report.summary.placesWithRenders++
  if (files.length > 1) report.summary.placesWithMultipleCandidates++
  const cur = curation.places?.[placeKey] ?? {}
  report.places.push({
    key: placeKey,
    roomCount: placeUsage[placeKey],
    candidates: files,
    curated: cur,
    needsReview: files.length > 1 && !cur.primary,
  })
}

for (const [key, entry] of Object.entries(archetypePrompts)) {
  const files = renderedFiles(OUT_ARCHETYPES, slug(key))
  if (!files.length) continue
  report.summary.archetypesWithRenders++
  if (files.length > 1) report.summary.archetypesWithMultipleCandidates++
  const cur = curation.archetypes?.[key] ?? {}
  report.archetypes.push({
    key,
    zone: entry.matchZone ?? null,
    matchTags: entry.matchTags ?? [],
    candidates: files,
    curated: cur,
    needsReview: files.length > 1 && !cur.primary,
  })
}

mkdirSync('data/art', { recursive: true })
writeFileSync(REPORT, JSON.stringify(report, null, 2))
console.log(`wrote ${REPORT}`)
console.log(`${report.summary.placesWithMultipleCandidates} place subjects and ${report.summary.archetypesWithMultipleCandidates} archetype subjects currently have multiple candidate renders`)
