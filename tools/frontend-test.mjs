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

// --- The identity Lich gives *itself* when this app starts it -------------
//
// A different question from every case above, which are about which client the
// player runs. Since Lane N the app starts Lich with `--headless=<port>` and
// Lich resolves its own identity to `profanity`
// (`login_helpers.rb:578-584`), measured on 6 Sep 2026 by executing Lich's own
// resolver - see docs/verification/lich-native-stream-2026-09-06.md.
const ok4 = m.APP_LAUNCH_IDENTITY === 'profanity'
checked++
if (!ok4) fails++
console.log(`${ok4?'OK  ':'FAIL'} app launch identity -> ${m.APP_LAUNCH_IDENTITY}`)

// The prefix has to follow from the identity rather than be asserted beside
// it, or the two drift and the app tells a player to type the wrong thing.
const ok5 = m.APP_LAUNCH_PREFIX === m.prefixFor(m.APP_LAUNCH_IDENTITY)
checked++
if (!ok5) fails++
console.log(`${ok5?'OK  ':'FAIL'} app launch prefix follows the identity -> ${m.APP_LAUNCH_PREFIX}`)

// And the reason it matters, asserted where the wrong answer is available: our
// identity must not be the one frontend whose prefix is a comma. Without this,
// both checks above would still pass if APP_LAUNCH_IDENTITY became 'genie' and
// APP_LAUNCH_PREFIX became ',' together.
const ok6 = m.prefixFor(m.APP_LAUNCH_IDENTITY) === ';' && m.prefixFor('genie') === ','
checked++
if (!ok6) fails++
console.log(`${ok6?'OK  ':'FAIL'} the comma is genie's alone, and is not ours`)

// Lich's argument parser accepts a fixed set of frontend flags, and this file
// twice claimed one that does not exist (`--wrayth`, `--profanity`). Anything
// non-null must be a flag `determine_frontend` (argv_options.rb:385-399) or
// `resolve_headless_frontend` (login_helpers.rb:578-584) actually matches.
const REAL_LICH_FLAGS = new Set([
  '-s', '--stormfront', '-w', '--wizard', '--avalon', '--frostbite', '--saga', '--genie',
])
for (const f of m.FRONTENDS) {
  if (f.lichFlag === null) continue
  const okf = REAL_LICH_FLAGS.has(f.lichFlag)
  checked++
  if (!okf) fails++
  console.log(`${okf?'OK  ':'FAIL'} ${f.id.padEnd(10)} lichFlag ${f.lichFlag} is a flag Lich parses`)
}
// The positive control for that loop: a flag Lich does not parse has to be
// rejected by the same set, or a green run above only means the set contains
// everything.
const ok7 = !REAL_LICH_FLAGS.has('--profanity') && !REAL_LICH_FLAGS.has('--wrayth')
checked++
if (!ok7) fails++
console.log(`${ok7?'OK  ':'FAIL'} --profanity and --wrayth are still not Lich flags`)

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
