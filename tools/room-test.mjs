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
const compile = (src, name) => {
  const out = join(dir, name)
  writeFileSync(
    out,
    ts
      .transpileModule(readFileSync(src, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      })
      .outputText.replace(/from '(\.\/[^']+)'/g, (_, r) => `from '${r}.js'`)
  )
  return out
}
compile('src/lib/cards.ts', 'cards.js')
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

console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
