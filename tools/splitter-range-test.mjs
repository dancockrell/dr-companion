import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const dir = mkdtempSync(join(tmpdir(), 'splitter-range-'))
const out = join(dir, 'splitter-range.mjs')
writeFileSync(out, ts.transpileModule(readFileSync('src/lib/splitterRange.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText)
const m = await import(pathToFileURL(out).href)

let failed = 0
const check = (name, got, want) => {
  const pass = JSON.stringify(got) === JSON.stringify(want)
  if (!pass) failed++
  console.log(`${pass ? 'OK  ' : 'FAIL'} ${name}${pass ? '' : ` got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

check('normal bounds remain ordered', m.splitterRange(0.2, 0.8), { min: 0.2, max: 0.8 })
check('equal bounds remain a stable point', m.splitterRange(0.5, 0.5), { min: 0.5, max: 0.5 })
check('reversed bounds cannot create an impossible range', m.splitterRange(0.7, 0.3), { min: 0.3, max: 0.7 })
check('values clamp to the normalized minimum', m.clampSplitterValue(-2, { min: 0.3, max: 0.7 }), 0.3)
check('values clamp to the normalized maximum', m.clampSplitterValue(2, { min: 0.3, max: 0.7 }), 0.7)

const splitterSource = readFileSync('src/components/layout/Splitter.tsx', 'utf8')
const appSource = readFileSync('src/App.tsx', 'utf8')
const labels = [...appSource.matchAll(/<Splitter[\s\S]*?label="([^"]+)"/g)].map((match) => match[1])
check(
  'separator exposes its complete range and value text',
  /aria-valuemin/.test(splitterSource) && /aria-valuemax/.test(splitterSource) && /aria-valuetext/.test(splitterSource),
  true
)
check('every app separator has a distinct contextual name', [labels.length, new Set(labels).size], [3, 3])
check(
  'keyboard contract handles both limits without page scrolling',
  /'Home', 'End'/.test(splitterSource) && /e\.preventDefault\(\)/.test(splitterSource),
  true
)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
