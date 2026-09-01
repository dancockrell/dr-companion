import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { analyzeScene, semanticPromptContext } from './scene-semantics.mjs'

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
check(coverage.assignments.some(({ placeKey, category }) => placeKey === '4::Doline' && category === 'riverside'), 'Applebrandy River Doline keeps its title-backed riverside assignment')
check(coverage.assignments.some(({ placeKey, category }) => placeKey === '7::Low Rise' && category === 'deep-forest'), 'Sicle Grove Low Rise uses natural-grove art rather than a cultivated garden')
check(coverage.assignments.every((assignment) =>
  Number.isFinite(assignment.confidence) &&
  assignment.confidence >= 0 && assignment.confidence <= 1 &&
  assignment.traits && typeof assignment.traits === 'object' &&
  Array.isArray(assignment.signals) &&
  assignment.signals.some((signal) => signal.startsWith('title:'))
), 'every automatic assignment is explainable, scored, and backed by title evidence')
check((coverage.unresolved ?? []).every((assignment) =>
  Number.isFinite(assignment.confidence) &&
  assignment.traits && typeof assignment.traits === 'object' &&
  Array.isArray(assignment.signals)
), 'unresolved places retain semantic evidence for later curation')

const cases = [
  [{ title: 'Paasvadh Forest, Understory', lore: 'Shadows hang from the forest canopy above thick undergrowth.' }, 'deep-forest'],
  [{ title: 'Old Forest Trail', lore: 'A narrow path winds between mature trees.' }, 'forest-path'],
  [{ title: 'The Marsh, In The Water', lore: 'Cold wet moss and standing water surround twisted trees.' }, 'swamp'],
  [{ title: 'Temple Catacombs', lore: 'Frost-covered stairs descend into subterranean passages.' }, 'mine-tunnel'],
  [{ title: 'Magen Road', lore: 'Cobbled buildings line the busy town street.' }, null],
  [{ title: 'Behind the Goal Line', lore: 'The playing field opens toward the stadium.' }, null],
  [{ title: 'Applebrandy River, Doline', lore: 'A sinkhole lies in the riverbed.' }, 'riverside'],
  [{ title: 'Sicle Grove, Low Rise', lore: 'Ash and dust cover the rise below smoke-shrouded mountains.' }, 'deep-forest'],
  [{ title: 'Doline', lore: 'A river curls through the low ground below the path.' }, null],
]
for (const [place, category] of cases) {
  const result = analyzeScene(place)
  check(result.category === category, `${place.title} classifies as ${category ?? 'special/unassigned'}`)
}

const wilderness = analyzeScene({
  title: 'Brambles',
  lore: 'A huge hole tears through the brambles. A scarred tree leaks sap beside the dirt trail.',
})
const context = semanticPromptContext(wilderness)
check(!/stone and timber architecture|torchlight|candlelight/.test(context), 'semantic prompt context does not inject settlement architecture or artificial light into wilderness')
check(wilderness.traits.civilization !== 'urban', 'wilderness is not promoted to an urban scene without evidence')

process.exit(failures ? 1 : 0)
