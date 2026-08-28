/**
 * Bulk-source radio tracks from Wikimedia Commons and add them to the
 * manifest, automated rather than one track per manual round trip - Dan's
 * scale-up from thirteen tracks to "hundreds" makes hand-picking each one
 * the wrong shape of work.
 *
 * What it automates, and why each step exists:
 *
 *   1. Search Commons for a query, paginated (`srlimit` maxes at 50/call).
 *   2. Batch-check licence via `imageinfo` - up to 50 titles per request,
 *      not one call per candidate. A licence is read from the API's own
 *      `LicenseShortName`, never guessed from a filename.
 *   3. Reject anything not in ALLOWED_LICENSES up front, before spending a
 *      download on it.
 *   4. Download with a real User-Agent (Wikimedia 200s a small HTML/text
 *      body to requests without one - see vendor-audio.mjs's own comment on
 *      this, discovered the hard way).
 *   5. Reject a "suspicious response" (small or HTML-typed) the same way
 *      vendor-audio.mjs does, so a bad download doesn't silently become a
 *      manifest entry.
 *   6. ffprobe the real duration and reject under MIN_SECONDS. This is the
 *      check that would have caught the three demo clips that got in before
 *      Dan flagged it - "real, correctly licensed, and too short" passes
 *      every check above it.
 *   7. Append survivors to data/audio/manifest.json under the given
 *      station, skipping an id already present so re-running is safe.
 *
 * Usage:
 *   node tools/source-radio.mjs --station old-concert-hall --query "brahms symphony" --limit 30
 *   node tools/source-radio.mjs --station six-strings --query "classical guitar sor" --limit 30 --dry-run
 *
 * `--dry-run` reports what would be added without downloading or writing.
 * Always look at the report before trusting a batch - this finds candidates,
 * it does not have taste, and a query like "video game" will find exactly
 * what it sounds like it will find.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const manifestPath = join(root, 'data/audio/manifest.json')
const audioDir = join(root, 'public/audio')

const UA = 'dr-companion-audio-fetch/1.0 (dancockrell@gmail.com)'
const MIN_SECONDS = 90
const ALLOWED_LICENSES = [
  'Public domain',
  'CC0',
  'CC BY',
  'CC BY-SA',
  // Wikimedia's LicenseShortName carries version/jurisdiction suffixes
  // ("CC BY-SA 4.0", "CC BY-SA 2.0 DE") - matched as a prefix below, not
  // listed exhaustively here.
]

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const STATION = arg('station')
const QUERY = arg('query')
const LIMIT = Number(arg('limit', '30'))
const DRY_RUN = process.argv.includes('--dry-run')
/**
 * A loose mood tag applied to every track this run adds - "dark", "pastoral",
 * "festive", "mysterious", whatever fits the batch. Not inferred from the
 * music (that needs a human ear, or at least a human picking the search
 * query with a mood in mind); this just records the curator's intent at
 * source time; matching mood to zone/biome is future work, not built yet -
 * see docs/AUDIO.md. Dan's example: Brahms' darker symphonic movements suit
 * undead/dungeon areas, which a plain composer-name query wouldn't capture.
 */
const MOOD = arg('mood')

if (!STATION || !QUERY) {
  console.error('usage: node tools/source-radio.mjs --station <id> --query "<search terms>" [--limit N] [--dry-run]')
  process.exit(1)
}

function licenseAllowed(name) {
  if (!name) return false
  return ALLOWED_LICENSES.some((a) => name.startsWith(a))
}

async function commonsFetch(params) {
  const url = `https://commons.wikimedia.org/w/api.php?${new URLSearchParams({
    format: 'json',
    ...params,
  })}`
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`Commons API ${res.status} for ${params.action}`)
  return res.json()
}

/** Search, paginating until `limit` results or the API runs out. */
async function search(query, limit) {
  const out = []
  let sroffset
  while (out.length < limit) {
    const params = {
      action: 'query',
      list: 'search',
      srsearch: `filetype:audio ${query}`,
      srnamespace: '6',
      srlimit: String(Math.min(50, limit - out.length)),
    }
    if (sroffset !== undefined) params.sroffset = String(sroffset)
    const data = await commonsFetch(params)
    const hits = data.query?.search ?? []
    out.push(...hits)
    if (!data.continue?.sroffset || hits.length === 0) break
    sroffset = data.continue.sroffset
  }
  return out.slice(0, limit)
}

/** Batch imageinfo for up to 50 pageids at once. */
async function imageInfoBatch(pageids) {
  const data = await commonsFetch({
    action: 'query',
    pageids: pageids.join('|'),
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|size',
  })
  return data.query?.pages ?? {}
}

function slugify(title) {
  return title
    .replace(/^File:/, '')
    .replace(/\.(ogg|oga|mp3|wav|flac)$/i, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

function extOf(url) {
  const m = url.match(/\.([a-z0-9]+)(?:\?|$)/i)
  return m ? m[1].toLowerCase() : 'bin'
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

async function main() {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (!manifest.radioStations?.[STATION]) {
    console.error(`unknown station "${STATION}" - add it to manifest.json's radioStations first`)
    process.exit(1)
  }
  const existingIds = new Set((manifest.radio ?? []).map((t) => t.id))

  console.log(`searching Commons for "${QUERY}" (up to ${LIMIT} results)...`)
  const hits = await search(QUERY, LIMIT)
  console.log(`${hits.length} candidates found`)
  if (!hits.length) return

  const added = []
  const rejected = []

  // Batch license checks 50 at a time rather than one request per candidate.
  for (let i = 0; i < hits.length; i += 50) {
    const batch = hits.slice(i, i + 50)
    const pages = await imageInfoBatch(batch.map((h) => h.pageid))

    for (const hit of batch) {
      const page = pages[String(hit.pageid)]
      const info = page?.imageinfo?.[0]
      if (!info) {
        rejected.push({ title: hit.title, reason: 'no imageinfo' })
        continue
      }
      const license = info.extmetadata?.LicenseShortName?.value
      if (!licenseAllowed(license)) {
        rejected.push({ title: hit.title, reason: `licence not allowed: ${license ?? 'unknown'}` })
        continue
      }

      const id = slugify(hit.title)
      if (existingIds.has(id)) {
        rejected.push({ title: hit.title, reason: `id already in manifest: ${id}` })
        continue
      }

      if (DRY_RUN) {
        added.push({
          id,
          title: hit.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, ''),
          license,
          sourceUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(hit.title)}`,
          download: info.url,
        })
        continue
      }

      const ext = extOf(info.url)
      const file = `radio/${id}.${ext}`
      const dest = join(audioDir, file)

      if (existsSync(dest)) {
        rejected.push({ title: hit.title, reason: 'file already on disk, not re-fetched' })
        continue
      }

      mkdirSync(dirname(dest), { recursive: true })
      const res = await fetch(info.url, { headers: { 'User-Agent': UA } })
      if (!res.ok) {
        rejected.push({ title: hit.title, reason: `download failed (${res.status})` })
        continue
      }
      const contentType = res.headers.get('content-type') ?? ''
      const buf = Buffer.from(await res.arrayBuffer())
      if (contentType.includes('html') || buf.length < 10_000) {
        rejected.push({ title: hit.title, reason: `suspicious response (${contentType}, ${buf.length}B)` })
        continue
      }
      writeFileSync(dest, buf)

      const seconds = await ffprobeSeconds(dest)
      if (seconds === null || seconds < MIN_SECONDS) {
        rejected.push({
          title: hit.title,
          reason: `too short: ${seconds === null ? 'unreadable' : seconds.toFixed(0) + 's'}`,
        })
        // A rejected file is deleted rather than left as an orphan with no
        // manifest entry - the same "no untracked file in public/audio/"
        // rule vendor-audio.mjs's own header states.
        try {
          execFileSync(process.platform === 'win32' ? 'cmd' : 'rm', process.platform === 'win32' ? ['/c', 'del', '/q', dest] : [dest])
        } catch {
          // Best effort. A leftover file with no manifest entry will be
          // caught by ambient-test.mjs's coverage the next time it runs.
        }
        continue
      }

      existingIds.add(id)
      added.push({
        id,
        station: STATION,
        file,
        title: hit.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, ''),
        composer: '',
        era: '',
        ...(MOOD ? { mood: MOOD } : {}),
        source: `https://commons.wikimedia.org/wiki/${encodeURIComponent(hit.title)}`,
        download: info.url,
        license,
        licenseUrl: '',
        attributionRequired: !license.startsWith('Public domain') && !license.startsWith('CC0'),
        attributionText: license.startsWith('Public domain') || license.startsWith('CC0')
          ? undefined
          : `"${hit.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '')}", via Wikimedia Commons, ${license}`,
        note: 'Added by tools/source-radio.mjs - composer/era not filled in, review before treating as finished.',
        durationSeconds: Math.round(seconds),
      })
      console.log(`  + ${id} (${seconds.toFixed(0)}s, ${license})`)
    }
  }

  console.log(`\n${added.length} added, ${rejected.length} rejected`)
  if (rejected.length) {
    console.log('\nrejected:')
    for (const r of rejected) console.log(`  - ${r.title}: ${r.reason}`)
  }

  if (DRY_RUN) {
    console.log('\n--dry-run: nothing downloaded, manifest not written')
    return
  }

  if (added.length) {
    manifest.radio.push(...added.map(({ durationSeconds: _durationSeconds, ...t }) => t))
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    console.log(`\nmanifest.json updated with ${added.length} new track(s)`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
