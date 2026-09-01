/**
 * Report or remove shipped room art that the runtime cannot request.
 *
 * Reachable art is either a numeric {zone}-{room} file for a room in the
 * current map, or a file named explicitly by runtime source (normally a
 * curated override). Raw renders in data/art/out are deliberately untouched.
 *
 *   node tools/prune-room-art.mjs          # report only
 *   node tools/prune-room-art.mjs --write  # prune and rebuild manifest
 */
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const PUBLIC = 'public'
const ART_DIRS = ['rooms', 'room-scenes']

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
  )
}

const sourceText = [...walk('src'), ...walk('tools')]
  .filter((file) => /\.(?:ts|tsx|mjs|json)$/.test(file))
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n')
const directReferences = new Set(
  [...sourceText.matchAll(/\/(rooms|room-scenes)\/([^'"\s)]+\.webp)/g)].map(
    (match) => `${match[1]}/${match[2]}`
  ).filter((rel) => !/[${}]/.test(rel))
)
const missingDirectReferences = [...directReferences].filter((rel) => !existsSync(join(PUBLIC, rel)))
if (missingDirectReferences.length) {
  throw new Error(`runtime references missing room art:\n${missingDirectReferences.join('\n')}`)
}

const mapRoomKeys = new Set()
for (const file of readdirSync('src/data/map').filter(
  (name) => name.endsWith('.json') && name !== 'index.json'
)) {
  const zone = basename(file, '.json')
  const map = JSON.parse(readFileSync(join('src/data/map', file), 'utf8'))
  const rooms = Array.isArray(map) ? map : (map.rooms ?? [])
  for (const room of rooms) {
    if (room?.id !== undefined) mapRoomKeys.add(`${zone}-${room.id}`)
  }
}

const unused = []
let reachableCount = 0
let reachableBytes = 0
for (const dir of ART_DIRS) {
  for (const name of readdirSync(join(PUBLIC, dir)).filter((file) => file.endsWith('.webp'))) {
    const rel = `${dir}/${name}`
    const key = name.slice(0, -5)
    const bytes = statSync(join(PUBLIC, rel)).size
    const reachable = directReferences.has(rel) || (dir === 'rooms' && mapRoomKeys.has(key))
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
for (const entry of unused) console.log(`unused ${entry.rel}`)

if (!process.argv.includes('--write')) process.exit(0)

for (const entry of unused) unlinkSync(join(PUBLIC, entry.rel))

const roomManifest = readdirSync(join(PUBLIC, 'rooms'))
  .filter((name) => name.endsWith('.webp'))
  .sort()
writeFileSync(
  join(PUBLIC, 'rooms', 'manifest.json'),
  `${JSON.stringify(roomManifest, null, 1)}\n`
)
console.log(`pruned ${unused.length} files and rebuilt public/rooms/manifest.json`)
