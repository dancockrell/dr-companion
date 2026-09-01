import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, relative, sep } from 'node:path'

const reviews = JSON.parse(readFileSync('data/art/scene-art-reviews.json', 'utf8'))
const hashReviews = JSON.parse(readFileSync('data/art/dormant-scene-hash-reviews.json', 'utf8'))
const baskets = JSON.parse(readFileSync('data/art/scene-baskets.json', 'utf8'))
const coverage = JSON.parse(readFileSync('data/art/scene-basket-coverage.json', 'utf8'))
const roomMap = JSON.parse(readFileSync('data/art/room-place-map.json', 'utf8'))
const places = JSON.parse(readFileSync('data/art/room-prompts-priority.json', 'utf8'))
const curation = JSON.parse(readFileSync('data/art/room-art-curation.json', 'utf8'))
const grokSource = readFileSync('src/data/grokRoomScenes.ts', 'utf8')
const overrideSource = readFileSync('src/data/roomArtOverrides.ts', 'utf8')
const roots = ['public/rooms', 'public/room-scenes', 'public/grok-art/room-scenes']
const extensions = new Set(['.webp', '.jpg', '.jpeg', '.png'])

const webPath = (file) => '/' + relative('public', file).split(sep).join('/')
const files = roots.flatMap((root) => existsSync(root)
  ? readdirSync(root).filter((name) => extensions.has(extname(name).toLowerCase())).map((name) => join(root, name))
  : [])
const selected = new Map()
const addUsage = (asset, usage) => {
  if (!selected.has(asset)) selected.set(asset, [])
  selected.get(asset).push(usage)
}

for (const assignment of coverage.assignments ?? []) {
  const place = places[assignment.placeKey] ?? {}
  const assets = assignment.category === 'regional-city'
    ? baskets.regionalCity?.[place.zoneName] ?? []
    : baskets.generic?.[assignment.category] ?? []
  const roomCount = assignment.ranges.reduce((sum, [first, last]) => sum + last - first + 1, 0)
  for (const asset of assets) addUsage(asset, {
    selectionTier: 'location-pattern', placeKey: assignment.placeKey,
    category: assignment.category, region: place.zoneName ?? null, roomCount,
  })
}
for (const [placeKey, entry] of Object.entries(curation.publishedOverrides ?? {})) {
  for (const asset of [entry.approvedPrimary, ...(entry.approvedVariants ?? [])].filter(Boolean)) {
    addUsage(asset, { selectionTier: 'curated-landmark', placeKey, category: 'landmark', region: null, roomCount: entry.roomCount ?? null })
  }
}
for (const asset of new Set(grokSource.match(/\/grok-art\/room-scenes\/[^'"\]]+/g) ?? [])) {
  addUsage(asset, { selectionTier: 'semantic-fallback', placeKey: null, category: 'description-keyword-family', region: null, roomCount: null })
}
for (const asset of new Set(overrideSource.match(/\/(?:rooms|room-scenes)\/[^'"\]]+/g) ?? [])) {
  addUsage(asset, { selectionTier: 'curated-override', placeKey: null, category: 'explicit-room-range', region: null, roomCount: null })
}

const rules = (reviews.reviewRules ?? []).map((rule) => ({ ...rule, regex: new RegExp(rule.match) }))
const hashReviewBySha = new Map((hashReviews.reviews ?? []).map((review) => [review.sha256, review]))
const records = files.map((file) => {
  const path = webPath(file)
  const bytes = readFileSync(file)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const generated = reviews.generated?.[path]
  // Hash decisions intentionally apply only to dormant exact-room copies. The same
  // pixels may be valid when deliberately curated under a semantic master path.
  const hashReview = path.startsWith('/rooms/') ? hashReviewBySha.get(sha256) : null
  const rule = rules.find((candidate) => candidate.regex.test(path))
  const roomKey = path.startsWith('/rooms/') ? path.slice('/rooms/'.length).replace(/\.[^.]+$/, '') : null
  const placeKey = roomKey ? roomMap.placeOf?.[roomKey] ?? null : null
  const usage = [...(selected.get(path) ?? [])]
  return {
    path,
    sha256,
    bytes: statSync(file).size,
    format: extname(file).slice(1).toLowerCase(),
    audit: generated || rule || hashReview ? {
      status: 'visually-reviewed', verdict: generated ? 'approved' : hashReview?.verdict ?? rule.verdict, reviewedAt: hashReview?.reviewedAt ?? reviews.reviewedAt,
      method: hashReview?.reviewMethod ?? reviews.reviewMethod, notes: generated ? 'Generated replacement passed visual QA against its prompt and intended runtime basket.' : hashReview?.notes ?? rule.notes,
    } : { status: 'indexed', verdict: 'pending-visual-review', reviewedAt: null, method: null, notes: null },
    semanticTags: generated?.semanticTags ?? hashReview?.semanticTags ?? rule?.semanticTags ?? [],
    intendedRegions: generated?.intendedRegions ?? rule?.intendedRegions ?? [],
    environments: generated?.environments ?? rule?.environments ?? [],
    visualAttributes: generated?.visualAttributes ?? hashReview?.visualAttributes ?? rule?.visualAttributes ?? [],
    usage,
    intendedRoom: roomKey ? { roomKey, placeKey } : null,
    runtimeEligible: usage.length > 0 && rule?.verdict !== 'rejected' && hashReview?.verdict !== 'rejected',
    provenance: generated ? { ...reviews.generationProvenance, ...generated.provenance, prompt: generated.prompt } : {
      provider: path.startsWith('/grok-art/') ? 'Grok source pack' : 'legacy repository asset',
      model: null, generatedAt: null, prompt: null,
    },
    replacementHistory: generated ? [{ action: 'supersedes', assets: generated.supersedes }] : hashReview?.replacedBy ? [{ action: 'superseded-by', assets: hashReview.replacedBy }] : rule?.replacedBy ? [{ action: 'superseded-by', assets: rule.replacedBy }] : [],
  }
}).sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))

const summary = {
  totalAssets: records.length,
  indexedOnly: records.filter((entry) => entry.audit.status === 'indexed').length,
  visuallyReviewed: records.filter((entry) => entry.audit.status === 'visually-reviewed').length,
  approved: records.filter((entry) => entry.audit.verdict === 'approved').length,
  rejected: records.filter((entry) => entry.audit.verdict === 'rejected').length,
  runtimeEligible: records.filter((entry) => entry.runtimeEligible).length,
  runtimeUsageRecords: records.reduce((sum, entry) => sum + entry.usage.length, 0),
}
writeFileSync('data/art/scene-art-catalog.json', JSON.stringify({ schemaVersion: 1, generatedAt: reviews.reviewedAt, summary, assets: records }, null, 2) + '\n')
console.log(JSON.stringify(summary, null, 2))
