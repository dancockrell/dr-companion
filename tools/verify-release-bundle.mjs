/**
 * After a release build: did the installer actually get the world viewer, and
 * did it keep everything it already shipped?
 *
 * This checks the built output rather than the config that asked for it. A
 * config is a request; the staged resource tree is what the installer will
 * carry, and those come apart in exactly the ways that matter here - a
 * mistyped destination, an export that silently produced nothing, or a
 * `--config` that replaced the resource map instead of extending it.
 *
 * The last one is why `companion_bridge.lic` is checked too, and it is not
 * padding. It is the positive control: if the release config had dropped the
 * base resources, the viewer would still be present and this check would pass
 * while the installer shipped without Ruby, the bridge script and the Python
 * API. Checking only the new thing would confirm the wrong half.
 *
 *     node tools/verify-release-bundle.mjs
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readFlags } from './cli-flags.mjs'

const root = resolve(import.meta.dirname, '..')
const buildDir = resolve(root, 'src-tauri', 'target', 'release')

/**
 * Whether this build was supposed to carry a viewer.
 *
 * A build can legitimately carry no viewer: exporting one needs a Godot binary,
 * and the plan ships beta.1 with the viewer disabled anyway. (Until Lane V's V3
 * it could also be missing because the viewer's assets lived in a *private*
 * submodule no workflow token could reach; 3D is cancelled, docs/NO-3D.md, and
 * that submodule is gone.) An ordinary build without a viewer must not be
 * confused with a build that tried and failed.
 *
 * So the caller declares which one it is. `--expect-viewer` requires it and
 * fails loudly when it is missing; the default requires everything else and
 * reports the viewer's absence as a stated fact rather than passing over it in
 * silence. Three states, not two: shipped, deliberately absent, missing when
 * it was wanted.
 *
 * Read through `readFlags` rather than `process.argv.includes`, so a
 * misspelling in the workflow expression that passes this flag is a refusal
 * rather than a silent "no viewer expected" - the one reading under which this
 * check passes a release that is missing the thing it exists to require.
 */
/**
 * `--expect-update-manifest` is the same three-state discipline pointed at the
 * updater, added 9 September 2026 with the updater itself.
 *
 * A release that carries an installer and no `latest.json` updates nobody: the
 * endpoint 404s, every running copy reports "could not check for updates", and
 * the release page looks completely normal. A release whose manifest describes
 * a *different* build is worse — it offers an update, downloads 217 MB, and
 * fails verification or reinstalls the same version forever.
 *
 * Neither is visible in the bundle directory, so it has to be asked for. The
 * default states the absence rather than passing over it, exactly as the viewer
 * does below, because a build with no manifest is a legitimate thing to make (a
 * dry run, a build for the VM) and must not be confused with a release that
 * tried to carry one and failed.
 */
const flags = readFlags({
  name: 'verify-release-bundle',
  boolean: ['--expect-viewer', '--expect-update-manifest'],
})
const expectViewer = flags['--expect-viewer']
const expectManifest = flags['--expect-update-manifest']

/** Basenames that must be somewhere under the release output. */
const REQUIRED = [
  ...(expectViewer
    ? [
        {
          file: 'DRCompanionWorldViewer.exe',
          why: 'the world viewer - the point of this release wiring',
        },
      ]
    : []),
  {
    file: 'companion_bridge.lic',
    why: 'a resource the ordinary build already shipped; present only if the release config extended the base rather than replacing it',
  },
]

if (!existsSync(buildDir)) {
  console.error(`No release build found at ${buildDir}. Run the Tauri build first.`)
  process.exit(1)
}

/** Depth-limited walk: the release tree contains the whole Rust build and
 * walking it unbounded is slow enough to look hung in CI. */
function find(dir, name, depth = 0) {
  if (depth > 6) return null
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isFile() && e.name === name) return full
    // `deps` and `build` hold thousands of intermediate artifacts and never
    // resources; skipping them turns minutes into seconds.
    if (e.isDirectory() && e.name !== 'deps' && e.name !== 'build' && e.name !== 'incremental') {
      const hit = find(full, name, depth + 1)
      if (hit) return hit
    }
  }
  return null
}

let failed = 0
for (const { file, why } of REQUIRED) {
  const hit = find(buildDir, file)
  if (hit) {
    const size = statSync(hit).size
    console.log(`OK   ${file.padEnd(32)} ${size} bytes`)
    if (size === 0) {
      console.error(`FAIL ${file} is present but empty - a zero-byte resource ships as a broken file`)
      failed++
    }
  } else {
    console.error(`FAIL ${file.padEnd(32)} not found under the release output`)
    console.error(`     needed because: ${why}`)
    failed++
  }
}

if (failed > 0) {
  console.error(`\n${failed} of ${REQUIRED.length} required resources missing from the release build.`)
  process.exit(1)
}
console.log(`\nAll ${REQUIRED.length} required resources are staged in the release build.`)

// ── The update manifest ─────────────────────────────────────────────────────
//
// `checkManifest` is imported rather than restated. The same comparison runs
// when the manifest is written (`build-update-manifest.mjs` reads its own
// output back) and again here at the end of a release run, and two copies of
// it would drift - which for this particular comparison means one of them
// quietly stopping short of the check that catches a version mismatch.
{
  const { MANIFEST_PATH, checkManifest, declaredVersion, inspectRelease } = await import(
    './build-update-manifest.mjs'
  )
  const version = declaredVersion()
  const release = inspectRelease()

  if (!expectManifest) {
    console.log(
      existsSync(MANIFEST_PATH)
        ? `Note: an update manifest is present at ${MANIFEST_PATH} even though this run did not require one.`
        : 'This build carries NO update manifest. Published as-is, it updates nobody: running copies would ask the endpoint and get a 404.'
    )
  } else if (!release.ok) {
    console.error(`FAIL the update manifest was required but the build cannot be described: ${release.why}`)
    process.exit(1)
  } else if (!existsSync(MANIFEST_PATH)) {
    console.error(`FAIL no update manifest at ${MANIFEST_PATH}`)
    console.error('     needed because: --expect-update-manifest was passed. Run `npm run release:manifest`.')
    process.exit(1)
  } else {
    let manifest
    try {
      manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
    } catch (e) {
      console.error(`FAIL the update manifest at ${MANIFEST_PATH} is not valid JSON: ${e.message}`)
      process.exit(1)
    }
    const results = checkManifest(manifest, release, version)
    let manifestFailed = 0
    for (const [label, condition] of results) {
      console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`)
      if (!condition) manifestFailed++
    }
    console.log(`\n${results.length} manifest checks ran, ${manifestFailed} failed.`)
    if (manifestFailed > 0) {
      console.error(
        'The manifest does not describe this installer. Publishing both would ship an update ' +
          'that cannot install, or one that reinstalls the same version forever.'
      )
      process.exit(1)
    }
  }
}

// Said out loud either way. An installer without a viewer is a supported
// build, and the one thing it must never do is look like an installer with
// one.
if (!expectViewer) {
  const viewer = find(buildDir, 'DRCompanionWorldViewer.exe')
  console.log(
    viewer
      ? 'Note: a viewer is staged even though this run did not require one.'
      : 'This installer carries NO world viewer. The app runs without it and reports it as not installed.'
  )
}
