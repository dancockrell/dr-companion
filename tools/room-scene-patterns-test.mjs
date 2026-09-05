import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { analyzeScene, semanticPromptContext } from './scene-semantics.mjs'

const dir = mkdtempSync(join(tmpdir(), 'room-scene-patterns-'))
const out = join(dir, 'roomScenePatterns.mjs')
writeFileSync(out, ts.transpileModule(readFileSync('src/data/roomScenePatterns.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText)
const { roomScenePattern } = await import(pathToFileURL(out).href)
let failures = 0
const check = (condition, message) => { console.log(`${condition ? 'OK  ' : 'FAIL'} ${message}`); if (!condition) failures++ }

const source = readFileSync('src/data/roomScenePatterns.ts', 'utf8')
const match = source.match(/\["([^"]+)",\[\[(\d+),(\d+)\]\],\d+\]/)
check(Boolean(match), 'generated rules are readable')
if (match) {
  const [, zone, firstText, lastText] = match
  const first = Number(firstText), last = Number(lastText), firstArt = roomScenePattern(zone, first)
  check(typeof firstArt === 'string', 'range begins with an approved scene')
  if (last >= first + 2) check(roomScenePattern(zone, first + 2) === firstArt, 'scene holds across three adjacent rooms')
  check(roomScenePattern(zone, first) === roomScenePattern(zone, first), 'selection is stable across repeated calls')
}
check(roomScenePattern('69', 474) !== roomScenePattern('69', 477), 'a reviewed multi-image range advances after its three-room hold')

const baskets = JSON.parse(readFileSync('data/art/scene-baskets.json', 'utf8'))
for (const family of [...Object.values(baskets.generic), ...Object.values(baskets.regionalCity)]) for (const art of family) check(existsSync(`public${art}`), `basket asset exists: ${art}`)
for (const city of Object.keys(baskets.regionalCity)) {
  const identity = baskets.regionalIdentity?.[city]
  check(Boolean(identity?.subject && identity?.terrain && identity?.builtForm && identity?.atmosphere), `${city} has a reviewed regional visual identity`)
  check(Array.isArray(identity?.generationHints) && identity.generationHints.length >= 2, `${city} regional identity has concrete generation hints`)
}
const crossing = baskets.regionalIdentity?.Crossing
const crossingDistricts = crossing?.districts ?? {}
for (const district of ['town-green-civic','market-commercial','river-quays','gates-walls','temple-quarter','residential-backstreets','riverpine-outskirts','guild-civic-interiors','amusement-carousel']) {
  check(Array.isArray(crossingDistricts[district]?.places) && crossingDistricts[district].places.length >= 3, `Crossing ${district} has an explicit place family`)
  check(Array.isArray(crossingDistricts[district]?.visualLanguage) && crossingDistricts[district].visualLanguage.length >= 3, `Crossing ${district} has visual-language constraints`)
}
check((crossing?.priorityLandmarks ?? []).length >= 8, 'Crossing has a landmark production priority list')
check((crossing?.productionQueue ?? []).length >= 8, 'Crossing has a precise missing-art production queue')
check(crossing.productionQueue.every((item) => Number.isInteger(item.priority) && item.id && item.kind && item.places?.length && item.reason && item.prompt?.length >= 200), 'every Crossing production item has priority, scope, rationale, and a generation-ready prompt')
check(new Set(crossing.productionQueue.map((item) => item.priority)).size === crossing.productionQueue.length, 'Crossing production priorities are unique')
check(crossing.approvedGenericPlaces.length > 0 && crossing.approvedGenericPlaces.length < 4, 'Crossing generic street art is narrowly allow-listed')
check((crossing?.avoid ?? []).some((item) => /generic medieval street/.test(item)), 'Crossing explicitly rejects one-street-fits-all art')
check(Object.keys(crossing?.plannedArtFamilies ?? {}).length >= 8, 'Crossing has generation-ready differentiated art families')
check(Object.values(crossing?.plannedArtFamilies ?? {}).every((family) => family.priority && family.variants && family.prompt?.length > 100), 'Crossing planned families have priority, variant count, and authoritative prompts')
check(baskets.reviewedPlaceAssignments?.["1::Traders' Market"]?.category === 'regional-city', 'Crossing Traders Market has a reviewed exact assignment')
check(baskets.reviewedPlaceAssignments?.['6::Brambles']?.arts?.length === 4, 'Brambles has a four-view reviewed Magnific route family')
check(/magnific-art\/room-scenes\/brambles-route/.test(roomScenePattern('6', 275) ?? ''), 'Brambles selects its exact Magnific family instead of generic forest art')

const coverage = JSON.parse(readFileSync('data/art/scene-basket-coverage.json', 'utf8'))
// The audit is generated into the gitignored data/art/out, so a fresh worktree
// does not have it and this line threw ENOENT after 74 passing checks. Under
// the runner that is NOT RUN, which is why this suite was never registered.
// The builder reads tracked inputs only and takes a fifth of a second, so the
// dependency is satisfied here rather than declared unavailable - the same
// shape geometric-room-briefs-test.mjs already uses for its own input.
const AUDIT = 'data/art/out/scene-basket-audit.json'
if (!existsSync(AUDIT)) {
  // The builder also rewrites two *tracked* files it happens to own. Running a
  // test must not leave the tree dirty, and it must especially not quietly
  // regenerate a committed file that has drifted - that would repair the very
  // disagreement the coverage checks below exist to report. So their bytes are
  // put back exactly as found; `coverage` above was already read from the
  // committed copy, so the comparison is still committed-against-freshly-derived.
  const tracked = ['src/data/roomScenePatterns.ts', 'data/art/scene-basket-coverage.json']
  const before = tracked.map((path) => [path, readFileSync(path)])
  try {
    execFileSync(process.execPath, ['tools/build-room-scene-patterns.mjs'], { stdio: 'inherit' })
  } finally {
    for (const [path, bytes] of before) writeFileSync(path, bytes)
  }
}
check(existsSync(AUDIT), 'the generated scene-basket audit is available')
const audit = JSON.parse(readFileSync(AUDIT, 'utf8'))
check(coverage.roomCount >= 1700, `generic patterns cover ${coverage.roomCount} rooms without swallowing protected landmarks`)
check(coverage.assignmentCount === audit.assignments.length, 'coverage assignment count matches full audit')
check(coverage.unresolvedCount === audit.unresolved.length, 'coverage unresolved count matches full audit')
check(coverage.regions?.Crossing?.assignedRoomCount > 170, 'Crossing keeps substantial reviewed or archetype-backed runtime coverage')
check(coverage.regions?.Crossing?.unresolvedRoomCount < 750, 'Crossing unresolved-room scope remains explicitly measured')
check(!audit.assignments.some(({ placeKey }) => placeKey === '4a::Behind the Goal Line'), 'special sports location is not treated as generic grassland')
check(coverage.protectedLandmarks.includes('1::Sewer'), 'curated landmark places remain protected')
check(audit.assignments.some(({ placeKey, category }) => placeKey === '4::Doline' && category === 'riverside'), 'Applebrandy River Doline keeps its title-backed riverside assignment')
check(audit.assignments.some(({ placeKey, category }) => placeKey === '7::Low Rise' && category === 'deep-forest'), 'Sicle Grove Low Rise uses natural-grove art rather than a cultivated garden')
check(audit.assignments.every((assignment) => Number.isFinite(assignment.confidence) && assignment.confidence >= 0 && assignment.confidence <= 1 && assignment.traits && typeof assignment.traits === 'object' && Array.isArray(assignment.signals) && assignment.signals.some((signal) => signal.startsWith('title:') || signal.startsWith('reviewed:'))), 'every assignment is explainable, scored, and backed by title evidence or exact review')
check(audit.unresolved.every((assignment) => Number.isFinite(assignment.confidence) && assignment.traits && typeof assignment.traits === 'object' && Array.isArray(assignment.signals)), 'unresolved places retain semantic evidence for later curation')
const crossingAssignments = audit.assignments.filter(({ zone }) => zone === '1')
check(crossingAssignments.filter(({ category }) => category === 'regional-city').every(({ placeKey, selectionLayer, regionalIdentity, regionalDistrict }) => crossing.approvedGenericPlaces.includes(placeKey.split('::')[1]) && selectionLayer === 'regional-family' && regionalIdentity === 'Crossing' && regionalDistrict), 'Crossing regional art is assigned only to reviewed generic-compatible places with district evidence')
check(!audit.assignments.some(({ placeKey }) => placeKey === '1::Goldstone Square') && audit.unresolved.some(({ placeKey }) => placeKey === '1::Goldstone Square'), 'Goldstone Square rich-residence text remains unresolved instead of receiving market-street art')
for (const placeKey of ['1::Clanthew Boulevard','1::Riverpine Circle','1::Midton Circle',"1::Holy Warrior's Promenade",'1::Riverlace Lane']) {
  check(!audit.assignments.some((assignment) => assignment.placeKey === placeKey), `${placeKey} is not forced into generic Crossing street art`)
  check(audit.unresolved.some((assignment) => assignment.placeKey === placeKey && assignment.reason === 'crossing-district-art-required' && assignment.regionalDistrict), `${placeKey} retains its Crossing district requirement in the audit`)
}

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
for (const [place, category] of cases) check(analyzeScene(place).category === category, `${place.title} classifies as ${category ?? 'special/unassigned'}`)

const wilderness = analyzeScene({ title: 'Brambles', lore: 'A huge hole tears through the brambles. A scarred tree leaks sap beside the dirt trail.' })
const context = semanticPromptContext(wilderness)
check(!/stone and timber architecture|torchlight|candlelight/.test(context), 'semantic prompt context does not inject settlement architecture or artificial light into wilderness')
check(wilderness.traits.civilization !== 'urban', 'wilderness is not promoted to an urban scene without evidence')

// Regenerated on purpose - these checks are about what the generator produces
// today, not about what was committed. But data/art/archetype-prompts.json is
// tracked, so it is put back afterwards: this suite was unregistered until now,
// and registering a test that leaves a modified file behind on every full run
// would hand every lane a dirty tree to explain.
const ARCHETYPES = 'data/art/archetype-prompts.json'
const archetypesCommitted = readFileSync(ARCHETYPES)
let archetypes
try {
  execFileSync(process.execPath, ['tools/art-archetypes.mjs'], { stdio: 'ignore' })
  archetypes = JSON.parse(readFileSync(ARCHETYPES, 'utf8'))
} finally {
  writeFileSync(ARCHETYPES, archetypesCommitted)
}
const forestPrompt = archetypes['archetype-deep-forest-0']?.prompt ?? ''
const templePrompt = archetypes['archetype-temple-0']?.prompt ?? ''
check(!/stone and timber architecture|torchlight|candlelight/.test(forestPrompt), 'generated wilderness archetype has no settlement architecture or forced artificial light')
check(/candlelight/.test(templePrompt), 'scene-specific temple prompt can still request candlelight explicitly')
process.exit(failures ? 1 : 0)
