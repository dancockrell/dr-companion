/**
 * Room art prompts.
 *
 *   node tools/art-rooms.mjs            write data/art/room-prompts.json
 *   node tools/art-rooms.mjs review 20  print a sample to read
 *
 * DESIGN.md S2.13 puts room art at 23,335 images and calls it the big one. That
 * number is the count of room *descriptions* in the community map corpus, not
 * the count of rooms: 18,490 rooms carry 23,335 descriptions between them,
 * because a room with a day and a night look is stored as two. One room is one
 * image, so the extras are counted and dropped rather than generated.
 *
 * Two sources, same shape, because the map data on a given machine is whichever
 * one that player happens to have:
 *
 *   - Lich's map database, `map-*.json` under the Lich install. Preferred, and
 *     what the travel planner already reads. It does NOT ship with Lich; it
 *     arrives from `;repository download-mapdb`, so on a fresh install there is
 *     nothing here (DESIGN.md S4).
 *   - Genie's map files, `Map*.xml` under the Genie install. The same
 *     cartography from the other direction — Lich's rooms carry `genie_zone`
 *     and `genie_id` pointing straight back at these files.
 *
 * The text needs almost no cleaning, which is worth saying out loud because the
 * bestiary needed a great deal. This is Simutronics' own prose as the game
 * prints it: no wiki headings, no empty template slots, no release notes. What
 * it does carry is XML entities, a UTF-8 BOM, double spaces between sentences,
 * and about seventeen onomatopoeic *drip*s. Those are the whole cleaning job.
 *
 * Zone and title stay out of the prompt on purpose. "Shard" and "Dirge" are
 * proper nouns a model has no idea about and will happily misread as broken
 * glass and funeral music, so they are recorded as metadata and the description
 * is left to carry the image. Rooms with no description at all fall back to the
 * title, which is the only lore there is.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const OUT = 'data/art/room-prompts.json'

/** Where the two map corpora live, in preference order. */
const LICH_DIRS = ['C:/Ruby4Lich5/Lich5/maps', 'C:/Ruby4Lich5/Lich5/data']
const GENIE_DIRS = ['C:/Genie4/Maps']

/**
 * The style, fixed and never varied.
 *
 * Byte-identical to tools/art-creatures.mjs except for the framing clause: a
 * creature card is a full body on a plain dark background, a room is the
 * background. Everything else has to match or the pack looks like two packs.
 * See DESIGN.md S4.
 */
const STYLE =
  'painterly digital illustration, muted naturalistic palette, soft directional ' +
  'light, atmospheric depth, painted texture, wide establishing shot, no people, ' +
  'no text, no watermark, consistent fantasy realism'

const NEGATIVE =
  'text, watermark, signature, logo, frame, border, multiple views, ' +
  'photorealistic, cartoon, anime, cute, chibi'

/** Text that annotates the map rather than describing the room. */
const META = /obvious (?:exits|paths)|^\s*(?:go|type|see) |mapper note|^\s*\[/i

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function clean(text) {
  if (!text) return ''
  return (
    text
      // BOM, which the Genie files all start with and which survives a naive read.
      .replace(/\uFEFF/g, '')
      // Any tag that leaked out of the source markup.
      .replace(/<[^>]*>/g, ' ')
      .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, e) => ENTITIES[e])
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      // Onomatopoeia asterisks: "a gentle *drip*drip*drip* echoes".
      .replace(/\*/g, ' ')
      // Sentence-separating double spaces, and the newlines XML indentation adds.
      .replace(/\s+/g, ' ')
      .replace(/\s+([,.;:!?])/g, '$1')
      .trim()
  )
}

/** Keep only sentences that describe rather than annotate. */
function visualSentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.length > 16 && !META.test(s))
    .join(' ')
    .trim()
}

/**
 * The title, turned into a subject.
 *
 * Room titles are "Zone, Specific Spot" — "Crossing, Town Green". Inside the
 * Crossing the zone half is noise, so it goes; everywhere else the whole title
 * is the only handle on the place. Lich wraps titles in square brackets the way
 * the game prints them and Genie does not, so both are stripped.
 */
function fromTitle(title, zone) {
  let t = String(title ?? '')
    .replace(/^\[|\]$/g, '')
    .trim()
  if (zone && t.toLowerCase().startsWith(`${zone.toLowerCase()},`)) {
    t = t.slice(zone.length + 1).trim()
  }
  return t
}

/**
 * A seed derived from the room id, so the same room is the same image for every
 * player and a regeneration reproduces rather than reinvents. DESIGN.md S2.13
 * makes this a correctness property, not a convenience: two players comparing
 * screenshots of one room must not see two worlds.
 */
function seedOf(id) {
  const s = String(id)
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** First non-empty string in a value Lich may store as a scalar or an array. */
const first = (v) => (Array.isArray(v) ? v.find((x) => x != null) : v)
const listOf = (v) => (Array.isArray(v) ? v.filter((x) => x != null) : v == null ? [] : [v])

// ------------------------------------------------------------- the sources --

/**
 * Lich's map database.
 *
 * A JSON array of rooms. `title` and `description` are arrays because a room
 * can print more than one of each; `location` is the zone name. Read
 * defensively — this file is community-maintained and its shape has moved.
 */
function readLich() {
  for (const dir of LICH_DIRS) {
    if (!existsSync(dir)) continue
    const file = readdirSync(dir)
      .filter((f) => /^map.*\.json$/i.test(f))
      .sort()
      .pop()
    if (!file) continue
    const raw = JSON.parse(readFileSync(join(dir, file), 'utf8'))
    const rooms = (Array.isArray(raw) ? raw : Object.values(raw)).filter(Boolean)
    return {
      source: 'lich',
      where: join(dir, file),
      rooms: rooms.map((r) => ({
        id: String(r.id ?? first(r.uid)),
        zone: r.location ?? null,
        title: fromTitle(first(r.title), r.location),
        descriptions: listOf(r.description).map(clean).filter(Boolean),
      })),
    }
  }
  return null
}

/**
 * Genie's map files.
 *
 * One XML file per zone, `<node>` per room, `<description>` per variant. Parsed
 * with regex rather than a dependency: the files are machine-written, uniformly
 * indented, and carry four entity types between them, so a parser would buy
 * nothing but an install step.
 *
 * Node ids restart at 1 in every zone, so the key has to be zone-scoped. That
 * is also how Lich stores the cross-reference (`genie_zone` + `genie_id`), so
 * the two sources' keys line up rather than colliding.
 */
function readGenie() {
  for (const dir of GENIE_DIRS) {
    if (!existsSync(dir)) continue
    const files = readdirSync(dir).filter((f) => /\.xml$/i.test(f))
    if (!files.length) continue
    const rooms = []
    for (const f of files) {
      const text = readFileSync(join(dir, f), 'utf8')
      const head = text.match(/<zone\b([^>]*)>/)
      const attr = (s, k) => (s.match(new RegExp(`${k}="([^"]*)"`)) || [])[1]
      const zoneId = head ? attr(head[1], 'id') : f
      const zone = (head && attr(head[1], 'name')) || f
      for (const m of text.matchAll(/<node\b([^>]*)>([\s\S]*?)<\/node>/g)) {
        const id = attr(m[1], 'id')
        rooms.push({
          id: `${zoneId}-${id}`,
          zone,
          title: fromTitle(clean(attr(m[1], 'name')), zone),
          descriptions: [...m[2].matchAll(/<description>([\s\S]*?)<\/description>/g)]
            .map((d) => clean(d[1]))
            .filter(Boolean),
        })
      }
    }
    return { source: 'genie', where: dir, rooms }
  }
  return null
}

// ------------------------------------------------------------------- build --

const map = readLich() ?? readGenie()
if (!map) {
  console.error(
    'No map data found.\n' +
      `  Lich:  ${LICH_DIRS.join(', ')}  (map-*.json, from ";repository download-mapdb")\n` +
      `  Genie: ${GENIE_DIRS.join(', ')}  (Map*.xml)`
  )
  process.exit(1)
}

const out = {}
const counts = { described: 0, titleOnly: 0, extraVariants: 0, dropped: 0 }
const byZone = new Map()
const distinct = new Set()

for (const room of map.rooms) {
  // Several descriptions means day and night, or a room the cartographers
  // caught in more than one state. The first is the one to draw; the rest are
  // counted so a later pass can decide whether variants are worth generating.
  const lore = visualSentences(room.descriptions[0] ?? '')
  counts.extraVariants += Math.max(0, room.descriptions.length - 1)
  if (room.descriptions.length && !lore) counts.dropped++

  const subject = room.title || 'an unremarkable place'
  if (lore) counts.described++
  else counts.titleOnly++
  if (lore) distinct.add(lore)

  byZone.set(room.zone ?? 'unknown', (byZone.get(room.zone ?? 'unknown') ?? 0) + 1)

  out[room.id] = {
    source: lore ? `${map.source}+description` : `${map.source}+title`,
    zone: room.zone,
    title: room.title || null,
    variants: room.descriptions.length,
    lore: lore || null,
    prompt: [lore || subject, STYLE].filter(Boolean).join(', '),
    negative: NEGATIVE,
    seed: seedOf(room.id),
    width: 1344,
    height: 768,
  }
}

mkdirSync('data/art', { recursive: true })
writeFileSync(OUT, JSON.stringify(out, null, 1))

const total = Object.keys(out).length
console.log(`source: ${map.source}  ${map.where}`)
console.log(
  `${total} rooms: ${counts.described} carry a description, ${counts.titleOnly} are title only`
)
console.log(
  `${counts.extraVariants} extra descriptions dropped as day/night variants` +
    (counts.dropped ? `, ${counts.dropped} lost every sentence to cleaning` : '')
)
// The number that decides how big the job actually is. Rooms share prose far
// more than the room count suggests — a road is described once and used forty
// times — so identical descriptions can share one image and one seed.
console.log(
  `${distinct.size} distinct descriptions, so ${total - distinct.size - counts.titleOnly} rooms repeat prose another room already has`
)
console.log(`${byZone.size} zones. Top 10 by room count:`)
for (const [zone, n] of [...byZone].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  ${String(n).padStart(5)}  ${zone}`)
}

if (process.argv[2] === 'review') {
  const n = Number(process.argv[3] ?? 10)
  for (const [id, p] of Object.entries(out).slice(0, n)) {
    console.log(`\n### ${id} ${p.title ?? ''}  [${p.source}, ${p.variants} desc, seed ${p.seed}]`)
    console.log(`    ${p.prompt.slice(0, 300)}`)
  }
}
