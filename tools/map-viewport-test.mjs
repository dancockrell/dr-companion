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
const hookSource = readFileSync('src/lib/useMapViewport.ts', 'utf8')
const panelSource = readFileSync('src/components/shared/MapPanel.tsx', 'utf8')

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
check('fit is an atomic viewport operation', /const fitView = useCallback/.test(hookSource) && /bounded\(\{ x: 0, y: 0 \}, nextZoom\)/.test(hookSource), true)
check('resize bursts coalesce into one animation-frame viewport write', /let frame: number \| null = null/.test(hookSource) && /frame = requestAnimationFrame/.test(hookSource) && /if \(frame !== null\) return/.test(hookSource), true)
check('unmount cancels a queued resize viewport write', /observer\.disconnect\(\)[\s\S]*cancelAnimationFrame\(frame\)/.test(hookSource), true)
check('the docked fit button uses the atomic viewport operation', /onClick=\{\(\) => fitView\(\)\}/.test(panelSource), true)
check('room changes have one reset path, not duplicate effects', (panelSource.match(/A room update must update the view/g) || []).length, 1)
check('the chart owns the full docked viewport', /h-full min-h-0 min-w-0 w-full flex-1/.test(panelSource), true)
check('no empty priority slot steals the rest of the map width', !/Reserved for a priority panel/.test(panelSource) && !/aspectRatio:/.test(panelSource), true)

if (failures) process.exit(1)
console.log('\nall map viewport checks passed')
