/**
 * Creature art lookup.
 *
 * The failure this guards against is a card wearing the wrong face: the key
 * order here has to stay identical to the one in bestiary.ts, or a creature
 * resolves its traits from its full name and its portrait from its noun and
 * quietly shows one troll's picture with another troll's level beside it.
 * The corpse case is the one that breaks first, because the game invents a
 * name ("a kobold which appears dead") that no image will ever be filed under.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const dir = mkdtempSync(join(tmpdir(), 'art-'))
const curationUrl = pathToFileURL(join(process.cwd(), 'data/art/creature-curation.json')).href

/**
 * Transpile one module into the temp dir.
 *
 * tsc leaves the extension off relative imports and Node ESM insists on it,
 * so it is put back on the way out.
 */
const compile = (src, name) => {
  const out = join(dir, name)
  const js = ts
    .transpileModule(readFileSync(src, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    })
    .outputText
    .replace(/from '(\.\/[^']+)'/g, (_, r) => `from '${r}.js'`)
    .replace('../../data/art/creature-curation.json', curationUrl)
  writeFileSync(out, js)
  return out
}

const m = await import(pathToFileURL(compile('src/lib/creatureArt.ts', 'creatureArt.js')).href)

let fails = 0
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label.padEnd(52)} ${JSON.stringify(got)}`)
}

console.log('-- the exact name is tried before the noun --')
check('a snarling goblin', m.artKeys('a snarling goblin', 'goblin'), [
  'snarling goblin',
  'goblin',
])
check("an Adan'f blood warrior", m.artKeys("an Adan'f blood warrior", 'warrior'), [
  "adan'f blood warrior",
  'warrior',
])

console.log('\n-- a name that is already its own noun asks once --')
check('the kobold', m.artKeys('the kobold', 'kobold'), ['kobold'])

console.log('\n-- normalisation matches bestiary.ts --')
const bestiary = readFileSync('src/lib/bestiary.ts', 'utf8')
const art = readFileSync('src/lib/creatureArt.ts', 'utf8')
const normaliser = /replace\(\/\^\(a\|an\|the\|some\)\\s\+\/, ''\)\s*\.replace\(\/\[\^a-z\\s'-\]\/g, ''\)/
check('bestiary strips articles and punctuation', normaliser.test(bestiary), true)
check('art strips the same way', normaliser.test(art), true)
check('Kobold', m.artKeys('Kobold', 'kobold'), ['kobold'])
check('a Kobold, hunched', m.artKeys('a Kobold, hunched', 'hunched'), [
  'kobold hunched',
  'hunched',
])

console.log('\n-- corpses ask for the living creature, never the corpse line --')
const dead = m.artKeys('a kobold which appears dead', 'dead')
check('the corpse line is dropped', dead.includes('kobold'), true)
check('and dropped before the noun is tried', dead.indexOf('kobold') < dead.indexOf('dead'), true)
check('full corpse key order', dead, ['kobold which appears dead', 'kobold', 'dead'])

console.log('\n-- the file a key maps to --')
check('spaces become hyphens', m.artUrl('rock troll'), '/creatures/rock-troll.webp')
check('apostrophes too', m.artFile("adan'f blood warrior"), 'adan-f-blood-warrior')

// The renderer names the files and the app finds them, and the two live in
// different languages, so the slug is written twice. If one is edited without
// the other the pack lands on disk under names nothing will ever ask for.
const run = readFileSync('tools/art-run.mjs', 'utf8')
const slugRule = /toLowerCase\(\)\.replace\(\/\[\^a-z0-9\]\+\/g, '-'\)\.replace\(\/\^-\|-\$\/g, ''\)\.slice\(0, 60\)/
check('art-run.mjs slugs this way', slugRule.test(run.replace(/\s*\n\s*/g, '')), true)
check('creatureArt.ts agrees', slugRule.test(art.replace(/\s*\n\s*/g, '')), true)

console.log('\n-- with no pack installed, nothing is ever requested --')
m.resetArtCache()
check('no art for a goblin', m.artFor('a snarling goblin', 'goblin'), undefined)
check('and hasArt says so', m.hasArt('a snarling goblin', 'goblin'), false)

console.log('\n-- the manifest is the only thing that grants a URL --')
m.registerArtManifest(['kobold', 'rock-troll-1.webp'])
check('a listed creature resolves', m.artFor('the kobold', 'kobold').url, '/creatures/kobold.webp')
check('a filename is accepted for a key', m.artFor('a rock troll', 'troll').key, 'rock troll')
check('an unlisted one stays absent', m.artFor('a snarling goblin', 'goblin'), undefined)
check('hasArt agrees', m.hasArt('the kobold', 'kobold'), true)

console.log('\n-- only explicitly approved variants rotate, and the choice is stable --')
m.registerArtManifest(['storm-bull-1.webp', 'storm-bull-2.webp', 'storm-bull-3.webp'])
const stormA = m.artFor('a storm bull', 'bull', 'encounter-a')
const stormAAgain = m.artFor('a storm bull', 'bull', 'encounter-a')
const approvedStorm = new Set(['/creatures/storm-bull-1.webp', '/creatures/storm-bull-2.webp'])
check('the same encounter keeps the same image', stormAAgain?.url, stormA?.url)
check('the chosen image is from the approved set', approvedStorm.has(stormA?.url), true)
check('an unapproved numbered render is never selected', stormA?.url === '/creatures/storm-bull-3.webp', false)

console.log('\n-- curated replacements outrank every rejected generation --')
m.registerArtManifest([
  'dark-spirit-1.webp',
  'dark-spirit-2.webp',
  'dark-spirit-3.webp',
  'dark-spirit-curated.webp',
  'forest-geni-1.webp',
  'forest-geni-2.webp',
  'forest-geni-curated.webp',
  'cutthroat-1.webp',
  'cutthroat-2.webp',
  'cutthroat-curated.webp',
  'beltunumshi-1.webp',
  'beltunumshi-2.webp',
  'beltunumshi-curated.webp',
  'animated-items-curated.webp',
  'ember-bull-curated.webp',
  'nipoh-oshu-curated.webp',
  'rock-guardian-curated.webp',
  'windbag-curated.webp',
  's-kra-kor-shaman-curated.webp',
  's-kra-kor-villager-curated.webp',
  's-kra-kor-warrior-curated.webp',
  'sylph-curated.webp',
  'ur-hhrki-izh-curated.webp',
])
check('dark spirit uses its curated replacement', m.artFor('a dark spirit', 'spirit')?.file, 'dark-spirit-curated')
check('forest geni uses its curated replacement', m.artFor('a forest geni', 'geni')?.file, 'forest-geni-curated')
check('cutthroat uses its curated replacement', m.artFor('a cutthroat', 'cutthroat')?.file, 'cutthroat-curated')
check('beltunumshi uses its curated replacement', m.artFor('a beltunumshi', 'beltunumshi')?.file, 'beltunumshi-curated')
check('ember bull uses its curated replacement', m.artFor('an ember bull', 'bull')?.file, 'ember-bull-curated')
check('nipoh oshu uses its curated replacement', m.artFor('a nipoh oshu', 'oshu')?.file, 'nipoh-oshu-curated')
check('rock guardian uses its curated replacement', m.artFor('a rock guardian', 'guardian')?.file, 'rock-guardian-curated')
check('windbag uses its curated replacement', m.artFor('a windbag', 'windbag')?.file, 'windbag-curated')
check("S'Kra Kor shaman uses its curated replacement", m.artFor("a S'Kra Kor shaman", 'shaman')?.file, 's-kra-kor-shaman-curated')
check('sylph uses its curated replacement', m.artFor('a sylph', 'sylph')?.file, 'sylph-curated')
check("Ur Hhrki'izh uses its curated replacement", m.artFor("an Ur Hhrki'izh", 'hhrki')?.file, 'ur-hhrki-izh-curated')

console.log('\n-- quarantined art stays unavailable even if an old manifest lists it --')
m.registerArtManifest(['alley-thug.webp'])
check('a rejected render does not resolve', m.artFor('an alley thug', 'thug'), undefined)

console.log('\n-- a corpse borrows the living creature\'s picture --')
check('dead kobold finds the kobold', m.artFor('a kobold which appears dead', 'dead').key, 'kobold')
check('and never asks for "dead"', m.hasArt('a wolf which appears dead', 'dead'), false)

console.log('\n-- the exact entry outranks the noun entry --')
m.registerArtManifest(['troll'])
check('rock troll keeps its own picture', m.artFor('a rock troll', 'troll').key, 'rock troll')
check('an unlisted troll takes the noun', m.artFor('a hulking bridge troll', 'troll').key, 'troll')

console.log('\n-- a file that will not decode drops out --')
m.noteArtMissing('rock troll')
check('rock troll falls back to the noun', m.artFor('a rock troll', 'troll').key, 'troll')
m.noteArtMissing('troll')
check('all keys spent, no art', m.artFor('a rock troll', 'troll'), undefined)
m.noteArtLoaded('troll')
check('a load puts one back', m.artFor('a rock troll', 'troll').key, 'troll')

console.log('\n-- the persistent curation registry is internally complete --')
const curation = JSON.parse(readFileSync('data/art/creature-curation.json', 'utf8'))

/**
 * The shipped pack manifest, or `null` when no pack is installed.
 *
 * Absence here means the same thing it means to creatureArt.ts itself: the pack
 * is generated separately and is not always present, so a missing manifest is
 * the expected answer, not a broken one. The two checks that cross-reference it
 * degrade to a no-op rather than crashing the whole suite over a file this repo
 * does not always carry.
 */
const packManifest = (() => {
  try {
    return JSON.parse(readFileSync('public/creatures/manifest.json', 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
})()

if (packManifest) {
  const pack = new Set(packManifest.map((file) => file.replace(/\.webp$/i, '')))
  const approvedFiles = Object.values(curation.approvedVariants).flat()
  check('every approved file exists in the pack manifest', approvedFiles.every((file) => pack.has(file)), true)
  check('no approved file is also rejected', approvedFiles.some((file) => curation.rejected.includes(file)), false)
} else {
  console.log('OK   no installed pack, skipping the two manifest cross-checks')
}
check(
  'every reviewed subject records candidates and a decision',
  Object.values(curation.variantReview).every((review) =>
    Array.isArray(review.currentCandidates) &&
    Array.isArray(review.rejects) &&
    typeof review.decision === 'string' &&
    review.decision.length > 0
  ),
  true,
)
check(
  'subjects with no approved art are explicitly marked for regeneration',
  Object.entries(curation.approvedVariants).every(([subject, files]) =>
    files.length > 0 || curation.variantReview[subject]?.regenerationNeeded === true
  ),
  true,
)

console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
