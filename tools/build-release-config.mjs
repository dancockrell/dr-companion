/**
 * Derive the release-only Tauri config: everything `tauri.conf.json` already
 * ships, plus the exported world viewer.
 *
 * The viewer cannot go in the base config. It does not exist unless somebody
 * has run `npm run godot:export`, and a bundled resource that is missing
 * fails the whole `tauri build` - so putting it there would break every
 * developer build and the `tauri` CI job, for everyone, permanently.
 *
 * # Why this is generated rather than a second config file checked in
 *
 * A hand-written release config would restate the resource map, and the day
 * somebody adds a resource to `tauri.conf.json` the installer would quietly
 * ship without it. The two would drift and only the release would be wrong,
 * which is the worst place to find out. So the base config is the single
 * source and this adds exactly one entry to it.
 *
 * That also removes a question nobody should have to answer: whether Tauri's
 * `--config` merges nested objects or replaces them. This emits the complete
 * resource map either way, so both behaviours produce the same correct
 * installer.
 *
 *     node tools/build-release-config.mjs            # writes the config
 *     node tools/build-release-config.mjs --check    # verify only, no write
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const BASE = resolve(root, 'src-tauri', 'tauri.conf.json')
const OUT = resolve(root, 'src-tauri', 'tauri.release.conf.json')
const VIEWER_SRC = '../godot/build/DRCompanionWorldViewer.exe'
/** Must match one of `viewer_candidates` in src-tauri/src/viewer.rs. The app
 * looks in `<resources>/viewer/` first; a different destination here would
 * bundle a viewer the app then reports as not installed. */
const VIEWER_DEST = 'viewer/DRCompanionWorldViewer.exe'

const check = process.argv.includes('--check')
const base = JSON.parse(readFileSync(BASE, 'utf8'))
const resources = base?.bundle?.resources

if (!resources || typeof resources !== 'object' || Array.isArray(resources)) {
  throw new Error(
    `${BASE} has no bundle.resources object. The release config is derived from it, ` +
      `so a reshaped base config must stop the release rather than silently ship ` +
      `an installer with nothing in it.`
  )
}

// A floor on the thing that disappears if the base config is reshaped or
// truncated: the release must never ship fewer resources than the ordinary
// build already does.
const MIN_BASE_RESOURCES = 4
const baseCount = Object.keys(resources).length
if (baseCount < MIN_BASE_RESOURCES) {
  throw new Error(
    `Only ${baseCount} resources found in the base config, expected at least ` +
      `${MIN_BASE_RESOURCES}. Refusing to build a release config that drops what the ` +
      `normal build ships.`
  )
}

// The destination folder is a contract between this file and the Rust that
// goes looking for the viewer at runtime. If they drift, the installer ships
// a viewer and the app reports "not built yet" - a bug with no error message
// anywhere and nothing to grep for. Checked rather than commented.
const viewerRs = resolve(root, 'src-tauri', 'src', 'viewer.rs')
if (existsSync(viewerRs)) {
  const rust = readFileSync(viewerRs, 'utf8')
  const [folder, exe] = VIEWER_DEST.split('/')
  if (!rust.includes(`join("${folder}")`)) {
    throw new Error(
      `viewer.rs does not look for the viewer under a "${folder}" folder, but this ` +
        `bundles it to ${VIEWER_DEST}. One of the two moved; a bundled viewer the app ` +
        `cannot find reports as "not built yet" with no error anywhere.`
    )
  }
  if (!rust.includes(exe)) {
    throw new Error(`viewer.rs does not mention ${exe}; the bundled filename would not be found.`)
  }
}

/**
 * A release without a viewer is a supported build, not a broken one.
 *
 * `godot/shared-assets` is a *private* repository, and a workflow's built-in
 * token reaches only its own repo, so a release built without a credential for
 * it cannot export a viewer at all - which is how the first real run of this
 * workflow failed. The plan ships beta.1 with the viewer disabled anyway, so
 * the honest answer is to build the installer without it and say so, rather
 * than to fail the release or, worse, to quietly point the config at a file
 * that is not there and let Tauri decide what that means.
 *
 * `--require-viewer` is for the build that is supposed to have one: it refuses
 * rather than silently producing the smaller installer.
 */
const viewerBuilt = existsSync(resolve(root, 'godot', 'build', 'DRCompanionWorldViewer.exe'))
const requireViewer = process.argv.includes('--require-viewer')
if (requireViewer && !viewerBuilt) {
  console.error(
    'FAILED: --require-viewer was given but godot/build/DRCompanionWorldViewer.exe does not exist.\n' +
      '        Export it with `npm run godot:export` (needs the shared-assets submodule and Godot),\n' +
      '        or drop the flag to build an installer that honestly carries no viewer.'
  )
  process.exit(1)
}

const releaseConfig = {
  $schema: base.$schema ?? 'https://schema.tauri.app/config/2',
  bundle: {
    resources: viewerBuilt ? { ...resources, [VIEWER_SRC]: VIEWER_DEST } : { ...resources },
  },
}

if (check) {
  console.log(
    viewerBuilt
      ? `Release config would carry ${baseCount + 1} resources (${baseCount} inherited plus the world viewer).`
      : `Release config would carry ${baseCount} resources, all inherited. No viewer is built, so the ` +
        `installer would carry none - run with --require-viewer to make that a failure instead.`
  )
  process.exit(0)
}

writeFileSync(OUT, `${JSON.stringify(releaseConfig, null, 2)}\n`)
console.log(
  viewerBuilt
    ? `${OUT}: ${baseCount + 1} resources (${baseCount} inherited + the world viewer)`
    : `${OUT}: ${baseCount} resources, all inherited. NO world viewer in this installer.`
)
