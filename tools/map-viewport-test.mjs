import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const dir = join('node_modules', '.drc-test')
mkdirSync(dir, { recursive: true })
const out = join(dir, 'useMapViewport.mjs')
writeFileSync(out, ts.transpileModule(readFileSync('src/lib/useMapViewport.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText)
const { clampMapPan } = await import(`${pathToFileURL(out).href}?v=${Date.now()}`)

let failures = 0
const check = (label, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${pass ? 'OK  ' : 'FAIL'} ${label}`, actual)
  if (!pass) failures++
}

const viewport = { width: 900, height: 600 }
const fitted = { width: 900, height: 600 }
check('a fitted map cannot be dragged away', clampMapPan({ x: -500, y: 320 }, viewport, fitted, 1), { x: 0, y: 0 })
check('a zoomed map stops at its far edges', clampMapPan({ x: -2000, y: -2000 }, viewport, fitted, 2), { x: -900, y: -600 })
check('a zoomed map stops at its near edges', clampMapPan({ x: 300, y: 200 }, viewport, fitted, 2), { x: 0, y: 0 })
check('a zoomed map can pan inside its bounds', clampMapPan({ x: -300, y: -220 }, viewport, fitted, 2), { x: -300, y: -220 })
check('a zoomed-out map stays centered', clampMapPan({ x: -400, y: 200 }, viewport, fitted, 0.5), { x: 225, y: 150 })
check('a naturally small map stays centered', clampMapPan({ x: 0, y: 0 }, viewport, { width: 300, height: 200 }, 1), { x: 300, y: 200 })

if (failures) process.exit(1)
console.log('\nall map viewport checks passed')
