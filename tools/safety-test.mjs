/**
 * The art safety rules, tested.
 *
 * This exists because the rules have now failed in three distinct ways, none
 * of which threw an error:
 *
 *   1. The negative prompt was copied into three generators and none of them
 *      mentioned nudity, so the female portraits shipped topless.
 *   2. The negative prompt alone did not hold even once it did mention it. A
 *      fire maiden rendered bare-chested with "nude, topless, bare breasts"
 *      sitting in its own negative.
 *   3. Word boundaries written through a shell heredoc arrived as backspace
 *      characters. The regexes compiled, matched nothing, and the result
 *      looked like data being empty rather than a pattern being broken.
 *
 * All three were silent. That is what makes them worth a test: a failure here
 * is not a crash, it is a picture nobody wanted shipping in the default pack.
 */
import { readFileSync } from 'node:fs'
import { CLOTHED, CLOTHED_CREATURE, NEGATIVE, isHumanoid } from './art-safety.mjs'

let failed = 0
const ok = (name, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? `   ${detail}` : ''}`)
}

console.log('-- the clauses say what they must --')
for (const term of ['nude', 'nudity', 'naked', 'topless', 'bare breasts']) {
  ok(`negative covers "${term}"`, NEGATIVE.includes(term))
}
ok('CLOTHED states clothing positively', /fully clothed/.test(CLOTHED))
ok('CLOTHED_CREATURE states clothing positively', /fully clothed/.test(CLOTHED_CREATURE))

console.log('\n-- no control characters anywhere in the module --')
{
  // A backspace inside a pattern is invisible in every editor and in every
  // diff. Checking the bytes is the only way this gets caught.
  const raw = readFileSync(new URL('./art-safety.mjs', import.meta.url), 'utf8')
  const stray = [...raw].filter((c) => c.charCodeAt(0) < 32 && c !== '\n' && c !== '\r')
  ok('source is free of stray control characters', stray.length === 0, `found ${stray.length}`)
}

console.log('\n-- humanoids, which must be dressed --')
const HUMANOID = [
  ['Fire maiden', 'A fire maiden is a lithe, agile creature with ruddy skin and flowing red hair.'],
  ['Dryad priestess', 'A slender figure of bark and leaf.'],
  ["Adan'f spirit dancer", 'It wears a mask of woven reeds and wields a bone rattle.'],
  ['Cutthroat (1)', 'A rough sort, clad in dark leather.'],
  ['Sylph (1)', 'An airy figure.'],
  ['Nameless thing', 'The creature stands upright and wears a tattered robe.'],
]
for (const [name, lore] of HUMANOID) ok(`dressed: ${name}`, isHumanoid(name, lore))

console.log('\n-- animals, which must not be --')
const ANIMAL = [
  ['Adult razortusk sow', 'She roots through the undergrowth, tusks scarred from fighting.'],
  ['Giant wolf spider', 'Supported on multiple legs, the wolf spider is humanoid size.'],
  ['Large brown spider', 'Supported on multiple legs, the brown spider is humanoid size.'],
  ['Zombie boar', 'A rotting boar, its hide sloughing away.'],
  ['Giant thicket viper (1)', 'A thick serpent coiled in the brush.'],
  ['Hammerhead shark', 'It circles in the shallows.'],
]
for (const [name, lore] of ANIMAL) ok(`bare: ${name}`, !isHumanoid(name, lore))

console.log('\n-- the two traps that produced the animal cases --')
ok(
  '"humanoid size" is a scale, not a body plan',
  !isHumanoid('Some spider', 'the spider is humanoid size')
)
ok(
  'a pronoun alone does not dress a pig',
  !isHumanoid('Wild sow', 'She grazes in the field and she is aggressive.')
)
ok(
  'but an animal name yields to explicit lore',
  isHumanoid('Wolf-headed sentinel', 'It stands upright and wears banded mail.')
)

console.log('\n-- every shipped prompt carries the negative --')
{
  const files = ['data/art/portrait-prompts.json', 'data/art/creature-prompts.json']
  for (const f of files) {
    const all = Object.values(JSON.parse(readFileSync(f, 'utf8')))
    const missing = all.filter((e) => !String(e.negative ?? '').includes('nude'))
    ok(`${f}: all ${all.length} carry it`, missing.length === 0, `${missing.length} missing`)
  }
}

console.log('\n-- every humanoid prompt states clothing --')
{
  const creatures = JSON.parse(readFileSync('data/art/creature-prompts.json', 'utf8'))
  const wrong = Object.entries(creatures).filter(
    ([n, v]) => isHumanoid(n, v.lore) && !/fully clothed/.test(v.prompt)
  )
  ok('no humanoid creature is left undressed', wrong.length === 0, wrong.slice(0, 3).map(([n]) => n).join(', '))

  const portraits = Object.values(JSON.parse(readFileSync('data/art/portrait-prompts.json', 'utf8')))
  ok(
    'every portrait states clothing',
    portraits.every((p) => /fully clothed/.test(p.prompt)),
    `${portraits.length} checked`
  )
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
