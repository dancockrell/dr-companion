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

let failed = 0
const check = (name, got, want) => {
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

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
