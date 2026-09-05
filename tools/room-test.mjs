/**
 * Room to cards.
 *
 * The deck assignment is the one judgement here that can be wrong in a way
 * that costs the player something, so it is asserted directly: a hostile
 * rendered as allied is worse than showing no card at all.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const dir = mkdtempSync(join(tmpdir(), 'room-'))

/**
 * Transpile one module into the temp dir.
 *
 * Two fixes on the way out: tsc leaves the extension off relative imports and
 * Node ESM insists on it, and bestiary.ts imports JSON, which Node will only
 * take with an import attribute tsc does not emit. The JSON import is rewritten
 * to a plain read instead.
 *
 * A source file's own import can now *already* carry an explicit `.ts`
 * (allowImportingTsExtensions is on project-wide - see tsconfig.app.json -
 * and room.ts's own imports have started using it). `transpileModule`
 * compiles one file in isolation, with no project context to resolve or
 * strip that extension, so an already-explicit `./bestiary.ts` survived
 * verbatim into the output and the old blind `+ '.js'` produced
 * `./bestiary.ts.js` - a file this script never writes. Stripping a
 * trailing `.ts` before appending `.js` handles both cases the same way.
 */
const compile = (src, name) => {
  const out = join(dir, name)
  const js = ts
    .transpileModule(readFileSync(src, 'utf8'), {
      compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          // Let the compiler rewrite './x.ts' -> './x.js' rather than a regex
          // below. Six copies of that regex existed; one had learned about
          // explicit .ts extensions and five had not, so five suites broke the
          // day src/ adopted them (C14). tsc has owned this since 5.7.
          rewriteRelativeImportExtensions: true,
        },
    })
    .outputText
    .replace(
      // `bestiary.ts`'s own import now carries a trailing
      // `with { type: 'json' }` (Node ESM's own requirement for a JSON
      // import - see that file). Matching only through the closing quote
      // left that clause dangling after the replacement text, which is a
      // `with` statement outside strict mode's grammar, not a JSON import
      // attribute - a syntax error, not a silent miss.
      /import data from ['"][^'"]+bestiary\.json['"](\s*with\s*\{[^}]*\})?;?/,
      "import { readFileSync as _rf } from 'node:fs';\n" +
        "const data = JSON.parse(_rf('src/data/bestiary.json', 'utf8'));"
    )
  writeFileSync(out, js)
  return out
}

compile('src/lib/cards.ts', 'cards.js')
compile('src/lib/bestiary.ts', 'bestiary.js')
const m = await import(pathToFileURL(compile('src/lib/room.ts', 'room.js')).href)

let fails = 0
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label.padEnd(50)} ${JSON.stringify(got)}`)
}

console.log('-- the noun, for art and bestiary lookup --')
for (const [name, want] of [
  ['a snarling goblin', 'goblin'],
  ['an Adan\'f blood warrior', 'warrior'],
  ['the kobold', 'kobold'],
  ['some kobold bones', 'bones'],
  ['Kobold', 'kobold'],
]) {
  check(name, m.nounOf(name), want)
}

console.log('\n-- decks --')
const cards = m.fromRoom({
  roomCreatures: ['a snarling goblin', 'a kobold'],
  roomDeadCreatures: ['a dead rat'],
  roomAllies: ['a summoned wolf'],
  roomPlayers: ['Aetherie'],
  groupMembers: ['Aetherie', 'Rhaesa'],
})
const deck = (d) => cards.filter((c) => c.deck === d).map((c) => c.name)
check('hostile holds living and dead', deck('hostile'), [
  'a snarling goblin',
  'a kobold',
  'a dead rat',
])
check('allied holds the summon', deck('allied'), ['a summoned wolf'])
check('group member not in room still listed', deck('people'), ['Aetherie', 'Rhaesa'])

console.log('\n-- a grouped player is people, never allied --')
check('no player leaked into allied', deck('allied').includes('Rhaesa'), false)

console.log('\n-- corpses keep their status --')
check(
  'dead rat is dead',
  cards.find((c) => c.name === 'a dead rat').status,
  'dead'
)

console.log('\n-- nothing in, nothing out --')
check('null character', m.fromRoom(null), [])
check('empty room', m.fromRoom({}), [])


console.log('\n-- lore is attached, and never overclaims --')
const kobold = m.fromRoom({ roomCreatures: ['a kobold'] })[0]
check('kobold gets its level', kobold.lore?.level, 4)
check('exact match is not approximate', kobold.loreApproximate, false)

// A named troll the wiki knows resolves exactly, level and all.
const rock = m.fromRoom({ roomCreatures: ['a rock troll'] })[0]
check('rock troll is an exact entry', rock.lore?.level, 18)
check('so it is not approximate', rock.loreApproximate, false)

// A troll the wiki does not list falls back to the noun. Ten trolls with ten
// different levels agree only that they carry boxes, so that is all it may
// say. Taking one troll's level and presenting it as this one's is the
// failure this whole index shape exists to prevent.
const unknown = m.fromRoom({ roomCreatures: ['a hulking bridge troll'] })[0]
check('unlisted troll has no level', unknown.lore?.level, undefined)
check('but still knows it has boxes', unknown.lore?.hasBoxes, true)
check('and says the match was loose', unknown.loreApproximate, true)

console.log('\n-- people are never looked up --')
const person = m.fromRoom({ roomPlayers: ['Bear'] })[0]
check('a player called Bear is not a bear', person.lore, undefined)

console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
