/**
 * The pieces every GDScript source scan in this repository needs: which `.gd`
 * files are ours, and which half of a line is code.
 *
 * Extracted from `tools/board-geometry-drift-test.mjs`, which had all of this
 * and was about to acquire a second copy in
 * `tools/nullable-field-coercion-test.mjs`. Two walkers answering "which files
 * does this repository own" would drift, and the one that drifted would be
 * whichever was not being edited that day - so there is one, and both scanners
 * import it.
 *
 * Nothing here decides anything about the viewer. It supplies the population
 * and the text; what is refused is each scanner's own business.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, sep as SEPARATOR } from 'node:path'

/**
 * The repository-relative path of every git submodule, read out of
 * `.gitmodules`.
 *
 * Derived rather than listed so a second submodule is excluded without this
 * file being touched, and returned as a Set of forward-slash paths because that
 * is how `.gitmodules` spells them on every platform.
 *
 * Callers must assert the size before trusting a clean scan: an empty result
 * silently puts the exclusion back to scanning another repository's code, which
 * is the state this replaced. `godot/shared-assets` is a checkout of
 * `project-42-pirate-island-rpg`, and whether it happens to be initialised is
 * not a fact about this viewer.
 */
export const submodulePaths = () => {
  const found = new Set()
  let text = ''
  try {
    text = readFileSync('.gitmodules', 'utf8')
  } catch {
    return found
  }
  for (const line of text.split('\n')) {
    const match = /^\s*path\s*=\s*(.+?)\s*$/.exec(line)
    if (match) found.add(match[1].split(SEPARATOR).join('/'))
  }
  return found
}

/**
 * Every `.gd` file under `dir` that belongs to this repository.
 *
 * A directory named by `.gitmodules` is another repository's checkout and is
 * skipped whole, initialised or not.
 */
export const gdFiles = (dir, modulePaths = submodulePaths()) => {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const relative = full.split(SEPARATOR).join('/')
    if (modulePaths.has(relative)) continue
    if (statSync(full).isDirectory()) out.push(...gdFiles(full, modulePaths))
    else if (entry.endsWith('.gd')) out.push(full)
  }
  return out
}

/**
 * One GDScript line with its comment removed, string literals intact.
 *
 * Cutting at the first `#` would be wrong: `Color("#58724b")` in
 * `shared_asset_content.gd` puts a `#` inside a string on a line that also
 * carries real code, so a naive cut hides the rest of the line and a scan
 * reports clean because it stopped reading.
 */
export const stripComment = (line) => {
  let out = ''
  let quote = ''
  for (const ch of line) {
    if (quote) {
      out += ch
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      out += ch
      continue
    }
    if (ch === '#') break
    out += ch
  }
  return out
}

/**
 * The code half of one GDScript line with string literals blanked as well:
 * what a scan for *numbers* wants, since a number inside a string is prose.
 *
 * A scan for field *names* wants `stripComment` instead - blanking the strings
 * would throw away the very thing it reads.
 */
export const codeOnly = (line) => {
  let out = ''
  let quote = ''
  for (const ch of stripComment(line)) {
    if (quote) {
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    out += ch
  }
  return out
}
