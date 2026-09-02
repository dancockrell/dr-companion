import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const fail = (message) => { console.error(`FAIL ${message}`); process.exitCode = 1 }
const pass = (message) => console.log(`OK   ${message}`)
const outputPath = 'data/world/out/crossing-primitive-registry.json'

execFileSync(process.execPath, ['tools/build-crossing-primitive-registry.mjs'], { stdio: 'inherit' })
if (!existsSync(outputPath)) fail('the primitive registry is generated')
else {
  const registry = JSON.parse(readFileSync(outputPath, 'utf8'))
  const tree = registry.assets.find((asset) => asset.id === 'T01')
  const path = registry.assets.find((asset) => asset.id === 'P01')
  if (registry.counts.total === 114) pass('all 104 base assets and 10 special sets have machine-readable cards')
  else fail(`expected 114 kit records, got ${registry.counts.total}`)
  if (registry.assets.every((asset) => asset.brief.length > 120 && asset.source.path.endsWith('CROSSING_GEOMETRIC_KIT.md'))) pass('each runtime card retains its complete authored brief and source')
  else fail('a primitive card lost its brief or source provenance')
  if (tree?.admission.status === 'candidate' && tree.admission.candidateCreationId === 'lJ6TMVtgv9' && !tree.admission.runtimePath) pass('the first Magnific GLB is quarantined as a review-required candidate')
  else fail('the first Magnific candidate is missing or incorrectly admitted')
  if (path?.admission.status === 'candidate' && path.admission.candidateCreationId === 'TdmKs4fVNR' && path.admission.sourceImageCreationId === 'rgynM6Cxtc' && !path.admission.runtimePath) pass('the first route GLB retains provenance without being prematurely shipped')
  else fail('the first route candidate is missing or incorrectly admitted')
  if (registry.assets.filter((asset) => asset.admission.status === 'approved').every((asset) => asset.admission.runtimePath)) pass('every approved asset has a packaged runtime path')
  else fail('an approved asset lacks a packaged runtime path')
  if ([tree, path].every((asset) => asset?.admission.origin?.kind === 'owned-generation' && asset.admission.origin.provider === 'Magnific')) pass('generated candidates retain provider and license provenance')
  else fail('a generated candidate lacks provenance')
}
