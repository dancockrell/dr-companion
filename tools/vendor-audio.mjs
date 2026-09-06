/**
 * Pull ambient/music/radio audio into public/audio/, from the sources
 * recorded in data/audio/manifest.json.
 *
 * Same shape as tools/vendor-fetch.mjs for Ruby4Lich5 and the room-art
 * daemon's queue: the manifest is the source of truth, the files themselves
 * are gitignored and regenerable, and a clean checkout has none of them until
 * this runs. Run it after adding a manifest entry, and before expecting the
 * app to play anything beyond what is already fetched.
 *
 *   node tools/vendor-audio.mjs                fetch anything missing
 *   node tools/vendor-audio.mjs --check        report what's missing, fetch nothing
 *   node tools/vendor-audio.mjs --record       write sha256 + bytes into the manifest
 *   node tools/vendor-audio.mjs --attributions rewrite data/audio/ATTRIBUTIONS.md from the manifest
 *
 * `--record` exists because the app can now install this library itself
 * (`src-tauri/src/music.rs`), and a download it cannot verify is not one it
 * should make. It hashes what is on disk and writes `sha256` and `bytes` back
 * into each manifest entry, so the pins are measured from real bytes rather
 * than copied from a header. That distinction is not pedantry: a HEAD sweep of
 * these same 182 URLs came back rate-limited and reported 168 of them as 2144
 * bytes, the length of Wikimedia's error page, which reads exactly like a
 * small file.
 *
 * Once an entry is pinned, `fetchOne` verifies against it, so a fetch that
 * comes back wrong is refused here as well as in the app.
 *
 * `--attributions` exists because hand-maintaining a credits list stopped
 * being realistic once tools/source-radio.mjs made it normal to add dozens
 * of tracks in one run - at 13 tracks reconciling ATTRIBUTIONS.md by eye was
 * fine; past a hundred it is exactly the kind of bookkeeping a human will
 * quietly let drift. Generated, not hand-edited: any wording added directly
 * to ATTRIBUTIONS.md is lost the next time this runs.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const manifestPath = join(root, 'data/audio/manifest.json')
const audioDir = join(root, 'public/audio')
const attributionsPath = join(root, 'data/audio/ATTRIBUTIONS.md')

const CHECK_ONLY = process.argv.includes('--check')
const ATTRIBUTIONS_ONLY = process.argv.includes('--attributions')
const RECORD = process.argv.includes('--record')

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/** Every entry in the manifest, flattened, with its own kind attached. */
function entries(manifest) {
  const out = []
  for (const [key, e] of Object.entries(manifest.biome ?? {})) {
    out.push({ kind: 'biome', key, ...e })
  }
  for (const [key, e] of Object.entries(manifest.zone ?? {})) {
    out.push({ kind: 'zone', key, ...e })
  }
  for (const e of manifest.radio ?? []) {
    out.push({ kind: 'radio', key: e.id, ...e })
  }
  return out
}

async function fetchOne(e) {
  const dest = join(audioDir, e.file)
  if (existsSync(dest)) return { ...e, status: 'present' }
  if (CHECK_ONLY) return { ...e, status: 'missing' }
  if (!e.download) return { ...e, status: 'no-download-url' }

  mkdirSync(dirname(dest), { recursive: true })
  // Wikimedia rejects a request with no identifying User-Agent - confirmed
  // directly with `curl -H "User-Agent:"`, which got back "Please set a
  // user-agent and respect our robot policy" as a 200 of a few hundred
  // bytes, not a 4xx. Several sourcing downloads in this file's history
  // came back as small HTML/text bodies sitting where audio should be;
  // whether every one of those was this exact cause or something else
  // (e.g. rate limiting) was never isolated, but this header is real
  // protection against the confirmed case and costs nothing to send always.
  const res = await fetch(e.download, {
    headers: { 'User-Agent': 'dr-companion-audio-fetch/1.0 (dancockrell@gmail.com)' },
  })
  if (!res.ok) return { ...e, status: `fetch-failed (${res.status})` }
  const contentType = res.headers.get('content-type') ?? ''
  const buf = Buffer.from(await res.arrayBuffer())

  // A 200 with a tiny or HTML body is the "looked like success" failure
  // mode itself, whatever causes it - the check that catches it without the
  // sizes having to be compared by eye.
  if (contentType.includes('html') || buf.length < 10_000) {
    return { ...e, status: `suspicious-response (${contentType || 'no content-type'}, ${buf.length} bytes)` }
  }

  // A pinned entry is checked before it lands. Same hash the app checks in
  // `download_verified`, so a source that changes under us fails in one place
  // rather than being fetched here and rejected there.
  if (e.sha256) {
    const actual = sha256(buf)
    if (actual !== e.sha256) {
      return { ...e, status: `sha-mismatch (expected ${e.sha256.slice(0, 12)}, got ${actual.slice(0, 12)})` }
    }
  }

  writeFileSync(dest, buf)
  return { ...e, status: `fetched (${buf.length} bytes)` }
}

/**
 * Hash every file that is on disk and write the pins back into the manifest.
 *
 * Reports how many entries it looked at and how many it could not pin, and
 * refuses to write when it pinned nothing - an empty pass and a pass over an
 * empty directory print the same "done" otherwise.
 */
function record(manifest) {
  // `zone` entries are playlists, not files - they name track ids and have no
  // `file` of their own. Filtering here rather than in `entries()` keeps the
  // fetch path's own view of the manifest exactly as it was.
  const list = entries(manifest).filter((e) => e.file)
  const pins = new Map()
  let missing = 0
  for (const e of list) {
    const dest = join(audioDir, e.file)
    if (!existsSync(dest)) {
      missing++
      console.log(`not on disk, cannot pin  ${e.kind}/${e.key}  ${e.file}`)
      continue
    }
    pins.set(e.file, { sha256: sha256(readFileSync(dest)), bytes: statSync(dest).size })
  }
  if (pins.size === 0) {
    console.error(`ABORT: pinned 0 of ${list.length} entries - run the fetch first`)
    process.exit(1)
  }

  const apply = (entry) => {
    const pin = pins.get(entry.file)
    if (!pin) return
    entry.sha256 = pin.sha256
    entry.bytes = pin.bytes
  }
  for (const e of Object.values(manifest.biome ?? {})) apply(e)
  for (const e of Object.values(manifest.zone ?? {})) apply(e)
  for (const e of manifest.radio ?? []) apply(e)

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  const total = [...pins.values()].reduce((sum, p) => sum + p.bytes, 0)
  console.log(
    `\npinned ${pins.size} of ${list.length} entries, ${missing} not on disk` +
      ` - ${(total / 1024 ** 3).toFixed(2)} GB`
  )
  if (missing) process.exit(1)
}

function renderAttributions(manifest) {
  const lines = [
    '# Audio attributions',
    '',
    '**Generated by `node tools/vendor-audio.mjs --attributions` from `manifest.json` -',
    'do not hand-edit, it will be overwritten.** Regenerate after adding tracks.',
    '',
    'None of this is DragonRealms audio. Simutronics owns their game\'s sound and',
    'we don\'t have a license to it - everything here is sourced separately and',
    'recorded below with where it came from and what it costs to use.',
    '',
    '## Biome ambience',
    '',
  ]
  for (const [key, e] of Object.entries(manifest.biome ?? {})) {
    const attr = e.attributionRequired
      ? `Attribution required: ${e.attributionText}`
      : 'No attribution required; credited anyway.'
    lines.push(`- **${e.title}** by ${e.author} — [${key}](${e.source}) — ${e.license}. ${attr}`)
  }

  lines.push('', '## Radio stations', '')
  const byStation = new Map()
  for (const t of manifest.radio ?? []) {
    if (!byStation.has(t.station)) byStation.set(t.station, [])
    byStation.get(t.station).push(t)
  }
  for (const [stationId, tracks] of byStation) {
    const meta = manifest.radioStations?.[stationId]
    lines.push(`### ${meta?.name ?? stationId} (${tracks.length} track${tracks.length === 1 ? '' : 's'})`, '')
    if (meta?.description) lines.push(`*${meta.description}*`, '')
    for (const t of tracks) {
      const who = t.composer ? `, ${t.composer}` : ''
      const perf = t.performer ? `, performed by ${t.performer}` : ''
      const attr = t.attributionRequired ? ' Attribution required.' : ''
      const note = t.note ? ` **Note:** ${t.note}` : ''
      lines.push(`- **${t.title}**${who}${perf} — [source](${t.source}) — ${t.license}.${attr}${note}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

async function main() {
  if (!existsSync(manifestPath)) {
    console.error(`no manifest at ${manifestPath}`)
    process.exit(1)
  }
  const manifest = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(manifestPath, 'utf8')))

  if (RECORD) {
    record(manifest)
    return
  }

  if (ATTRIBUTIONS_ONLY) {
    writeFileSync(attributionsPath, renderAttributions(manifest))
    const total = (manifest.radio ?? []).length + Object.keys(manifest.biome ?? {}).length
    console.log(`wrote ${attributionsPath} (${total} entries)`)
    return
  }

  const list = entries(manifest)

  if (!list.length) {
    console.log('manifest has 0 entries - nothing to fetch, nothing missing either')
    return
  }

  let missing = 0
  let fetched = 0
  let failed = 0
  for (const e of list) {
    const r = await fetchOne(e)
    console.log(`${r.status.padEnd(24)} ${r.kind}/${r.key}  ${r.file}`)
    if (r.status === 'missing') missing++
    else if (r.status.startsWith('fetched')) fetched++
    else if (
      r.status.startsWith('fetch-failed') ||
      r.status.startsWith('suspicious-response') ||
      r.status === 'no-download-url'
    )
      failed++
  }

  console.log(
    `\n${list.length} entries: ${fetched} fetched, ${missing} missing, ${failed} failed`
  )
  if (failed) process.exit(1)
}

main()
