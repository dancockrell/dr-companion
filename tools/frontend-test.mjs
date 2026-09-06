import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const dir = mkdtempSync(join(tmpdir(), 'fe-'))
const out = join(dir, 'frontends.mjs')
writeFileSync(out, ts.transpileModule(readFileSync('src/lib/frontends.ts','utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText)
const m = await import(pathToFileURL(out).href)

let checked = 0
let fails = 0
const cases = [
  ['genie', ',companion_bridge'],
  ['wrayth', ';companion_bridge'],
  ['frostbite', ';companion_bridge'],
  ['saga', ';companion_bridge'],
  ['other', ';companion_bridge'],
  [null, ';companion_bridge'],
]
for (const [fe, want] of cases) {
  const got = m.bridgeCommand(fe)
  const ok = got === want
  checked++
  if (!ok) fails++
  console.log(`${ok?'OK  ':'FAIL'} ${String(fe).padEnd(10)} -> ${got}`)
}
const stop = m.bridgeCommand('genie','stop')
const ok2 = stop === ',companion_bridge stop'
checked++
if (!ok2) fails++
console.log(`${ok2?'OK  ':'FAIL'} genie w/ arg -> ${stop}`)

const guess = m.frontendFromPath('C:\Genie4\Genie.exe')
const ok3 = guess === 'genie'
checked++
if (!ok3) fails++
console.log(`${ok3?'OK  ':'FAIL'} detect from path -> ${guess}`)

console.log('')
// Far below the real count on purpose: a tripwire for a truncated or
// half-loaded run, not a regression test on the number of cases.
const MIN_EXPECTED = 5
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
