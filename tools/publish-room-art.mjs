/**
 * Wires the generated archetype/place art into the room picture-viewer with
 * zero code changes — src/lib/roomText.ts's roomArtUrl() already resolves
 * to /rooms/{zone}-{room}.webp for every room; this just makes that path
 * exist for all 17,750 rooms by hard-linking each room key to whichever
 * shared image (a distinct place render, or a generic zone/archetype
 * fallback) it belongs to. A hard link shares the same bytes on disk, so
 * "one picture in multiple places" costs nothing extra — not a copy, and
 * reusing one picture across many ordinary rooms is the intended design
 * (Dan, 28 Aug 2026), not a shortcut: there is no budget for one render per
 * room, and there does not need to be — a road is a road. What the render
 * budget should go toward is the *specific* match, not just any zone shot,
 * which is what the scoring below is for.
 *
 *   node tools/publish-room-art.mjs
 *
 * Re-run any time generation progresses further. Unlike the first version,
 * this one does not stop at "a link already exists" — every room's link is
 * recomputed and swapped to the best current match, because a room linked
 * early to a generic zone establishing shot should upgrade to a rendered
 * "forge"/"market street"/"temple" archetype the moment one exists, not
 * keep the first thing that was ever available. A hard link is nearly free
 * to redo, so there is no cost to always re-deciding.
 */
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT_ARCHETYPES = 'data/art/out/archetypes'
const OUT_ROOMS = 'data/art/out/rooms'
const DEST = 'public/rooms'

const placeMap = JSON.parse(readFileSync('data/art/room-place-map.json', 'utf8'))
const priorityRooms = JSON.parse(readFileSync('data/art/room-prompts-priority.json', 'utf8'))
const archetypePrompts = JSON.parse(readFileSync('data/art/archetype-prompts.json', 'utf8'))
const allRooms = JSON.parse(readFileSync('data/art/room-prompts.json', 'utf8'))
const curation = existsSync('data/art/room-art-curation.json')
  ? JSON.parse(readFileSync('data/art/room-art-curation.json', 'utf8'))
  : { places: {}, archetypes: {} }

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** Every rendered file for a subject slug, newest first (a fresher seed wins a tie). */
function renderedFiles(dir, subjectSlug) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.startsWith(subjectSlug + '--') && f.endsWith('.webp'))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
}

function curatedFiles(kind, subjectKey, dir, subjectSlug) {
  const files = renderedFiles(dir, subjectSlug)
  if (!files.length) return []

  const spec = (kind === 'place' ? curation.places?.[subjectKey] : curation.archetypes?.[subjectKey]) ?? {}
  const reject = new Set(spec.reject ?? [])
  const allowed = files.filter((f) => !reject.has(f.split(/[/\\]/).pop()))

  if (!allowed.length) return []

  const byName = new Map(allowed.map((f) => [f.split(/[/\\]/).pop(), f]))
  const preferred = []

  if (spec.primary && byName.has(spec.primary)) preferred.push(byName.get(spec.primary))
  for (const name of spec.variants ?? []) {
    if (byName.has(name) && !preferred.includes(byName.get(name))) preferred.push(byName.get(name))
  }

  // If a subject is curated at all, only the explicit keepers participate in
  // publishing. That lets us junk mediocre alternates without physically
  // deleting them from the raw render directory, and it keeps a newer bad seed
  // from silently replacing the known good one.
  if (spec.primary || (spec.variants?.length ?? 0) > 0 || (spec.reject?.length ?? 0) > 0) {
    return preferred.length ? preferred : allowed
  }

  return allowed
}

function choosePublishedFile(kind, subjectKey, dir, subjectSlug, roomKey) {
  const files = curatedFiles(kind, subjectKey, dir, subjectSlug)
  if (!files.length) return null
  const spec = (kind === 'place' ? curation.places?.[subjectKey] : curation.archetypes?.[subjectKey]) ?? {}
  const hasExplicitVariants = (spec.variants?.length ?? 0) > 0
  if (!hasExplicitVariants) return files[0]

  // Stable per room: the same room gets the same approved variant every run,
  // but neighbouring rooms in the same place can still vary when there are
  // several strong images worth reusing.
  let h = 2166136261
  for (let i = 0; i < roomKey.length; i++) {
    h ^= roomKey.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return files[(h >>> 0) % files.length]
}

/**
 * Zone name -> its archetype entries (key + matchTags), built once.
 *
 * Kept as full entries rather than just keys now, because picking the best
 * one for a room needs the tags to score against, not just a rendered file
 * to grab first.
 */
const zoneArchetypes = {}
for (const [key, entry] of Object.entries(archetypePrompts)) {
  if (entry.matchZone) {
    zoneArchetypes[entry.matchZone] = zoneArchetypes[entry.matchZone] ?? []
    zoneArchetypes[entry.matchZone].push({ key, tags: (entry.matchTags ?? []).map((t) => t.toLowerCase()) })
  }
}

/**
 * The best-matching rendered archetype for this room, out of everything
 * rendered for its zone — scored by how many of the candidate's matchTags
 * show up in the room's own title+lore, not just whichever rendered first.
 *
 * A "forge" room in Fang Cove should get the Fang Cove forge archetype over
 * the Fang Cove bank archetype the moment both exist; before this, whichever
 * happened to render first (and get linked first) stuck permanently. Ties —
 * including the common case of no tag matching at all, which is most rooms,
 * since most rooms are unremarkable stretches of road — fall back to the
 * zone's plain establishing shot, first in the list by construction (see
 * art-archetypes.mjs: zone-establishing entries come before the town-shard
 * ones for exactly this tie-break).
 */
/**
 * Word-boundary matching, not `includes`. A naive substring check scored
 * "hall" as present in a room described as having "shallow steps" — a false
 * match found by hand-checking the very first upgrade this produced, before
 * trusting the scoring at 17,750-room scale. Short common tag words (hall,
 * order, cove) are exactly where a substring check breaks: they hide inside
 * ordinary words far more often than a longer, more specific tag does.
 */
function tagPresent(tag, text) {
  return new RegExp(`\\b${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)
}

function zoneFallback(roomKey, zoneName, roomText) {
  const candidates = zoneArchetypes[zoneName] ?? []
  let best = null
  let bestScore = -1
  for (const { key, tags } of candidates) {
    const f = choosePublishedFile('archetype', key, OUT_ARCHETYPES, slug(key), roomKey)
    if (!f) continue
    const score = tags.filter((t) => t && tagPresent(t, roomText)).length
    if (score > bestScore) {
      bestScore = score
      best = f
    }
  }
  return best
}

mkdirSync(DEST, { recursive: true })

const audit = {
  generatedAt: new Date().toISOString(),
  totals: { linked: 0, upgraded: 0, unchanged: 0, noSourceYet: 0 },
  sources: {},
}

function recordUsage(roomKey, sourcePath, sourceType, subjectKey) {
  const name = sourcePath.split(/[/\\]/).pop()
  audit.sources[name] = audit.sources[name] ?? {
    file: name,
    sourceType,
    subjectKey,
    roomKeys: [],
  }
  audit.sources[name].roomKeys.push(roomKey)
}

let linked = 0
let upgraded = 0
let unchanged = 0
let noSourceYet = 0

for (const [roomKey, roomEntry] of Object.entries(allRooms)) {
  const dest = join(DEST, `${roomKey}.webp`)
  const roomText = `${roomEntry.title ?? ''} ${roomEntry.lore ?? ''}`.toLowerCase()

  const placeKey = placeMap.placeOf[roomKey]
  let src = null
  let sourceType = null
  let sourceSubjectKey = null

  if (placeKey && priorityRooms[placeKey]) {
    // A distinct place with its own unique render — always wins over a
    // reused archetype once it exists, however good the archetype match is.
    src = choosePublishedFile('place', placeKey, OUT_ROOMS, slug(placeKey), roomKey)
    if (src) {
      sourceType = 'place'
      sourceSubjectKey = placeKey
    }
  }
  if (!src) {
    // Generic terrain group, or a distinct place that hasn't rendered yet —
    // the best-matching reusable archetype for this zone. Long-tail places
    // (a one-off festival tent, a unique landmark with no render yet) are
    // exactly what this falls back to a plain zone shot for rather than
    // inventing a specific match that doesn't exist — see room-prompts-
    // priority.json, which is where a place earns its own render instead.
    src = zoneFallback(roomKey, roomEntry.zoneName, roomText)
    if (src) {
      sourceType = 'archetype'
      const candidates = zoneArchetypes[roomEntry.zoneName] ?? []
      let bestKey = null
      let bestScore = -1
      for (const { key, tags } of candidates) {
        const f = choosePublishedFile('archetype', key, OUT_ARCHETYPES, slug(key), roomKey)
        if (!f || f !== src) continue
        const score = tags.filter((t) => t && tagPresent(t, roomText)).length
        if (score > bestScore) {
          bestScore = score
          bestKey = key
        }
      }
      sourceSubjectKey = bestKey
    }
  }

  if (!src) {
    noSourceYet++
    audit.totals.noSourceYet = noSourceYet
    continue
  }

  const already = existsSync(dest)
  if (already) {
    // Hard links to the same file share an inode — this is how "already the
    // best match" is told apart from "linked to something now superseded"
    // without re-reading either image.
    if (statSync(dest).ino === statSync(src).ino) {
      unchanged++
      recordUsage(roomKey, src, sourceType, sourceSubjectKey)
      continue
    }
    unlinkSync(dest)
  }

  try {
    linkSync(src, dest)
    if (already) upgraded++
    else linked++
    recordUsage(roomKey, src, sourceType, sourceSubjectKey)
    audit.totals.linked = linked
    audit.totals.upgraded = upgraded
  } catch {
    noSourceYet++
    audit.totals.noSourceYet = noSourceYet
  }
}

audit.totals.unchanged = unchanged
writeFileSync('data/art/room-art-usage.json', JSON.stringify(audit, null, 2))

console.log(
  `${linked} newly linked, ${upgraded} upgraded to a better match, ${unchanged} already the best match, ${noSourceYet} have no source yet`
)
console.log('wrote data/art/room-art-usage.json')
