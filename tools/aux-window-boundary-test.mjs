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

for (const label of ['Inventory panel window', 'Map window']) {
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
ok('the popped-out panel root uses the auxiliary boundary', /AuxiliaryWindowBoundary[\s\S]*PanelWindow/.test(app))
ok('the popped-out map root uses the auxiliary boundary', /AuxiliaryWindowBoundary[\s\S]*MapWindow/.test(app))
ok('docked surfaces retain their local retry boundary', panelBoundary.includes('this.setState({ error: null })'))
ok('enough recovery behavior was checked', checked >= 13)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
