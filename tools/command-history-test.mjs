import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const dir = mkdtempSync(join(tmpdir(), 'command-history-'))
const out = join(dir, 'command-history.mjs')
writeFileSync(
  out,
  ts.transpileModule(readFileSync('src/lib/commandHistory.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
)
const m = await import(pathToFileURL(out).href)

let checked = 0
let failed = 0
const check = (name, got, want) => {
  checked++
  const pass = JSON.stringify(got) === JSON.stringify(want)
  if (!pass) failed++
  console.log(`${pass ? 'OK  ' : 'FAIL'} ${name}${pass ? '' : ` got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

const history = ['look', 'health', 'appraise sword']
let cursor = m.freshCommandHistoryCursor()
let view = m.historyPrevious(history, cursor, 'cast refresh 12')
check('Up preserves the current unsent draft', view, {
  at: 2,
  draft: 'cast refresh 12',
  command: 'appraise sword',
})
cursor = { at: view.at, draft: view.draft }
view = m.historyPrevious(history, cursor, view.command)
check('a second Up walks backward', view.command, 'health')
cursor = { at: view.at, draft: view.draft }
view = m.historyNext(history, cursor, view.command)
check('Down walks toward the newest entry', view.command, 'appraise sword')
cursor = { at: view.at, draft: view.draft }
view = m.historyNext(history, cursor, view.command)
check('Down past newest restores the exact draft', view, {
  at: -1,
  draft: '',
  command: 'cast refresh 12',
})

check(
  'empty history leaves the draft untouched',
  m.historyPrevious([], m.freshCommandHistoryCursor(), 'look carefully'),
  { at: -1, draft: '', command: 'look carefully' }
)

console.log('')
// Far below the real count on purpose: a tripwire for a truncated or
// half-loaded run, not a regression test on the number of cases.
const MIN_EXPECTED = 3
if (checked < MIN_EXPECTED) {
  console.error(`FAILED: only ${checked} checks ran, expected at least ${MIN_EXPECTED}`)
  process.exit(1)
}
// `checked`, not a pass count: the denominator has to be the number of
// checks that ran, or it shrinks by one per failure and reports a smaller
// suite on exactly the run where you need to know the size did not change.
console.log(`${checked} checked, ${failed} failed`)
if (failed) {
  console.error('FAILED')
  process.exit(1)
}
console.log('all passed')
process.exit(0)
