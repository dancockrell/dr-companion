import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, relative, sep } from 'node:path'

const roots = ['public/rooms', 'public/room-scenes', 'public/grok-art/room-scenes']
const extensions = new Set(['.webp', '.jpg', '.jpeg', '.png'])
const roomMap = JSON.parse(readFileSync('data/art/room-place-map.json', 'utf8'))
const catalog = JSON.parse(readFileSync('data/art/scene-art-catalog.json', 'utf8'))
const runtimePaths = new Set(catalog.assets.filter((asset) => asset.runtimeEligible).map((asset) => asset.path))
const webPath = (file) => '/' + relative('public', file).split(sep).join('/')

const groups = new Map()
for (const root of roots) {
  if (!existsSync(root)) continue
  for (const name of readdirSync(root)) {
    if (!extensions.has(extname(name).toLowerCase())) continue
    const file = join(root, name)
    const path = webPath(file)
    if (runtimePaths.has(path) || !path.startsWith('/rooms/')) continue
    const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex')
    if (!groups.has(sha256)) groups.set(sha256, [])
    groups.get(sha256).push(path)
  }
}

const decisions = {
  approved: new Set([
    '/rooms/2a-46.webp', '/rooms/127-141.webp', '/rooms/95-41.webp',
    '/rooms/99-338.webp', '/rooms/67-319.webp', '/rooms/90-4.webp',
    '/rooms/99-74.webp', '/rooms/107-101.webp', '/rooms/106-49.webp',
    '/rooms/30-4.webp', '/rooms/6-117.webp', '/rooms/127-372.webp',
    '/rooms/67-27.webp', '/rooms/98-125.webp',
  ]),
  rejected: new Set([
    '/rooms/108-1.webp', '/rooms/95-175.webp', '/rooms/95-251.webp', '/rooms/6-26.webp',
    '/rooms/127-20.webp', '/rooms/127-435.webp', '/rooms/7-8.webp', '/rooms/127-164.webp',
    '/rooms/47-73.webp', '/rooms/95-78.webp', '/rooms/90-734.webp', '/rooms/107-31.webp',
    '/rooms/112-73.webp', '/rooms/116-63.webp', '/rooms/90-9.webp', '/rooms/106-117.webp',
    '/rooms/95-84.webp', '/rooms/42-116.webp', '/rooms/1-49.webp', '/rooms/68-138.webp',
    '/rooms/95-2.webp', '/rooms/1-295.webp', '/rooms/66-411.webp', '/rooms/99-118.webp',
    '/rooms/116-2.webp', '/rooms/127-293.webp', '/rooms/4-140.webp', '/rooms/4-301.webp',
    '/rooms/98-25.webp', '/rooms/14b-110.webp', '/rooms/150-18.webp', '/rooms/40a-156.webp',
    '/rooms/14b-2.webp', '/rooms/61-3.webp', '/rooms/67-150.webp', '/rooms/4-372.webp',
    '/rooms/108-31.webp', '/rooms/69-59.webp', '/rooms/41-106.webp', '/rooms/66-388.webp',
    '/rooms/106-14.webp', '/rooms/47-118.webp', '/rooms/127-266.webp', '/rooms/13-29.webp',
    '/rooms/108-34.webp', '/rooms/13-91.webp',
  ]),
}
const replacements = new Map([
  ['/rooms/6-26.webp', ['/room-scenes/curated-hostile-brambles.jpg']],
])

const reviewFor = (representative, paths, verdict) => {
  const places = [...new Set(paths.map((path) => {
    const roomKey = path.slice('/rooms/'.length).replace(/\.[^.]+$/, '')
    return roomMap.placeOf?.[roomKey]
  }).filter(Boolean))].sort()
  const sharedAcrossPlaces = places.length > 1
  return {
    sha256: createHash('sha256').update(readFileSync(`public${representative}`)).digest('hex'),
    verdict,
    reviewedAt: '2026-09-01',
    reviewMethod: 'visual duplicate-group contact-sheet review against assigned room places',
    representative,
    duplicateCount: paths.length,
    intendedPlaces: places,
    semanticTags: verdict === 'approved'
      ? ['legacy-scene', 'visually-coherent', 'preserve-dormant']
      : ['legacy-scene', sharedAcrossPlaces ? 'cross-place-duplicate' : 'assignment-mismatch', 'quarantined'],
    visualAttributes: ['painterly', 'landscape', 'legacy-low-resolution'],
    notes: verdict === 'approved'
      ? 'The pictured environment meaningfully agrees with the assigned place. Preserve as reviewed legacy art, but keep dormant until an explicit high-resolution runtime curation pass.'
      : sharedAcrossPlaces
        ? 'One identical image was assigned across semantically incompatible places. It cannot truthfully represent the full group and is quarantined from future runtime selection.'
        : 'The pictured subject does not meaningfully match this named room family, or contains distracting text/composition defects. Quarantined from future runtime selection.',
    ...(replacements.has(representative) ? { replacedBy: replacements.get(representative) } : {}),
  }
}

const byRepresentative = new Map()
for (const [sha256, paths] of groups) {
  const representative = paths.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))[0]
  byRepresentative.set(representative, { sha256, paths })
}

const reviews = []
for (const [verdict, representatives] of Object.entries(decisions)) {
  for (const representative of representatives) {
    const group = byRepresentative.get(representative)
    if (!group) throw new Error(`Missing dormant duplicate group: ${representative}`)
    reviews.push(reviewFor(representative, group.paths, verdict))
  }
}
reviews.sort((a, b) => b.duplicateCount - a.duplicateCount || a.representative.localeCompare(b.representative))

writeFileSync('data/art/dormant-scene-hash-reviews.json', JSON.stringify({
  schemaVersion: 1,
  generatedAt: '2026-09-01',
  reviewScope: 'The 60 largest dormant exact-room duplicate groups; every duplicate inherits its content-hash decision.',
  pathScope: '/rooms/* exact-room copies only; curated semantic masters with identical pixels retain their own path review.',
  summary: {
    reviewedHashes: reviews.length,
    reviewedAssets: reviews.reduce((sum, review) => sum + review.duplicateCount, 0),
    approvedHashes: reviews.filter((review) => review.verdict === 'approved').length,
    rejectedHashes: reviews.filter((review) => review.verdict === 'rejected').length,
  },
  reviews,
}, null, 2) + '\n')

console.log(`Reviewed ${reviews.length} hashes covering ${reviews.reduce((sum, review) => sum + review.duplicateCount, 0)} dormant assets.`)
