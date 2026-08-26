/**
 * Reading a LOOK.
 *
 * The cases are real player descriptions mined from Elanthipedia, not
 * invented ones, because the whole value of this parser is that it handles
 * what players actually write rather than what a schema would prefer.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const dir = mkdtempSync(join(tmpdir(), 'look-'))
const out = join(dir, 'lookMatch.js')
writeFileSync(
  out,
  ts.transpileModule(readFileSync('src/lib/lookMatch.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
)
const m = await import(pathToFileURL(out).href)

let fails = 0
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label.padEnd(44)} ${JSON.stringify(got)}`)
}

const AETHERIE =
  "You see High Priest Aetherie Daan'sawil, Reborn in Flames, an Elothean. " +
  'Aetherie has an angular face with frown lines around his mouth and tilted ' +
  'almond-shaped red eyes. His grey hair is short and wavy, and is worn tangled. ' +
  'He has fair skin and a lean build.'

console.log('-- a real Elothean description --')
const a = m.parseLook(AETHERIE)
check('race', a.race, 'Elothean')
check('sex', a.sex, 'male')
check('eye colour', a.eyeColour, 'red')
// The pair is the Elothean marker; either half alone loses it.
check('eye shape keeps both words', a.eyeShape, 'tilted almond-shaped')
check('hair colour', a.hairColour, 'grey')
check('skin', a.skin, 'fair')
check('build', a.build, 'lean')

console.log('\n-- a female Prydaen --')
const b = m.parseLook(
  'You see Kithra, a Prydaen. She has a feline face and slitted green eyes. ' +
    'Her black hair is long and straight. She has dark fur and a slender build.'
)
check('race', b.race, 'Prydaen')
check('sex', b.sex, 'female')
check('eye colour', b.eyeColour, 'green')

console.log('\n-- race is decisive, not advisory --')
const portraits = [
  { key: 'Elothean male', race: 'Elothean', sex: 'male', hairColour: 'grey', build: 'lean' },
  { key: 'Elothean female', race: 'Elothean', sex: 'female' },
  { key: 'Human male', race: 'Human', sex: 'male', hairColour: 'grey', build: 'lean' },
]
const ranked = m.suggestPortraits(AETHERIE, portraits)
check('wrong race is excluded entirely', ranked.some((r) => r.portrait.race === 'Human'), false)
check('best is the right race and sex', ranked[0].portrait.key, 'Elothean male')
check('same race, wrong sex still offered', ranked.length, 2)

console.log('\n-- an unparseable description suggests rather than throws --')
const messy = m.suggestPortraits('You see a shadowy figure.', portraits)
check('everything stays on offer', messy.length, 3)

console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
