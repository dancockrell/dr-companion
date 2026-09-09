#!/usr/bin/env node
/**
 * Which files under `src/` does nothing in the app graph reach?
 *
 *   node tools/unreachable-src.mjs
 *
 * Written while deleting the map (D6, `docs/NO-3D.md`), for one reason: that
 * deletion cascaded, and "is anything still importing this?" answered by
 * grepping a basename is the wrong question. A grep finds the word in a
 * comment; it does not find a module whose only importer was itself deleted
 * two rounds ago.
 *
 * # It is a report, not a gate
 *
 * Seventeen files were already unreachable before that deletion — the whole
 * `Dashboard`/`DashboardLayout`/`FreeCanvas` family among them — so a check
 * that failed on the mere existence of an orphan would have been red on
 * arrival and would have had to be silenced, which is worse than not having
 * it. `KNOWN` below is the list as it stood after D6. What this reports is the
 * *difference*, so a module going dark is visible in the run that did it.
 *
 * Update `KNOWN` when you delete one of them or wire one back up, and say so
 * in the commit. It is a manifest, and a manifest nobody maintains is a
 * manifest that stops meaning anything.
 *
 * # What it cannot tell you
 *
 * Reachable from the app is not the same as alive. `src/lib/mapLandmarks.ts`
 * is on this list and is load-bearing: `tools/build-world-content.mjs` and
 * `tools/build-scene-registry.mjs` import it to build what Godot consumes.
 * The walk starts at `src/main.tsx` and follows relative imports only, so
 * anything a *tool* or a test imports directly looks unreachable from here.
 * Check the tools before deleting anything this names.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY = join(root, 'src', 'main.tsx')

/**
 * Unreachable as of 9 Sep 2026, after D6.
 *
 * The five marked `D6` went dark in that change and are named in
 * `docs/verification/map-gone-2026-09-09.md`; issue #522 holds the decision on
 * them. The rest were already unreachable and are somebody else's to explain.
 */
const KNOWN = new Set([
  'src/components/dashboard/Dashboard.tsx',
  'src/components/dashboard/DashboardLayout.tsx',
  'src/components/dashboard/DockView.tsx',
  'src/components/dashboard/FreeCanvas.tsx',
  'src/components/room/TeachingPanel.tsx',
  'src/components/shared/Box.tsx',
  'src/components/shared/Panel.tsx',
  'src/components/shared/QuickQueuePanel.tsx',
  'src/components/shared/RoomCards.tsx',
  'src/components/shared/RoomPanel.tsx',
  'src/data/genieScripts.ts',
  'src/lib/mapLandmarks.ts', // D6 - but live: the world-content builders import it
  'src/lib/panelDataContracts.ts',
  'src/lib/panelVisibility.ts',
  'src/lib/pinNudge.ts', // D6
  'src/lib/pinTaskGenerator.ts', // D6
  'src/lib/pinsFile.ts', // D6
  'src/lib/playerMarker.ts', // D6
  'src/lib/queueDriver.ts',
  'src/lib/roomOccupants.ts',
  'src/lib/useDismiss.ts',
  'src/types/worldPresentation.ts',
])

function allSources(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...allSources(p))
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

function resolveSpec(fromFile, spec) {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(fromFile), spec)
  // `./x.ts` in source may be `x.tsx` on disk; a bare `./x` may be either, or
  // a directory index.
  const candidates = [
    base.replace(/\.ts$/, '.tsx'),
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]
  for (const c of candidates) {
    if (!/\.(ts|tsx)$/.test(c)) continue
    if (existsSync(c) && statSync(c).isFile()) return c
  }
  return null
}

const IMPORT = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g

const seen = new Set()
const queue = [ENTRY]
while (queue.length) {
  const file = queue.pop()
  if (seen.has(file) || !existsSync(file)) continue
  seen.add(file)
  for (const [, spec] of readFileSync(file, 'utf8').matchAll(IMPORT)) {
    const target = resolveSpec(file, spec)
    if (target && !seen.has(target)) queue.push(target)
  }
}

/**
 * The denominator, and it is the fragile one: this number goes to zero when
 * the *resolver* breaks, at which point every file in the tree looks
 * unreachable and this script would otherwise report a catastrophe with total
 * confidence. Far below the real count on purpose.
 */
const FLOOR = 100
if (seen.size < FLOOR) {
  console.log(`FAIL the walk reached only ${seen.size} files; this app has at least ${FLOOR}.`)
  console.log('     That is a broken resolver, not a dead tree. Nothing below is trustworthy.')
  process.exit(1)
}

const all = allSources(join(root, 'src'))
const orphans = all
  .filter((f) => !seen.has(f))
  .map((f) => relative(root, f).replace(/\\/g, '/'))
  .sort()

const appeared = orphans.filter((f) => !KNOWN.has(f))
const resolved = [...KNOWN].filter((f) => !orphans.includes(f)).sort()

console.log(`reached ${seen.size} of ${all.length} files under src/, from src/main.tsx`)
console.log(`${orphans.length} unreachable, ${KNOWN.size} of them already known`)

for (const f of appeared) console.log(`  NEW      ${f}`)
for (const f of resolved) console.log(`  RESOLVED ${f}  (wired back up, or deleted - drop it from KNOWN)`)

if (!appeared.length && !resolved.length) {
  console.log('no change: every unreachable file is one KNOWN already names')
  process.exit(0)
}
console.log('\nKNOWN in tools/unreachable-src.mjs disagrees with the tree. Update it and say so in the commit.')
process.exit(1)
