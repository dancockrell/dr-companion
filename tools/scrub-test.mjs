/**
 * Checks the bug-report scrubber against DragonRealms speech that must never
 * end up in a public issue.
 *
 *   node tools/scrub-test.mjs
 *
 * This exists because getting it wrong publishes somebody's private
 * conversation, and that is not a bug you can take back once an issue is
 * filed. Over-redacting costs a little context; under-redacting costs someone
 * their privacy, so the tests below are deliberately one-sided about which
 * failure matters.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

// Transpile with the compiler the project already depends on, rather than
// adding a tool for one test.
const dir = mkdtempSync(join(tmpdir(), 'scrub-'))
const out = join(dir, 'bugReport.mjs')
const { outputText } = ts.transpileModule(
  readFileSync('src/lib/bugReport.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }
)
writeFileSync(out, outputText)

const { scrub } = await import(pathToFileURL(out).href)

const MUST_REDACT = [
  ['You hear the faint thoughts of Someguy echo in your mind:', 'ESP thought'],
  ['Someguy thinks to you, "meet me at the gate"', 'ESP thought'],
  ['Someguy whispers, "the vault code is 1234"', 'whisper'],
  ['You whisper to Someguy, "coming"', 'whisper'],
  ['Someguy tells you, "want to group?"', 'tell'],
  ['You tell Someguy, "yes"', 'tell'],
  ['[General] Someguy says, "anyone selling?"', 'channel'],
  ['You say to Someguy, "hello"', 'directed speech'],
]

// Game mechanics text is the whole point of a report. Redacting it would make
// the feature useless while looking like it worked.
const MUST_KEEP = [
  'You put your sword in your backpack.',
  '...wait 3 seconds.',
  'Roundtime: 5 sec.',
  'You are still stunned.',
  'Sorry, you may only type ahead 1 command.',
  '[Crossing, Town Square Central]',
  'You see a rat here.',
]

let checked = 0
let fails = 0

console.log('-- private speech must be redacted --')
for (const [line, label] of MUST_REDACT) {
  const r = scrub([line])
  const ok = r.text.startsWith('[redacted') && r.removed.length > 0
  checked++
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label.padEnd(17)} ${line.slice(0, 50)}`)
}

console.log('')
console.log('-- game mechanics must survive --')
for (const line of MUST_KEEP) {
  const r = scrub([line])
  const ok = r.text === line
  checked++
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${line.slice(0, 56)}`)
}

console.log('')
console.log('-- player names, only when asked --')
const named = scrub(['Someguy swings a sword at you!'], {
  otherPlayers: ['Someguy'],
  redactNames: true,
})
const nameOk = !named.text.includes('Someguy') && named.text.includes('[player]')
checked++
if (!nameOk) fails++
console.log(`${nameOk ? 'OK  ' : 'FAIL'} on:  ${named.text}`)

const notNamed = scrub(['Someguy swings a sword at you!'], {
  otherPlayers: ['Someguy'],
  redactNames: false,
})
const offOk = notNamed.text.includes('Someguy')
checked++
if (!offOk) fails++
console.log(`${offOk ? 'OK  ' : 'FAIL'} off: ${notNamed.text}`)

console.log('')
// Far below the real count on purpose: a tripwire for a truncated or
// half-loaded run, not a regression test on the number of cases. This suite
// has no check helper - every case is an inline `if (!ok) fails++` - so the
// denominator had to be added case by case.
const MIN_EXPECTED = 11
if (checked < MIN_EXPECTED) {
  console.error(`FAILED: only ${checked} checks ran, expected at least ${MIN_EXPECTED}`)
  process.exit(1)
}
// `checked`, not a pass count: the denominator has to be the number of
// checks that ran, or it shrinks by one per failure and reports a smaller
// suite on exactly the run where you need to know the size did not change.
console.log(`${checked} checked, ${fails} failed`)
if (fails) {
  console.error('FAILED')
  process.exit(1)
}
console.log('all passed')
process.exit(0)
