/**
 * Fetch and verify Ruby4Lich5.exe into src-tauri/vendor/, so a release build
 * can bundle it - a first run then needs no network for Ruby or Lich at all.
 *
 * # Why this exists rather than committing the file
 *
 * It is 65 MB, rebuilt by the Lich project on their own schedule, and it does
 * not belong in this repo's git history forever - the same reasoning
 * `public/rooms/` already states in .gitignore for room art. This script
 * populates a gitignored `src-tauri/vendor/` before a release build;
 * `src-tauri/tauri.conf.json` bundles whatever is there.
 *
 * # What "verify" means here
 *
 * The same rule setup.rs's own downloads follow: GitHub publishes a SHA-256
 * digest per release asset, and the file is checked against it before being
 * written to its final name. A checksum mismatch deletes the partial file and
 * exits non-zero - nothing is ever bundled unverified, which matters more
 * here than for an interactive download because nobody is watching this run.
 *
 * # Use
 *
 *   node tools/vendor-fetch.mjs              fetch the latest release
 *   node tools/vendor-fetch.mjs --check      report what is already vendored, fetch nothing
 *
 * Run before `npm run tauri:build` - wired into that script already, so a
 * normal release build does this automatically. Safe to run repeatedly: if
 * the vendored copy already matches the latest release, it does nothing.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const VENDOR_DIR = join(__dirname, '..', 'src-tauri', 'vendor')
const EXE_PATH = join(VENDOR_DIR, 'Ruby4Lich5.exe')
const MANIFEST_PATH = join(VENDOR_DIR, 'Ruby4Lich5.manifest.json')
const REPO = 'elanthia-online/lich-5'
const ASSET_NAME = 'Ruby4Lich5.exe'

async function latestAsset() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { 'User-Agent': 'dr-companion-vendor-fetch' },
  })
  if (!res.ok) throw new Error(`GitHub API: HTTP ${res.status}`)
  const rel = await res.json()
  const asset = rel.assets.find((a) => a.name === ASSET_NAME)
  if (!asset) throw new Error(`release ${rel.tag_name} has no asset named ${ASSET_NAME}`)
  const digest = asset.digest?.startsWith('sha256:') ? asset.digest.slice(7) : null
  if (!digest) throw new Error(`GitHub published no sha256 digest for ${ASSET_NAME} - refusing to fetch unverifiable`)
  return {
    version: rel.tag_name,
    url: asset.browser_download_url,
    bytes: asset.size,
    sha256: digest,
  }
}

function readExistingManifest() {
  // Both files or neither - a manifest with no .exe next to it (a partial
  // vendor directory, or one where only the exe was cleaned up) is not a
  // usable vendored copy, and treating it as one would tell a caller "you
  // have Ruby4Lich5.exe" right before a release build fails to find it.
  if (!existsSync(MANIFEST_PATH) || !existsSync(EXE_PATH)) return null
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  } catch {
    // A manifest that will not parse is the same as none - never trust it.
    return null
  }
}

async function main() {
  const checkOnly = process.argv.includes('--check')

  const existing = readExistingManifest()
  if (existing) {
    console.log(`vendored: ${existing.version}, ${existing.bytes} bytes, sha256 ${existing.sha256.slice(0, 16)}…`)
  } else {
    console.log('vendored: nothing yet')
  }

  if (checkOnly) return

  console.log('checking the latest release…')
  let latest
  try {
    latest = await latestAsset()
  } catch (e) {
    // A vendored copy that already passed this same sha256 check on some
    // earlier run is not made unverified by a network hiccup or a rate
    // limit today - "verify before use" (this file's own docstring) was
    // already satisfied then, and a release build's whole point is that it
    // "needs no network for Ruby or Lich at all" once vendored once. Only
    // fatal when there is nothing to fall back to: no vendored copy means
    // nothing to bundle, and that has to stop the build, network-caused or
    // not.
    if (existing) {
      console.warn(`could not check the latest release (${e.message ?? e}) - keeping the vendored copy as is`)
      return
    }
    throw e
  }

  if (existing && existing.version === latest.version && existing.sha256 === latest.sha256) {
    console.log(`already up to date (${latest.version}) - nothing to fetch`)
    return
  }

  console.log(`fetching ${latest.version} (${(latest.bytes / 1024 / 1024).toFixed(1)} MB) from ${latest.url}`)
  const res = await fetch(latest.url)
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
  const bytes = Buffer.from(await res.arrayBuffer())

  const got = createHash('sha256').update(bytes).digest('hex')
  if (got !== latest.sha256) {
    throw new Error(
      `checksum mismatch: GitHub published ${latest.sha256}, downloaded file hashes to ${got}. ` +
        'Nothing was written.'
    )
  }
  if (bytes.length !== latest.bytes) {
    // Belt and suspenders alongside the hash check above - a mismatch here
    // with a matching hash is not supposed to be possible, and if it ever
    // is, that is exactly the kind of "the check passed and something is
    // still wrong" case worth refusing rather than shipping.
    throw new Error(`size mismatch: GitHub said ${latest.bytes} bytes, got ${bytes.length}`)
  }

  mkdirSync(VENDOR_DIR, { recursive: true })

  // Verified bytes to a temp name first, then rename - so a crash mid-write
  // never leaves a corrupt file at the name tauri.conf.json's resources entry
  // actually bundles from.
  const tmp = EXE_PATH + '.part'
  writeFileSync(tmp, bytes)
  rmSync(EXE_PATH, { force: true })
  const { renameSync } = await import('node:fs')
  renameSync(tmp, EXE_PATH)

  writeFileSync(
    MANIFEST_PATH,
    JSON.stringify({ version: latest.version, sha256: latest.sha256, bytes: latest.bytes }, null, 2) + '\n'
  )

  console.log(`vendored ${latest.version}: ${EXE_PATH}`)
}

main().catch((e) => {
  console.error(String(e.message ?? e))
  process.exit(1)
})
