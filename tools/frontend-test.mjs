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
  if (!ok) fails++
  console.log(`${ok?'OK  ':'FAIL'} ${String(fe).padEnd(10)} -> ${got}`)
}
const stop = m.bridgeCommand('genie','stop')
const ok2 = stop === ',companion_bridge stop'
if (!ok2) fails++
console.log(`${ok2?'OK  ':'FAIL'} genie w/ arg -> ${stop}`)

const guess = m.frontendFromPath('C:\Genie4\Genie.exe')
const ok3 = guess === 'genie'
if (!ok3) fails++
console.log(`${ok3?'OK  ':'FAIL'} detect from path -> ${guess}`)

console.log(fails===0 ? '\nall passed' : `\n${fails} FAILED`)
process.exit(fails===0?0:1)
