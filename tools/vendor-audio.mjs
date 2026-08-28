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
 *   node tools/vendor-audio.mjs        fetch anything missing
 *   node tools/vendor-audio.mjs --check   report what's missing, fetch nothing
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const manifestPath = join(root, 'data/audio/manifest.json')
const audioDir = join(root, 'public/audio')

const CHECK_ONLY = process.argv.includes('--check')

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

  writeFileSync(dest, buf)
  return { ...e, status: `fetched (${buf.length} bytes)` }
}

async function main() {
  if (!existsSync(manifestPath)) {
    console.error(`no manifest at ${manifestPath}`)
    process.exit(1)
  }
  const manifest = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(manifestPath, 'utf8')))
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
