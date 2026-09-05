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
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const buildDir = resolve(root, 'src-tauri', 'target', 'release')

/**
 * Whether this build was supposed to carry a viewer.
 *
 * The shared-assets submodule is a *private* repository, and a workflow's
 * built-in token reaches only its own repo, so a release built without a
 * credential for it cannot export a viewer at all. That is a real, ordinary
 * build - the plan ships beta.1 with the viewer disabled anyway - and it must
 * not be confused with a build that tried and failed.
 *
 * So the caller declares which one it is. `--expect-viewer` requires it and
 * fails loudly when it is missing; the default requires everything else and
 * reports the viewer's absence as a stated fact rather than passing over it in
 * silence. Three states, not two: shipped, deliberately absent, missing when
 * it was wanted.
 */
const expectViewer = process.argv.includes('--expect-viewer')

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
