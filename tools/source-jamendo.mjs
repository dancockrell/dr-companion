/**
 * Bulk-source radio tracks from Jamendo instead of Wikimedia Commons -
 * built 29 Aug 2026 after the Salt and Sail cleanup showed what Commons
 * actually gives you for niche genres (sea shanties, Arabic/oriental folk):
 * a handful of real performances buried in stock-library "shanty"-named
 * instrumentals, hobbyist covers, and things with nothing to do with the
 * genre at all, because Commons has no popularity signal at all - every
 * upload is equally "findable" whether it's a real recording or a demo
 * clip. Dan's call: "we aren't going to get it from wikipedia, that's
 * purposely bad. royalty free with great metadata is a thing." Jamendo is
 * that thing - a real API with genre tags, an actual popularity order, and
 * a license field read from the response, same discipline
 * tools/source-radio.mjs already uses for Commons, just a different API
 * shape.
 *
 * # Setup: a free client_id
 *
 * Every request needs one - register free at https://devportal.jamendo.com
 * (no payment info for the free tier), then either:
 *   JAMENDO_CLIENT_ID=xxxxx node tools/source-jamendo.mjs ...
 *   node tools/source-jamendo.mjs --client-id xxxxx ...
 *
 * # What it automates, and why each step exists
 *
 *   1. Query /tracks with `tags` (AND-matched) or `fuzzytags` (OR-matched),
 *      `order=popularity_total` by default - "great metadata" means the API
 *      itself ranks by real popularity (favorites/downloads/plays), not a
 *      proxy this tool has to invent.
 *   2. `include=musicinfo+licenses` pulls genre/mood tags and the license
 *      URL in the same request - no second round trip per candidate.
 *   3. License gate: only `by` and `by-sa` (parsed from `license_ccurl`,
 *      e.g. .../licenses/by-nc-nd/3.0/ -> "by-nc-nd") pass. Jamendo's
 *      default catalog leans heavily `by-nc-nd` (no commercial use, no
 *      derivatives) - this app ships commercially (CLAUDE.md's own
 *      licensing rule), so nc/nd tracks are rejected before a download is
 *      even attempted, not filtered out after the fact.
 *   4. Download the track's own `audiodownload` URL, reject a suspicious
 *      response (small or HTML-typed) the same way vendor-audio.mjs and
 *      source-radio.mjs both do.
 *   5. ffprobe the real duration, reject under MIN_SECONDS - the same
 *      "real, correctly licensed, and too short" trap source-radio.mjs's
 *      own header describes.
 *   6. Append survivors to data/audio/manifest.json, skipping an id already
 *      present so re-running is safe.
 *
 * Usage:
 *   JAMENDO_CLIENT_ID=xxx node tools/source-jamendo.mjs --station salt-and-sail --tags shanty,sailor,sea --limit 30
 *   JAMENDO_CLIENT_ID=xxx node tools/source-jamendo.mjs --station silk-road --fuzzytags arabic,oriental,oud --limit 30 --dry-run
 *
 * `--dry-run` reports candidates - id, title, artist, tags, license,
 * popularity rank - without downloading or writing. Always read it before
 * trusting a batch: this finds candidates by tag and popularity, it does
 * not have taste, and Jamendo's tag vocabulary is user-submitted and noisy
 * same as any folksonomy.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const manifestPath = join(root, 'data/audio/manifest.json')
const audioDir = join(root, 'public/audio')

const API = 'https://api.jamendo.com/v3.0/tracks/'
const MIN_SECONDS = 90
// Only licenses that permit commercial use without requiring share-alike
// on the whole app or forbidding derivatives outright - "by" (attribution
// only) and "by-sa" (attribution + share-alike, fine for a standalone
// audio file, not for the app's own code). Everything else Jamendo issues
// (by-nc, by-nd, by-nc-nd, by-nc-sa) carries a non-commercial or
// no-derivatives term this app's commercial shipping can't accept.
const ALLOWED_LICENSE_SLUGS = new Set(['by', 'by-sa'])

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const CLIENT_ID = arg('client-id', process.env.JAMENDO_CLIENT_ID)
const STATION = arg('station')
const TAGS = arg('tags') // AND-matched
const FUZZYTAGS = arg('fuzzytags') // OR-matched
const SEARCH = arg('search') // free text across name/artist/album/tags
const LIMIT = Number(arg('limit', '30'))
const ORDER = arg('order', 'popularity_total')
const MOOD = arg('mood')
const DRY_RUN = process.argv.includes('--dry-run')

if (!CLIENT_ID) {
  console.error(
    'no client_id - register free at https://devportal.jamendo.com and pass it as ' +
      'JAMENDO_CLIENT_ID=xxx or --client-id xxx'
  )
  process.exit(1)
}
if (!STATION || (!TAGS && !FUZZYTAGS && !SEARCH)) {
  console.error(
    'usage: node tools/source-jamendo.mjs --station <id> (--tags a,b | --fuzzytags a,b | --search "text") [--limit N] [--order popularity_total] [--dry-run]'
  )
  process.exit(1)
}

function slugify(s) {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/** ".../licenses/by-nc-nd/3.0/" -> "by-nc-nd". Null if the URL doesn't
 * look like a creativecommons.org license path at all - refuse, don't
 * guess at a license from a shape this tool doesn't recognize. */
function licenseSlug(ccUrl) {
  const m = /creativecommons\.org\/licenses\/([a-z-]+)\//i.exec(ccUrl ?? '')
  return m ? m[1].toLowerCase() : null
}

async function ffprobeSeconds(path) {
  try {
    const out = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path],
      { encoding: 'utf8' }
    )
    const n = Number(out.trim())
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

async function searchJamendo() {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    format: 'json',
    limit: String(Math.min(200, LIMIT)),
    order: ORDER,
    include: 'musicinfo+licenses',
    audioformat: 'mp32',
  })
  if (TAGS) params.set('tags', TAGS)
  if (FUZZYTAGS) params.set('fuzzytags', FUZZYTAGS)
  if (SEARCH) params.set('search', SEARCH)

  const res = await fetch(`${API}?${params}`)
  if (!res.ok) throw new Error(`Jamendo API ${res.status}: ${await res.text()}`)
  const data = await res.json()
  if (data.headers?.status !== 'success') {
    throw new Error(`Jamendo API error: ${data.headers?.error_message ?? JSON.stringify(data.headers)}`)
  }
  return data.results ?? []
}

async function main() {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (!manifest.radioStations?.[STATION]) {
    console.error(`unknown station "${STATION}" - add it to manifest.json's radioStations first`)
    process.exit(1)
  }
  const existingIds = new Set((manifest.radio ?? []).map((t) => t.id))

  console.log(
    `querying Jamendo (${TAGS ? `tags=${TAGS}` : FUZZYTAGS ? `fuzzytags=${FUZZYTAGS}` : `search="${SEARCH}"`}, order=${ORDER}, up to ${LIMIT})...`
  )
  const hits = await searchJamendo()
  console.log(`${hits.length} candidates found`)
  if (!hits.length) return

  const added = []
  const rejected = []

  for (const [rank, track] of hits.entries()) {
    const slug = licenseSlug(track.license_ccurl)
    if (!slug || !ALLOWED_LICENSE_SLUGS.has(slug)) {
      rejected.push({ title: track.name, reason: `licence not allowed: ${slug ?? track.license_ccurl ?? 'unknown'}` })
      continue
    }

    const id = slugify(`${track.artist_name}-${track.name}`)
    if (existingIds.has(id)) {
      rejected.push({ title: track.name, reason: `id already in manifest: ${id}` })
      continue
    }

    const tags = track.musicinfo?.tags
      ? [...(track.musicinfo.tags.genres ?? []), ...(track.musicinfo.tags.vartags ?? [])]
      : []

    if (DRY_RUN) {
      added.push({ rank: rank + 1, id, title: track.name, artist: track.artist_name, tags, license: slug })
      continue
    }

    const dest = join(audioDir, `radio/${id}.mp3`)
    if (existsSync(dest)) {
      rejected.push({ title: track.name, reason: 'file already on disk, not re-fetched' })
      continue
    }

    mkdirSync(dirname(dest), { recursive: true })
    const res = await fetch(track.audiodownload)
    if (!res.ok) {
      rejected.push({ title: track.name, reason: `download failed (${res.status})` })
      continue
    }
    const contentType = res.headers.get('content-type') ?? ''
    const buf = Buffer.from(await res.arrayBuffer())
    if (contentType.includes('html') || buf.length < 10_000) {
      rejected.push({ title: track.name, reason: `suspicious response (${contentType}, ${buf.length}B)` })
      continue
    }
    writeFileSync(dest, buf)

    const seconds = await ffprobeSeconds(dest)
    if (seconds === null || seconds < MIN_SECONDS) {
      rejected.push({ title: track.name, reason: `too short: ${seconds === null ? 'unreadable' : seconds.toFixed(0) + 's'}` })
      try {
        execFileSync(process.platform === 'win32' ? 'cmd' : 'rm', process.platform === 'win32' ? ['/c', 'del', '/q', dest] : [dest])
      } catch {
        // Best effort - an orphaned file with no manifest entry is caught by
        // ambient-test.mjs's own coverage the next time it runs.
      }
      continue
    }

    existingIds.add(id)
    added.push({
      id,
      station: STATION,
      file: `radio/${id}.mp3`,
      title: track.name,
      composer: track.artist_name,
      era: '',
      ...(MOOD ? { mood: MOOD } : {}),
      ...(tags.length ? { tags } : {}),
      source: track.shareurl ?? `https://www.jamendo.com/track/${track.id}`,
      download: track.audiodownload,
      license: `CC ${slug.toUpperCase()}`,
      licenseUrl: track.license_ccurl,
      attributionRequired: true,
      attributionText: `"${track.name}" by ${track.artist_name}, via Jamendo, CC ${slug.toUpperCase()}`,
      note: 'Added by tools/source-jamendo.mjs, ranked by Jamendo popularity - review before treating as finished.',
      jamendoRank: rank + 1,
      durationSeconds: Math.round(seconds),
    })
    console.log(`  + ${id} (#${rank + 1} popularity, ${seconds.toFixed(0)}s, CC ${slug.toUpperCase()})`)
  }

  console.log(`\n${added.length} added, ${rejected.length} rejected`)
  if (rejected.length) {
    console.log('\nrejected:')
    for (const r of rejected) console.log(`  - ${r.title}: ${r.reason}`)
  }

  if (DRY_RUN) {
    console.log('\ncandidates (would add, ranked by Jamendo popularity):')
    for (const a of added) {
      console.log(`  #${a.rank} ${a.id} - "${a.title}" by ${a.artist} [${a.tags.join(', ') || 'no tags'}] (${a.license})`)
    }
    console.log('\n--dry-run: nothing downloaded, manifest not written')
    return
  }

  if (added.length) {
    manifest.radio.push(...added.map(({ durationSeconds: _durationSeconds, jamendoRank: _jamendoRank, ...t }) => t))
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    console.log(`\nmanifest.json updated with ${added.length} new track(s)`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
