/**
 * Report or remove shipped room art that the runtime cannot request.
 *
 * Reachable art is a file named by the frontend's actual runtime import graph.
 * Abandoned modules and map room numbers do not make an asset reachable.
 * Raw renders in data/art/out are deliberately untouched.
 *
 *   node tools/prune-room-art.mjs            # summary report only
 *   node tools/prune-room-art.mjs --verbose  # include every unused path
 *   node tools/prune-room-art.mjs --write    # prune and rebuild manifests
 */
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, normalize, resolve } from 'node:path'

const PUBLIC = 'public'
const ART_DIRS = ['rooms', 'room-scenes']

/**
 * Follow the frontend import graph instead of treating every abandoned source
 * file as live. The old pruner granted reachability to every numeric room key
 * in the map and to references in unimported modules, which protected 12,703
 * files the runtime had no code path to request.
 */
const runtimeSource = new Set()
const pendingSource = [resolve('src/main.tsx')]
const candidatesFor = (from, specifier) => {
  if (!specifier.startsWith('.')) return []
  const base = resolve(dirname(from), specifier)
  if (extname(base)) return [base]
  return [
    `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}.json`,
    join(base, 'index.ts'), join(base, 'index.tsx'), join(base, 'index.js'),
  ]
}

while (pendingSource.length) {
  const file = normalize(pendingSource.pop())
  if (runtimeSource.has(file) || !existsSync(file)) continue
  runtimeSource.add(file)
  if (!/\.(?:ts|tsx|js|jsx)$/.test(file)) continue
  const text = readFileSync(file, 'utf8')
  const imports = [
    ...text.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g),
    ...text.matchAll(/import\s*['"]([^'"]+)['"]/g),
  ]
  for (const match of imports) {
    const hit = candidatesFor(file, match[1]).find(existsSync)
    if (hit) pendingSource.push(hit)
  }
}

const sourceText = [...runtimeSource].map((file) => readFileSync(file, 'utf8')).join('\n')
const directReferences = new Set(
  [...sourceText.matchAll(/\/(rooms|room-scenes)\/([^'"\s)]+\.webp)/g)].map(
    (match) => `${match[1]}/${match[2]}`
  ).filter((rel) => !/[${}]/.test(rel))
)
const missingDirectReferences = [...directReferences].filter((rel) => !existsSync(join(PUBLIC, rel)))
if (missingDirectReferences.length) {
  throw new Error(`runtime references missing room art:\n${missingDirectReferences.join('\n')}`)
}

const unused = []
let reachableCount = 0
let reachableBytes = 0
for (const dir of ART_DIRS) {
  for (const name of readdirSync(join(PUBLIC, dir)).filter((file) => file.endsWith('.webp'))) {
    const rel = `${dir}/${name}`
    const bytes = statSync(join(PUBLIC, rel)).size
    const reachable = directReferences.has(rel)
    if (reachable) {
      reachableCount++
      reachableBytes += bytes
    } else {
      unused.push({ rel, bytes })
    }
  }
}

const unusedBytes = unused.reduce((sum, entry) => sum + entry.bytes, 0)
console.log(
  `${reachableCount} reachable room-art files (${(reachableBytes / 1024 / 1024).toFixed(1)} MiB logical)`
)
console.log(
  `${unused.length} unreachable room-art files (${(unusedBytes / 1024 / 1024).toFixed(1)} MiB logical)`
)
if (process.argv.includes('--verbose')) {
  for (const entry of unused) console.log(`unused ${entry.rel}`)
}

if (!process.argv.includes('--write')) process.exit(0)

for (const entry of unused) unlinkSync(join(PUBLIC, entry.rel))

for (const dir of ART_DIRS) {
  const manifest = readdirSync(join(PUBLIC, dir))
    .filter((name) => name.endsWith('.webp'))
    .sort()
  writeFileSync(
    join(PUBLIC, dir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 1)}\n`
  )
}
console.log(`pruned ${unused.length} files and rebuilt ${ART_DIRS.length} manifests`)
