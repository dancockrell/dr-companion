import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

let pass = 0
let fail = 0
function ok(label, condition) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`)
  condition ? pass++ : fail++
}

let registry = ['map']
let rejectRegistry = false
let rejectAction = null
let lifecycle = null
globalThis.__panelInvoke = async (command) => {
  if (command === 'panel_windows') {
    if (rejectRegistry) throw new Error('temporary IPC failure')
    return registry
  }
  if (command === rejectAction) throw new Error('window manager refused')
}
globalThis.__panelListen = (_event, handler) => {
  lifecycle = handler
  return () => {}
}

const dir = mkdtempSync(join(tmpdir(), 'panel-window-lifecycle-'))
const output = join(dir, 'panelWindows.mjs')
writeFileSync(join(dir, 'asyncState.mjs'), ts.transpileModule(readFileSync('src/lib/asyncState.ts', 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    // Deterministic output: every relative specifier comes out `.js` whatever
    // the source wrote. The string patches below are stubbing work and can
    // only stay correct if what they match does not follow src/'s import
    // style. It used to, and C14 changing that style broke six suites at once.
    rewriteRelativeImportExtensions: true,
  },
}).outputText)
let source = ts.transpileModule(readFileSync('src/lib/panelWindows.ts', 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    // Deterministic output: every relative specifier comes out `.js` whatever
    // the source wrote. The string patches below are stubbing work and can
    // only stay correct if what they match does not follow src/'s import
    // style. It used to, and C14 changing that style broke six suites at once.
    rewriteRelativeImportExtensions: true,
  },
}).outputText
source = source
  .replace('./asyncState.js', './asyncState.mjs')
  .replace("import { useSyncExternalStore } from 'react';", 'const useSyncExternalStore = () => {};')
  .replace('import { invokeTauri, isTauri, listenTauri } from "./tauri.js";', 'const invokeTauri = globalThis.__panelInvoke; const isTauri = () => true; const listenTauri = globalThis.__panelListen;')
writeFileSync(output, source)
const store = await import(pathToFileURL(output))
const off = store.subscribePanelWindows(() => {})
await new Promise((resolve) => setTimeout(resolve, 0))
ok('initial reconciliation records the authoritative open map', store.getPanelWindowsSnapshot().open.includes('map'))

rejectRegistry = true
await store.refreshPanelWindows()
ok('registry failure retains the last known open windows', store.getPanelWindowsSnapshot().open.includes('map'))
ok('registry failure is visible instead of translated to empty', Boolean(store.getPanelWindowsSnapshot().registryError))
rejectRegistry = false

rejectAction = 'open_panel_window'
await store.openPanelWindow('inventory', 'Inventory')
ok('open failure is visible and retryable', store.getPanelWindowsSnapshot().errors.inventory?.includes('Could not open'))
ok('failed open does not hide or duplicate known open panels', store.getPanelWindowsSnapshot().open.length === 1)

rejectAction = 'close_panel_window'
await store.closePanelWindow('map')
ok('close failure is visible and keeps the live panel popped out', store.getPanelWindowsSnapshot().errors.map?.includes('Could not close') && store.getPanelWindowsSnapshot().open.includes('map'))

rejectAction = null
registry = []
lifecycle({ id: 'map', state: 'closed' })
await new Promise((resolve) => setTimeout(resolve, 0))
ok('manual native close reconciles without polling', !store.getPanelWindowsSnapshot().open.includes('map'))

registry = ['map']
lifecycle({ id: 'map', state: 'closed' })
await new Promise((resolve) => setTimeout(resolve, 0))
ok('a stale close event cannot hide a rapidly reopened authoritative window', store.getPanelWindowsSnapshot().open.includes('map'))
off()

const rust = readFileSync('src-tauri/src/lib.rs', 'utf8')
ok('native open, closing, and destroyed paths emit lifecycle events', ['"open"', '"closing"', '"closed"', 'WindowEvent::Destroyed'].every((needle) => rust.includes(needle)))
const dashboard = readFileSync('src/components/dashboard/Dashboard.tsx', 'utf8')
const mapPanel = readFileSync('src/components/shared/MapPanel.tsx', 'utf8')
ok('map pop-out uses an in-app window icon rather than an external-link icon',
  /<AppWindow aria-hidden="true"/.test(mapPanel) &&
  !/ExternalLink/.test(mapPanel))
ok('dashboard and map consume the same authoritative registry', [dashboard, mapPanel].every((source) => source.includes('usePanelWindows()')))
ok('the old two-second polling registry is gone', !`${dashboard}${mapPanel}`.includes('setInterval('))
ok('open and close errors have visible retry controls', dashboard.includes('windowErrors.map') && mapPanel.includes('windowFailure'))

console.log(fail === 0 ? '\nall passed' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
