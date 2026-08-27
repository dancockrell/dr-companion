#!/usr/bin/env node
/**
 * Fails the build when a component reads the game buffer directly instead of
 * going through `src/lib/useGameLines.ts`.
 *
 * # Why this is a check and not a comment
 *
 * `gameLines()` hands back the live buffer, and `buffer.push(...)` mutates it
 * in place, so its array reference never changes. Anything that compares that
 * reference — a `useEffect` dep array, a `useMemo` key,
 * `useSyncExternalStore`'s snapshot check — concludes "nothing changed",
 * forever. Nothing throws. The subscriber silently stops running and the UI
 * still looks alive, because some other subscription usually drags the render
 * along with it.
 *
 * `gameVersion()` exists as the counter to subscribe to instead, and carries a
 * long comment saying exactly that. **The defect then happened twice more.**
 * The last occurrence silenced every alert sound for the whole life of the
 * feature, in a file that imports `gameVersion` in the same import statement
 * as the accessor it got wrong. It was found by someone counting
 * `Audio.play()` calls against a replay fixture, not by anyone reading code.
 *
 * Three occurrences with the explanation already written down is the point at
 * which "be careful" has been measured and found not to work. So the rule
 * stops being advice and starts being a build failure.
 *
 * Run: node tools/gamelines-test.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'

/**
 * The tree to check. Overridable so the unhappy paths can be run on purpose.
 *
 * Both failure branches below — a violation found, and a scan that came back
 * too small — are unreachable against a healthy repo, and a branch nobody can
 * execute deliberately is a branch nobody can prove they fixed. Pointing this
 * at a synthetic tree costs one environment variable and makes both of them
 * demonstrable instead of asserted.
 */
const ROOT = process.env.DRC_GAMELINES_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..')

/** Raw accessors that read the mutable buffer. Safe only inside the hook. */
const RAW = ['gameLines', 'gameLinesFrom', 'gameStreams', 'gameVersion']

/**
 * The one file allowed to touch them, because subscribing correctly is the
 * whole of what it does.
 */
const ALLOWED = [join('src', 'lib', 'useGameLines.ts')]

/**
 * Where components live. Deliberately not all of `src/`: `src/lib` and
 * `src/store` contain non-React code that may legitimately take a plain
 * reading of the buffer, and widening this to catch them would produce
 * exemptions, which is how a rule becomes decoration.
 */
const SCAN_ROOTS = [join('src', 'components')]

/**
 * A floor on how many files must be scanned.
 *
 * Set well below the real count so it never needs touching, and exists solely
 * so that a walker that silently finds nothing — a moved directory, a changed
 * extension, a bad join — reports itself instead of reporting a clean tree.
 * An empty scan and a compliant codebase produce identical output otherwise,
 * and this repo has shipped that mistake more than once.
 */
const MIN_FILES = 20

function walk(dir) {
  const out = []
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(full)) out.push(full)
  }
  return out
}

const files = SCAN_ROOTS.flatMap((r) => walk(join(ROOT, r)))

if (files.length < MIN_FILES) {
  console.error(
    `gamelines-test: scanned only ${files.length} files, expected at least ${MIN_FILES}.\n` +
      `Roots: ${SCAN_ROOTS.join(', ')}\n` +
      'This is the check failing, not the codebase passing — a walker that ' +
      'finds nothing looks exactly like a tree with no violations. Fix the ' +
      'scan before trusting any result from it.'
  )
  process.exit(1)
}

/**
 * Match the import, not the identifier.
 *
 * `lines.length` and a local named `gameStreams` are not the defect; taking
 * the accessor out of `gameLink` is. Matching bare identifiers would fire on
 * comments and prose — and a check that cries wolf gets suppressed, which
 * costs more than the check was worth.
 */
const importRe = /import\s*\{([^}]*)\}\s*from\s*['"][^'"]*gameLink['"]/gs

const violations = []
for (const file of files) {
  const rel = relative(ROOT, file)
  if (ALLOWED.includes(rel) || ALLOWED.includes(rel.split('/').join(sep))) continue
  const src = readFileSync(file, 'utf8')
  for (const m of src.matchAll(importRe)) {
    const named = m[1]
      .split(',')
      .map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim())
      .filter(Boolean)
    for (const bad of named.filter((n) => RAW.includes(n))) {
      violations.push({ file: rel, name: bad })
    }
  }
}

console.log(`Component files scanned:        ${files.length}`)
console.log(`Raw accessors watched:          ${RAW.join(', ')}`)
console.log(`Files allowed to use them:      ${ALLOWED.join(', ')}`)

if (violations.length === 0) {
  console.log('OK — every component reads the buffer through useGameLines().')
  process.exit(0)
}

console.error('\ngamelines-test: FAILED\n')
for (const v of violations) {
  console.error(`  ${v.file} imports ${v.name} from gameLink`)
}
console.error(
  '\nThese read the mutable buffer directly. A dep array or memo key built ' +
    'on what they return will never change, and the subscriber will stop ' +
    'running with no error anywhere — that has now happened three times in ' +
    'this codebase.\n' +
    'Use useGameLines() / useGameStreams() from src/lib/useGameLines.ts, ' +
    'which subscribe and return an identity that changes when the buffer ' +
    'does.\n' +
    'If a component genuinely needs an unsubscribed read, say why in a ' +
    'comment and add it to ALLOWED here — deliberately, so the exemption is ' +
    'visible rather than accidental.\n'
)
process.exit(1)
