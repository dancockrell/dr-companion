/**
 * The Godot content pack, found by what it does rather than by what it is
 * called.
 *
 * A content pack is whichever `.gd` file hands factories to `ContentRegistry`
 * — `ContentRegistry.register("<kind>", …)`. Three Node-side checks need that
 * set: `tools/world-content-test.mjs` (every primitive the content asks for
 * has a factory), `tools/build-scene-registry.mjs` (the editor's dropdowns are
 * the registry's), and `tools/scene-editor-test.mjs` (the same lists derived a
 * second way, from `shared_asset_status()`). All three used to hardcode
 * `godot/scripts/shared_asset_content.gd`, so when that file was deleted with
 * the rest of the 3D subsystem (docs/NO-3D.md) all three died on ENOENT in
 * three separate places, and two of them reached `tools/run-tests.mjs` as
 * NOT RUN with a stack trace rather than as anything a reader could act on.
 *
 * # Why a scan and not a new filename
 *
 * 3D is cancelled; Godot is not. A 2D content pack is coming, owned by the
 * Godot side, and nobody here knows what it will be called. A hardcoded second
 * filename would be a guess that has to be true, and the day it is wrong the
 * checks below would say NOT CHECKED over a pack that exists — an absence
 * indistinguishable from a real one. Scanning for the registration call means
 * the checks re-arm by themselves the moment a pack lands, whatever its name,
 * and stay red-capable throughout.
 *
 * # Three states, and this module only reports the third
 *
 * `findContentPack()` returns the pack, or `null` when the tree has none. It
 * never invents an empty one: a caller handed `{ registered: [] }` would find
 * every primitive undrawable and go red for a reason that is not true, and a
 * caller that treated the same empty set as "nothing to check" would report a
 * pass it never earned. `null` forces the caller to say NOT CHECKED out loud,
 * which is what `run-tests.mjs` collects and refuses to print "all passed"
 * over.
 *
 * # The seam
 *
 * `DRC_GODOT_SCRIPTS_DIR` points the scan somewhere else. That is not a
 * convenience: without it the no-pack branch and the pack-present branch
 * cannot both be executed on one checkout, so neither could be shown to work.
 * Point it at a directory holding a hand-written `.gd` and the checks that
 * consume this go red on a kind nothing registers, which is the only evidence
 * available that they still bite.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const CONTENT_PACK_DIR = process.env.DRC_GODOT_SCRIPTS_DIR ?? 'godot/scripts'

/** The one call that makes a kind drawable. */
const REGISTER_CALL = /ContentRegistry\.register\(\s*"([^"]+)"/g

/**
 * Every `ContentRegistry.register("kind", …)` in a pack's source, in the order
 * it registers them.
 */
export const registeredKinds = (source) => [...source.matchAll(REGISTER_CALL)].map((m) => m[1])

/**
 * The list a pack also hands out through `shared_asset_status()`.
 *
 * A second copy of the same fact living a few lines from the first, read only
 * so the two can be compared. `null` means the pack publishes no such list at
 * all, which is a different thing from publishing an empty one.
 */
export const advertisedKinds = (source) => {
  const m = /"registeredKinds"\s*:\s*\[([^\]]*)\]/.exec(source)
  if (!m) return null
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])
}

/**
 * The pack, or `null`.
 *
 * Two packs is an error rather than a choice: a kind registered in one and not
 * the other would make "is this kind drawable" a question with two answers,
 * and picking one here would decide it silently. Fail loudly and let somebody
 * merge them.
 */
export function findContentPack(dir = CONTENT_PACK_DIR) {
  if (!existsSync(dir)) return null
  const found = []
  for (const entry of readdirSync(dir).sort()) {
    if (!entry.endsWith('.gd')) continue
    const file = join(dir, entry).replaceAll('\\', '/')
    const source = readFileSync(file, 'utf8')
    const registered = registeredKinds(source)
    if (registered.length > 0) found.push({ file, source, registered })
  }
  if (found.length === 0) return null
  if (found.length > 1) {
    throw new Error(
      `${found.length} files under ${dir} register content factories (${found
        .map((p) => p.file)
        .join(', ')}). "Which kinds can Godot draw" then has two answers and everything reading this would pick one by accident. Merge them into one pack.`,
    )
  }
  return found[0]
}

/**
 * What to print when there is none. One sentence, stating the reason and what
 * would re-arm the check, because "NOT CHECKED" on its own is a shrug.
 */
export const NO_CONTENT_PACK_REASON =
  `no Godot content pack exists — nothing under ${CONTENT_PACK_DIR} calls ContentRegistry.register("<kind>", …). ` +
  'The 3D pack was deleted with the rest of the 3D subsystem (docs/NO-3D.md) and the 2D one is the Godot owner\'s work, not yet landed. ' +
  'This scans for the registration call rather than a filename, so it re-arms itself the moment a pack of any name appears.'
