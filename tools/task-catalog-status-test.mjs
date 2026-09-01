import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

let pass = 0
let fail = 0
const ok = (label, condition) => {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`)
  condition ? pass++ : fail++
}
const python = (id) => ({ python: 'python', tasksDir: 'py', tasks: [{ id, title: id, summary: '', kind: '', category: 'Test' }], note: '' })
const node = (id) => ({ node: 'node', tasksDir: 'ts', tasks: [{ id, title: id, summary: '', kind: '' }], note: '' })
let impl = {
  python: () => Promise.reject(new Error('python unavailable')),
  node: () => Promise.resolve(node('ts.healthy')),
  scripts: () => Promise.resolve([{ name: 'healthy.lic', lang: 'ruby', path: '', bytes: 1, summary: '' }]),
  dirs: () => Promise.resolve({ pythonDir: null, typescriptDir: 'ts', rubyDir: 'ruby', note: '' }),
}
globalThis.__catalogPython = () => impl.python()
globalThis.__catalogNode = () => impl.node()
globalThis.__catalogScripts = () => impl.scripts()
globalThis.__catalogDirs = () => impl.dirs()

const dir = mkdtempSync(join(tmpdir(), 'task-catalog-status-'))
const output = join(dir, 'taskCatalogStatus.mjs')
writeFileSync(join(dir, 'asyncState.mjs'), ts.transpileModule(readFileSync('src/lib/asyncState.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText)
let source = ts.transpileModule(readFileSync('src/lib/taskCatalogStatus.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
source = source
  .replace("from './asyncState';", "from './asyncState.mjs';")
  .replace("import { useSyncExternalStore } from 'react';", 'const useSyncExternalStore = () => {};')
  .replace("import { nodeStatus } from './nodeTasks';", 'const nodeStatus = globalThis.__catalogNode;')
  .replace("import { pythonStatus } from './pythonTasks';", 'const pythonStatus = globalThis.__catalogPython;')
  .replace("import { listScripts, scriptDirs } from './scriptFiles';", 'const listScripts = globalThis.__catalogScripts; const scriptDirs = globalThis.__catalogDirs;')
writeFileSync(output, source)
const store = await import(pathToFileURL(output))
const off = store.subscribeTaskCatalogs(() => {})
await new Promise((resolve) => setTimeout(resolve, 0))
let state = store.getTaskCatalogSnapshot()
ok('one failed source is explicit', state.python.state === 'error' && state.python.error.includes('python unavailable'))
ok('a failed source does not hide a healthy sibling catalog', state.node.value?.tasks[0].id === 'ts.healthy')
ok('scripts and directories survive an unrelated runtime failure', state.scripts.value?.length === 1 && state.dirs.state === 'ready')

impl = {
  ...impl,
  python: () => Promise.resolve(python('py.recovered')),
  node: () => Promise.reject(new Error('node unavailable')),
  scripts: () => Promise.reject(new Error('scripts unavailable')),
}
await store.refreshTaskCatalogs()
state = store.getTaskCatalogSnapshot()
ok('retry recovers a failed source in-session', state.python.value?.tasks[0].id === 'py.recovered' && state.python.state === 'ready')
ok('multiple refresh failures remain independently identified as stale', state.node.state === 'stale' && state.scripts.state === 'stale')
ok('a newly failed source preserves its last healthy value', state.node.value?.tasks[0].id === 'ts.healthy')

let releaseOld
const old = new Promise((resolve) => { releaseOld = resolve })
impl = { ...impl, python: () => old }
const slow = store.refreshTaskCatalogs()
impl = { ...impl, python: () => Promise.resolve(python('py.newest')) }
await store.refreshTaskCatalogs()
releaseOld(python('py.stale'))
await slow
ok('a slower stale refresh cannot overwrite a newer generation', store.getTaskCatalogSnapshot().python.value?.tasks[0].id === 'py.newest')
off()

const panel = readFileSync('src/components/dashboard/TaskFlowPanel.tsx', 'utf8')
const palette = readFileSync('src/components/shared/CommandPalette.tsx', 'utf8')
const quick = readFileSync('src/components/layout/QuickSwitchBar.tsx', 'utf8')
ok('all three task-entry surfaces use the shared catalog store', [panel, palette, quick].every((text) => text.includes('useTaskCatalogs()')))
ok('quick switch distinguishes failed lookup from loading', quick.includes('Task lookup failed:') && quick.includes('Task details are loading'))
ok('all-or-nothing catalog Promise.all is gone', !panel.includes('Promise.all([\n      pythonStatus()') && !palette.includes('Promise.all([pythonStatus()'))

console.log(fail === 0 ? '\nall passed' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
