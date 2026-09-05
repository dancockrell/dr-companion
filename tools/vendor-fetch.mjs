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
 *   node tools/vendor-fetch.mjs --stub       write placeholders so a dev build compiles
 *   node tools/vendor-fetch.mjs --require-real  refuse to continue if what is vendored is a stub
 *
 * Run before `npm run tauri:build` - wired into that script already, so a
 * normal release build does this automatically. Safe to run repeatedly: if
 * the vendored copy already matches the latest release, it does nothing.
 *
 * # Why --stub exists
 *
 * `tauri.conf.json` lists these two files under `bundle.resources`, and Tauri
 * validates that list on every build - including a debug one. So on a fresh
 * clone `cargo build` and `cargo test` both fail with:
 *
 *     resource path `vendor\Ruby4Lich5.exe` doesn't exist
 *
 * which gates 59 Rust unit tests behind a 65 MB download that none of them
 * use. Measured: two placeholder files of four and fourteen bytes are enough
 * for `cargo test` to run all 59 green. The tests never needed the installer;
 * only the bundle declaration did.
 *
 * # Why --require-real exists, and why --stub is unsafe without it
 *
 * A stub that reached a release would ship an installer whose bundled Ruby is
 * four bytes of the word "stub", and the failure would surface on a user's
 * machine as a first run that cannot find Ruby - far from here, and very hard
 * to trace back. `npm run tauri:build` therefore fetches and *then* runs
 * `--require-real`, which exits non-zero on a stub or on bytes that do not
 * match the manifest's own recorded hash.
 *
 * The guard is the thing that makes the convenience safe, so it is wired into
 * the release script rather than left as a habit, and `tools/vendor-stub-test.mjs`
 * proves it actually refuses a stub rather than merely being present.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const VENDOR_DIR = join(__dirname, '..', 'src-tauri', 'vendor')
const EXE_PATH = join(VENDOR_DIR, 'Ruby4Lich5.exe')
const MANIFEST_PATH = join(VENDOR_DIR, 'Ruby4Lich5.manifest.json')
const REPO = 'elanthia-online/lich-5'
const ASSET_NAME = 'Ruby4Lich5.exe'

/**
 * Headers for the GitHub API, with a token when one is on offer.
 *
 * Unauthenticated requests are limited to 60 an hour **per source address**,
 * and every GitHub Actions runner shares a small pool of addresses with every
 * other customer's jobs, so a CI run can arrive at a bucket somebody else
 * already emptied. That is not a hypothesis: the `Vendor Ruby4Lich5` step
 * failed with `GitHub API: HTTP 403` three times on 5 Sep 2026 across three
 * different lanes, each time on an unrelated pull request, and each time an
 * unchanged rerun passed. A flake that is fixed by pressing the button again
 * teaches people to press the button again.
 *
 * `GITHUB_TOKEN` is present in every workflow run and raises the limit to
 * 1,000 an hour for the repository. It is only ever read from the environment
 * and never logged; the caller decides whether to supply one, and locally
 * there usually is none, which is fine - 60 an hour is plenty for one person.
 */
export function githubHeaders(env = process.env) {
  const headers = { 'User-Agent': 'dr-companion-vendor-fetch' }
  const token = env.GITHUB_TOKEN || env.GH_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

/**
 * What a failing GitHub API response actually means.
 *
 * Exported and pure so the unhappy path can be *run* rather than reasoned
 * about. A first attempt to prove it by stubbing `fetch` and importing this
 * file died earlier in the CLI's own startup and never reached the branch,
 * which is a check that proves nothing (plan trap 15). A function with
 * arguments has no startup to die in.
 */
export function describeGithubFailure(status, remaining, reset, hasToken) {
  if (status === 403 && remaining === '0') {
    const when = reset ? new Date(Number(reset) * 1000).toISOString() : 'an unknown time'
    return (
      `GitHub API: rate limited (0 requests left, resets at ${when}). ` +
      (hasToken
        ? 'A token was sent, so this is the authenticated 1,000/hour limit.'
        : 'No GITHUB_TOKEN was set, so this was the unauthenticated 60/hour limit, shared with every other job on this runner address.')
    )
  }
  return `GitHub API: HTTP ${status}`
}

async function latestAsset() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: githubHeaders(),
  })
  if (!res.ok) {
    // 403 here is nearly always the rate limit rather than a permissions
    // problem, and the difference decides whether retrying can possibly help.
    throw new Error(
      describeGithubFailure(
        res.status,
        res.headers.get('x-ratelimit-remaining'),
        res.headers.get('x-ratelimit-reset'),
        Boolean(process.env.GITHUB_TOKEN || process.env.GH_TOKEN)
      )
    )
  }
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

/** The marker that makes a placeholder recognisable rather than merely small. */
const STUB_MARK = 'dr-companion-vendor-stub'

/**
 * Placeholders, so a fresh clone compiles and tests without the network.
 *
 * The exe carries the marker in its own bytes as well as the manifest saying
 * so, because a manifest can be deleted and the file left behind - and then
 * the only thing standing between a four-byte Ruby and a release is whether
 * the guard can recognise the file itself.
 */
function writeStub() {
  mkdirSync(VENDOR_DIR, { recursive: true })
  writeFileSync(EXE_PATH, `${STUB_MARK}\nNOT Ruby4Lich5. Run: npm run vendor:fetch\n`)
  writeFileSync(
    MANIFEST_PATH,
    JSON.stringify({ stub: true, marker: STUB_MARK, version: 'stub', sha256: null, bytes: null }, null, 2) + '\n'
  )
  console.log(`wrote placeholders to ${VENDOR_DIR}`)
  console.log('cargo build and cargo test will now run. A release build will refuse these.')
}

/**
 * Refuse to continue unless what is vendored is the real, verified article.
 *
 * Three distinct failures, all reported as themselves rather than collapsed
 * into "not ok": nothing vendored, a stub, and bytes that disagree with the
 * hash the manifest recorded when it was written.
 */
function requireReal() {
  if (!existsSync(EXE_PATH)) {
    console.error(`nothing vendored at ${EXE_PATH}. Run: npm run vendor:fetch`)
    process.exit(1)
  }
  const bytes = readFileSync(EXE_PATH)
  const manifest = readExistingManifest()

  if (manifest?.stub || bytes.subarray(0, 200).includes(Buffer.from(STUB_MARK))) {
    console.error(
      `${EXE_PATH} is a placeholder written by --stub, not Ruby4Lich5. ` +
        'Refusing to bundle it. Run: npm run vendor:fetch'
    )
    process.exit(1)
  }
  if (!manifest?.sha256) {
    console.error(`${EXE_PATH} exists but no manifest records its hash, so it cannot be verified. Run: npm run vendor:fetch`)
    process.exit(1)
  }
  const got = createHash('sha256').update(bytes).digest('hex')
  if (got !== manifest.sha256) {
    console.error(`${EXE_PATH} hashes to ${got}, but the manifest records ${manifest.sha256}. Refusing to bundle it.`)
    process.exit(1)
  }
  console.log(`vendored Ruby4Lich5 ${manifest.version} verified against its manifest hash - safe to bundle`)
}

async function main() {
  const checkOnly = process.argv.includes('--check')

  if (process.argv.includes('--stub')) return writeStub()
  if (process.argv.includes('--require-real')) return requireReal()

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

// Only run when invoked as a command, not when imported.
//
// Without this guard, `import('./vendor-fetch.mjs')` to reach one exported
// function also starts a download. That is how the first attempt to test the
// rate-limit branch failed: the import ran `main()`, which died on an absent
// manifest, and the error looked like the code under test rather than like the
// harness starting a CLI by accident. `process.argv[1]` is the script node was
// asked to run; comparing it to this module's own URL is the standard way to
// tell the two apart, and it costs nothing.
const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (invokedDirectly) {
  main().catch((e) => {
    console.error(String(e.message ?? e))
    process.exit(1)
  })
}
