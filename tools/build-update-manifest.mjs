/**
 * The update manifest: `latest.json`, built from the installer that was
 * actually produced, never typed by hand.
 *
 *     node tools/build-update-manifest.mjs                 write it
 *     node tools/build-update-manifest.mjs --check         verify it matches the build
 *     node tools/build-update-manifest.mjs --notes-file X  use X as the release notes
 *
 * # What the file is
 *
 * `tauri-plugin-updater` fetches one JSON document from each configured
 * endpoint and reads it in one of two shapes. This writes the **static** shape,
 * which is the one a GitHub release can serve as a plain asset:
 *
 *     { "version": "0.2.0",
 *       "notes": "...",
 *       "pub_date": "2026-09-09T12:00:00Z",
 *       "platforms": {
 *         "windows-x86_64": { "signature": "<minisign>", "url": "https://..." } } }
 *
 * The target key is `{os}-{arch}`. Read out of `get_urls` in
 * `tauri-plugin-updater-2.11.0/src/updater.rs` rather than recalled: the plugin
 * tries `windows-x86_64-nsis` first and falls back to `windows-x86_64`, so the
 * plain key covers an NSIS build and would also cover an MSI one if this
 * project ever bundled both.
 *
 * # Why it is generated and checked rather than written
 *
 * Because the two halves of a release can disagree silently and the failure
 * lands on the player, not on us. A manifest announcing 0.2.0 beside an
 * installer that is 0.1.1 produces an app that offers an update, installs it,
 * relaunches at the version it started on, and offers the same update again —
 * forever, with every step reporting success. A manifest whose `signature` is
 * last release's produces a 217 MB download that fails verification at the end
 * of the progress bar, which reads to a player as a corrupt download.
 *
 * So: the version comes from `package.json` (the one source
 * `tools/set-version.mjs` keeps five files agreeing on), the signature comes
 * from the `.sig` file the bundler wrote next to the installer, and the URL's
 * filename is the installer's own. Nothing here is retyped, and `--check`
 * re-derives all of it and compares.
 *
 * # The digest
 *
 * `sha256` is not a field the plugin reads — verification is the minisign
 * signature, which is strictly stronger. It is written because
 * `docs/RELEASE.md` asks for the installer's digest to be recorded by hand at
 * every release so the chain of custody has two ends, and a number a person
 * copies out of a terminal into a document is a number that can be copied
 * wrongly. Having it in a generated file means the check can compare it to the
 * file on disk instead of trusting the transcription. The plugin ignores
 * unknown fields (its `RemoteRelease` deserializer names the fields it wants
 * and does not deny others), so carrying it costs nothing.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readFlags } from './cli-flags.mjs'

export const ROOT = resolve(import.meta.dirname, '..')
export const NSIS_DIR = join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'nsis')
export const MANIFEST_PATH = join(NSIS_DIR, 'latest.json')
export const TARGET = 'windows-x86_64'
const REPO = 'dancockrell/dr-companion'

/** The version every other file in the tree agrees on. */
export function declaredVersion() {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
}

export function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * What the release build produced, or a named reason there is nothing to
 * describe.
 *
 * Returns `{ ok: false, why }` rather than throwing, because two callers want
 * different things from a missing build: this script refuses, and
 * `verify-release-bundle.mjs` reports it as one FAIL among several rather than
 * a stack trace that hides the other findings.
 *
 * "Exactly one installer" is a real condition, not defensiveness. The bundle
 * directory is not cleaned between builds, so a tree that has built 0.1.1 and
 * then 0.2.0 holds two `-setup.exe` files, and picking either one by
 * modification time is how a release ships the wrong binary under the right
 * name.
 */
export function inspectRelease() {
  if (!existsSync(NSIS_DIR)) {
    return { ok: false, why: `no NSIS bundle directory at ${NSIS_DIR}. Run \`npm run tauri:build\` first.` }
  }
  const installers = readdirSync(NSIS_DIR).filter((f) => f.endsWith('-setup.exe'))
  if (installers.length !== 1) {
    return {
      ok: false,
      why:
        `expected exactly one *-setup.exe in ${NSIS_DIR}, found ${installers.length}` +
        (installers.length ? `: ${installers.join(', ')}. Delete the stale ones; the bundle directory is not cleaned between builds.` : '.'),
    }
  }
  const file = installers[0]
  const path = join(NSIS_DIR, file)
  const sigPath = `${path}.sig`
  return {
    ok: true,
    file,
    path,
    size: statSync(path).size,
    sha256: sha256(path),
    sigPath,
    // A build run without `TAURI_SIGNING_PRIVATE_KEY` produces an installer
    // and no `.sig`, and it is otherwise indistinguishable from a signed one.
    // That is the single most likely way to publish an unusable release.
    signature: existsSync(sigPath) ? readFileSync(sigPath, 'utf8').trim() : null,
  }
}

export function downloadUrl(version, file) {
  // `encodeURIComponent` on the filename alone: it contains spaces
  // (`DR Companion_0.2.0_x64-setup.exe`), and GitHub serves the asset under
  // the percent-encoded name. Encoding the whole URL would eat the slashes.
  return `https://github.com/${REPO}/releases/download/v${version}/${encodeURIComponent(file)}`
}

export function buildManifest({ version, release, notes, pubDate }) {
  return {
    version,
    notes,
    pub_date: pubDate,
    sha256: release.sha256,
    platforms: {
      [TARGET]: {
        signature: release.signature,
        url: downloadUrl(version, release.file),
      },
    },
  }
}

/**
 * Compare a manifest against the build it claims to describe.
 *
 * Every proposition is one a wrong answer to would ship a broken update, and
 * each is named so a failure says which half is wrong rather than "they do not
 * match".
 */
export function checkManifest(manifest, release, version) {
  const platform = manifest?.platforms?.[TARGET]
  return [
    ['the manifest declares a version', typeof manifest?.version === 'string' && manifest.version.length > 0],
    [`the manifest's version matches package.json (${version})`, manifest?.version === version],
    [
      `the installer's filename carries that version (${release.file})`,
      release.file.includes(version),
    ],
    [`the manifest has a ${TARGET} platform entry`, Boolean(platform)],
    ['the manifest carries a signature', typeof platform?.signature === 'string' && platform.signature.length > 0],
    [
      'the manifest signature is the one the bundler wrote beside the installer',
      release.signature !== null && platform?.signature === release.signature,
    ],
    [
      "the manifest's download URL names the installer that was built",
      platform?.url === downloadUrl(version, release.file),
    ],
    [
      `the manifest's sha256 matches the installer on disk (${release.sha256.slice(0, 16)}…)`,
      manifest?.sha256 === release.sha256,
    ],
  ]
}

// ── CLI ─────────────────────────────────────────────────────────────────────

if (import.meta.filename === process.argv[1]) {
  const flags = readFlags({
    name: 'build-update-manifest',
    boolean: ['--check'],
    value: ['--notes-file'],
  })

  const version = declaredVersion()
  const release = inspectRelease()
  if (!release.ok) {
    console.error(`build-update-manifest: ${release.why}`)
    process.exit(1)
  }

  if (flags['--check']) {
    if (!existsSync(MANIFEST_PATH)) {
      console.error(`build-update-manifest --check: no manifest at ${MANIFEST_PATH}. Run this script without --check first.`)
      process.exit(1)
    }
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
    const results = checkManifest(manifest, release, version)
    let failed = 0
    for (const [label, condition] of results) {
      console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`)
      if (!condition) failed++
    }
    console.log('')
    console.log(`${results.length} checked, ${failed} failed`)
    if (failed) {
      console.error('FAILED: this manifest does not describe this installer. Publishing both would ship an update that cannot install.')
      process.exit(1)
    }
    console.log('all passed')
    process.exit(0)
  }

  if (release.signature === null) {
    console.error(
      `build-update-manifest: there is no signature at ${release.sigPath}.\n` +
        '  The installer was built without TAURI_SIGNING_PRIVATE_KEY, so the updater cannot verify it.\n' +
        '  An unsigned installer and a signed one look identical; only this missing file distinguishes them.\n' +
        '  See docs/RELEASE.md §2.4 for where the key lives and how to set it for a build.'
    )
    process.exit(1)
  }

  const notesFile = flags['--notes-file']
  if (notesFile && !existsSync(notesFile)) {
    console.error(`build-update-manifest: --notes-file ${notesFile} does not exist.`)
    process.exit(1)
  }
  const notes = notesFile
    ? readFileSync(notesFile, 'utf8').trim()
    : `DR Companion ${version}. See the release page for what changed.`

  const manifest = buildManifest({
    version,
    release,
    notes,
    pubDate: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  })
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`)

  // Read it back and run the check against it. A write that produced something
  // the checker rejects must not report success — the same discipline
  // `set-version.mjs` applies after its own string surgery.
  const written = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  const results = checkManifest(written, release, version)
  const bad = results.filter(([, c]) => !c)
  for (const [label, condition] of results) console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`)
  if (bad.length) {
    console.error(`\nFAILED: wrote ${MANIFEST_PATH} but it does not describe the build.`)
    process.exit(1)
  }
  console.log('')
  console.log(`Wrote ${MANIFEST_PATH}`)
  console.log(`  version   ${version}`)
  console.log(`  installer ${release.file} (${release.size} bytes)`)
  console.log(`  sha256    ${release.sha256}`)
  console.log('')
  console.log('Attach BOTH this latest.json and the installer to the release. The updater')
  console.log('fetches latest.json from the release tagged `latest`, so a release with the')
  console.log('installer and no manifest updates nobody, and a manifest whose asset is')
  console.log('missing fails at the download.')
}
