import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const dir = mkdtempSync(join(tmpdir(), 'room-scene-patterns-'))
const out = join(dir, 'roomScenePatterns.mjs')
writeFileSync(out, ts.transpileModule(readFileSync('src/data/roomScenePatterns.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText)
const { roomScenePattern } = await import(pathToFileURL(out).href)

let failures = 0
const check = (condition, message) => {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${message}`)
  if (!condition) failures++
}

// The generated first rule is enough to prove three-room holds and cycling
// without coupling this test to one particular place name.
const source = readFileSync('src/data/roomScenePatterns.ts', 'utf8')
const match = source.match(/\{"zone":"([^"]+)","ranges":\[\[(\d+),(\d+)\]\],"arts":\[("[^"]+"(?:,"[^"]+")*)\]\}/)
check(Boolean(match), 'generated rules are readable')
if (match) {
  const [, zone, firstText, lastText, artText] = match
  const first = Number(firstText)
  const last = Number(lastText)
  const arts = JSON.parse(`[${artText}]`)
  check(roomScenePattern(zone, first) === arts[0], 'range begins with first approved scene')
  if (last >= first + 2) check(roomScenePattern(zone, first + 2) === arts[0], 'scene holds across three adjacent rooms')
  if (last >= first + 3 && arts.length > 1) check(roomScenePattern(zone, first + 3) === arts[1], 'next three-room run advances to next scene')
  check(roomScenePattern(zone, first) === roomScenePattern(zone, first), 'selection is stable across repeated calls')
}

const baskets = JSON.parse(readFileSync('data/art/scene-baskets.json', 'utf8'))
for (const family of [...Object.values(baskets.generic), ...Object.values(baskets.regionalCity)]) {
  for (const art of family) check(existsSync(`public${art}`), `basket asset exists: ${art}`)
}
const coverage = JSON.parse(readFileSync('data/art/scene-basket-coverage.json', 'utf8'))
check(coverage.roomCount >= 1700, `generic patterns cover ${coverage.roomCount} rooms without swallowing protected landmarks`)
check(!coverage.assignments.some(({ placeKey }) => placeKey === '4a::Behind the Goal Line'), 'special sports location is not treated as generic grassland')
check(coverage.protectedLandmarks.includes('1::Sewer'), 'curated landmark places remain protected')

process.exit(failures ? 1 : 0)
