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
    .outputText.replace(/from '(\.\/[^']+)'/g, (_, r) => `from '${r}.js'`)
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
check('spaces are encoded', m.artUrl('rock troll'), '/creatures/rock%20troll.webp')
check('apostrophes survive', m.artUrl("adan'f blood warrior"), "/creatures/adan'f%20blood%20warrior.webp")

console.log('\n-- with no manifest, a card is willing to find out --')
m.resetArtCache()
const first = m.artFor('a snarling goblin', 'goblin')
check('tries the exact name first', first.key, 'snarling goblin')
check('but does not claim it exists', first.confirmed, false)
check('and hasArt says so', m.hasArt('a snarling goblin', 'goblin'), false)

console.log('\n-- a failed load falls through rather than giving up --')
m.noteArtMissing('snarling goblin')
check('next attempt is the noun', m.artFor('a snarling goblin', 'goblin').key, 'goblin')
m.noteArtMissing('goblin')
check('all keys spent, no art', m.artFor('a snarling goblin', 'goblin'), undefined)

console.log('\n-- a proven key beats an untried one above it --')
m.resetArtCache()
m.noteArtLoaded('goblin')
const proven = m.artFor('a snarling goblin', 'goblin')
check('the loaded noun wins', proven.key, 'goblin')
check('and is confirmed', proven.confirmed, true)
check('hasArt agrees', m.hasArt('a snarling goblin', 'goblin'), true)

console.log('\n-- a manifest closes the world --')
m.resetArtCache()
m.registerArtManifest(['kobold'])
check('a listed creature resolves', m.artFor('the kobold', 'kobold').key, 'kobold')
check('confirmed without loading', m.artFor('the kobold', 'kobold').confirmed, true)
check('an unlisted one is never requested', m.artFor('a snarling goblin', 'goblin'), undefined)
check('a listed corpse still resolves', m.artFor('a kobold which appears dead', 'dead').key, 'kobold')

console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
