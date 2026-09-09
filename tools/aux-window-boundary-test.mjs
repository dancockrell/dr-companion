import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const dir = join('node_modules', '.drc-test')
mkdirSync(dir, { recursive: true })
const out = join(dir, 'AuxiliaryWindowBoundary.mjs')
writeFileSync(out, ts.transpileModule(readFileSync('src/components/shared/AuxiliaryWindowBoundary.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText)

const { AuxiliaryWindowBoundary } = await import(pathToFileURL(out).href)
let failed = 0
let checked = 0
const ok = (label, condition) => {
  checked++
  if (!condition) failed++
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`)
}

function textOf(node) {
  if (typeof node === 'string') return node
  if (!node?.props) return ''
  const children = Array.isArray(node.props.children) ? node.props.children : [node.props.children]
  return children.map(textOf).join(' ')
}

// 'Map window' was the second label until the map was deleted
// (docs/NO-3D.md). Two labels rather than one on purpose: the boundary has
// to put the *given* name in its copy, and one label cannot tell that from
// a hardcoded string.
for (const label of ['Inventory panel window', 'Stats panel window']) {
  let recorded = ''
  const boundary = new AuxiliaryWindowBoundary({ label, children: 'healthy content', onError: (error) => { recorded = error.message } })
  const error = new Error('deliberate renderer failure')
  boundary.state = { error, attempt: 0 }
  boundary.componentDidCatch(error, { componentStack: '\n at ThrowingFixture' })
  const copy = textOf(boundary.render())
  ok(`${label} identifies the failed auxiliary surface`, copy.includes(label))
  ok(`${label} exposes Retry`, copy.includes('Retry'))
  ok(`${label} exposes full-window reload`, copy.includes('Reload window'))
  ok(`${label} exposes a safe close action`, copy.includes('Close pop-out'))
  ok(`${label} records the caught error`, recorded === error.message)
}

const app = readFileSync('src/App.tsx', 'utf8')
const panelBoundary = readFileSync('src/components/shared/PanelBoundary.tsx', 'utf8')
const capability = JSON.parse(readFileSync('src-tauri/capabilities/default.json', 'utf8'))
const tauriWindowFactory = readFileSync('src-tauri/src/lib.rs', 'utf8')
ok('the popped-out panel root uses the auxiliary boundary', /AuxiliaryWindowBoundary[\s\S]*PanelWindow/.test(app))
/*
 * The map window's own boundary check stood here and would still have
 * passed after the window was deleted: `MapWindow` survives in a comment in
 * App.tsx explaining that it is gone, and the regex spans the whole file, so
 * it matched prose. Replaced with the property that is actually load-bearing
 * now - that no top-level window is returned outside a boundary, asserted by
 * counting rather than by naming one.
 */
const auxReturns = [...app.matchAll(/<(PanelWindow|MapWindow)\b/g)].map((m) => m[1])
ok(
  'no auxiliary window is rendered outside a boundary',
  auxReturns.length === 1 && auxReturns[0] === 'PanelWindow',
  `auxiliary windows rendered: ${auxReturns.join(', ') || 'none'}`
)
ok('docked surfaces retain their local retry boundary', panelBoundary.includes('this.setState({ error: null })'))
ok('native auxiliary windows use the panel- label namespace', /format!\("panel-\{id\}"\)/.test(tauriWindowFactory))
ok('the main window receives core permissions', capability.windows.includes('main'))
ok('every panel window receives core permissions', capability.windows.includes('panel-*'))
ok('the capability does not broaden access to every window', !capability.windows.includes('*'))
ok('enough recovery and capability behavior was checked', checked >= 17)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
