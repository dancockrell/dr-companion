/**
 * The manifest-versus-installer agreement, asserted without a 217 MB build.
 *
 * `tools/build-update-manifest.mjs --check` is the real gate and it needs a
 * release build, which takes minutes and cannot run in the ordinary suite. So
 * the comparison itself is a pure function over two objects, and this drives it
 * with fabricated pairs — including the pairs that must be rejected.
 *
 * Every negative here is a real way to ship a broken update. The version pair
 * is the worst of them: a manifest announcing a version the installer is not
 * produces an app that downloads 217 MB, installs it, relaunches at the same
 * version, and offers the identical update again on every launch, with every
 * step reporting success. Nothing in a release run would say otherwise.
 *
 *     node tools/update-manifest-test.mjs
 */
import { buildManifest, checkManifest, downloadUrl, TARGET } from './build-update-manifest.mjs'

let pass = 0
let fail = 0
const failures = []
function ok(label, condition, detail) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`)
  if (detail && !condition) console.log(`     ${detail}`)
  if (condition) pass++
  else {
    fail++
    failures.push(label)
  }
}

const VERSION = '1.0.0-beta.1'
const release = {
  ok: true,
  file: `DR Companion_${VERSION}_x64-setup.exe`,
  size: 217_267_200,
  sha256: 'a'.repeat(64),
  signature: 'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZQ==',
}

const good = buildManifest({ version: VERSION, release, notes: 'notes', pubDate: '2026-09-09T12:00:00Z' })

/** How many of `checkManifest`'s propositions failed. */
function reds(manifest, rel = release, version = VERSION) {
  return checkManifest(manifest, rel, version)
    .filter(([, c]) => !c)
    .map(([label]) => label)
}

// ── The positive control ────────────────────────────────────────────────────
{
  const results = checkManifest(good, release, VERSION)
  ok(`the control: a generated manifest passes all ${results.length} of its own checks`, results.every(([, c]) => c), reds(good).join(' | '))
  ok('the control: there are enough checks to be worth running', results.length >= 6, `${results.length}`)
}

// ── Shape ───────────────────────────────────────────────────────────────────
{
  ok(`the platform key is ${TARGET}`, Object.keys(good.platforms).length === 1 && TARGET in good.platforms)
  ok('the URL points at the tag for this version and the installer that was built', good.platforms[TARGET].url === `https://github.com/dancockrell/dr-companion/releases/download/v${VERSION}/${encodeURIComponent(release.file)}`)
  ok('a filename with spaces is percent-encoded in the URL', good.platforms[TARGET].url.includes('DR%20Companion'))
  ok('the digest of the installer is carried', good.sha256 === release.sha256)
  ok('the release notes are carried', good.notes === 'notes')
}

// ── The pairs that must be rejected ─────────────────────────────────────────
{
  const wrongVersion = { ...good, version: '0.9.9' }
  const r = reds(wrongVersion)
  ok(
    'a manifest announcing a version the installer is not is rejected',
    r.length === 1 && r[0].includes("version matches package.json"),
    r.join(' | ')
  )
}
{
  // The installer built at one version, the tree bumped afterwards. Both files
  // exist, both look right, and the URL would 404.
  const stale = { ...release, file: 'DR Companion_0.1.1_x64-setup.exe' }
  const r = reds(buildManifest({ version: VERSION, release: stale, notes: '', pubDate: '' }), stale)
  ok(
    "an installer whose filename does not carry the declared version is rejected",
    r.some((l) => l.includes("filename carries that version")),
    r.join(' | ')
  )
}
{
  const wrongSig = {
    ...good,
    platforms: { [TARGET]: { ...good.platforms[TARGET], signature: 'c29tZXRoaW5nIGVsc2U=' } },
  }
  const r = reds(wrongSig)
  ok(
    "a manifest carrying last release's signature is rejected",
    r.length === 1 && r[0].includes('signature is the one the bundler wrote'),
    r.join(' | ')
  )
}
{
  const unsigned = { ...release, signature: null }
  const manifest = buildManifest({ version: VERSION, release: unsigned, notes: '', pubDate: '' })
  const r = reds(manifest, unsigned)
  ok(
    'a build with no signature beside the installer is rejected, not published unsigned',
    r.some((l) => l.includes('carries a signature')),
    r.join(' | ')
  )
}
{
  const wrongUrl = {
    ...good,
    platforms: { [TARGET]: { ...good.platforms[TARGET], url: downloadUrl(VERSION, 'something-else-setup.exe') } },
  }
  const r = reds(wrongUrl)
  ok('a manifest pointing at a different file is rejected', r.length === 1 && r[0].includes('names the installer that was built'), r.join(' | '))
}
{
  const wrongHash = { ...good, sha256: 'b'.repeat(64) }
  const r = reds(wrongHash)
  ok('a digest that does not match the installer on disk is rejected', r.length === 1 && r[0].includes('sha256 matches'), r.join(' | '))
}
{
  const noPlatform = { ...good, platforms: { 'darwin-aarch64': good.platforms[TARGET] } }
  const r = reds(noPlatform)
  ok(
    'a manifest with no entry for this platform is rejected rather than silently offering nothing',
    r.some((l) => l.includes('platform entry')),
    r.join(' | ')
  )
}

console.log('')
const total = pass + fail
const MIN_EXPECTED = 10
if (total < MIN_EXPECTED) {
  console.error(`FAILED: only ${total} checks ran, expected at least ${MIN_EXPECTED}`)
  process.exit(1)
}
console.log(`${total} checked, ${fail} failed`)
if (fail > 0) {
  console.error(`FAILED: ${failures.join(' | ')}`)
  process.exit(1)
}
console.log('all passed')
