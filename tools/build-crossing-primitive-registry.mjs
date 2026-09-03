import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const sourcePath = 'docs/CROSSING_GEOMETRIC_KIT.md'
const ledgerPath = 'data/world/crossing-primitive-asset-ledger.json'
const outputDir = 'data/world/out'
const outputPath = join(outputDir, 'crossing-primitive-registry.json')
const source = readFileSync(sourcePath, 'utf8')
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))

for (const [id, reference] of Object.entries(ledger.scenePlates ?? {})) {
  if (reference.status !== 'art-direction-reference') {
    throw new Error(`${id} must be an art-direction-reference, not a runtime asset admission`)
  }
  if (reference.runtimeUse !== 'reference-only' || reference.notRuntimeGeometry !== true) {
    throw new Error(`${id} must explicitly prohibit direct runtime geometry use`)
  }
}

const familyFor = (id) => ({
  G: 'terrain-water', P: 'route', H: 'boundary', T: 'foliage',
  B: 'facade-civic', E: 'exit-anchor', R: 'prop', S: 'special-set',
})[id[0]] ?? 'unknown'

const parseCard = (line, lineNumber) => {
  const cells = line.split('|').slice(1, -1).map((cell) => cell.trim())
  const match = cells[0]?.match(/^([A-Z]\d{2})(?:\s+(.*))?$/)
  if (!match || !cells[1]) return null
  const [, id, suffix = ''] = match
  const special = id.startsWith('S')
  return {
    id,
    displayName: suffix || id,
    family: familyFor(id),
    brief: cells[1],
    footprint: special ? null : cells[2] ?? null,
    source: { path: sourcePath, line: lineNumber },
    requiredRuntimePath: `godot/assets/primitives/${id.toLowerCase()}.glb`,
  }
}

const catalogue = source.split('\n')
  .map((line, index) => parseCard(line, index + 1))
  .filter(Boolean)
  .filter((asset) => asset.id.match(/^[GPHTBERS]\d{2}$/))

const ids = new Set()
for (const asset of catalogue) {
  if (ids.has(asset.id)) throw new Error(`Duplicate primitive asset card ${asset.id}`)
  ids.add(asset.id)
}

const assets = catalogue.map((asset) => {
  const admission = ledger.assets[asset.id] ?? { status: 'planned', runtimePath: null }
  if (!['planned', 'candidate', 'approved', 'rejected'].includes(admission.status)) {
    throw new Error(`${asset.id} has unsupported admission status ${admission.status}`)
  }
  if (admission.status === 'approved' && !admission.runtimePath) {
    throw new Error(`${asset.id} is approved without a packaged runtimePath`)
  }
  if (admission.status === 'approved' && !admission.origin) {
    throw new Error(`${asset.id} is approved without license/provenance origin data`)
  }
  if (admission.origin?.kind === 'licensed-store' && (!admission.origin.provider || !admission.origin.licenseReference)) {
    throw new Error(`${asset.id} is a store asset without provider and licenseReference`)
  }
  return {
    ...asset,
    admission: {
      status: admission.status,
      runtimePath: admission.runtimePath ?? null,
      candidateCreationId: admission.creationId ?? null,
      sourceImageCreationId: admission.sourceImageCreationId ?? ledger.sourceReferences?.[asset.id]?.creationId ?? null,
      sourceReference: ledger.sourceReferences?.[asset.id] ?? null,
      origin: admission.origin ?? null,
      reviewRequired: admission.reviewRequired ?? [],
    },
  }
})

for (const id of Object.keys(ledger.assets)) {
  if (!ids.has(id)) throw new Error(`Ledger contains unknown kit asset ${id}`)
}

const output = {
  schemaVersion: 1,
  generatedFrom: { sourcePath, ledgerPath },
  admissionRule: 'Only an approved asset with a packaged runtimePath may be loaded by a production viewer.',
  artDirectionRule: 'Scene prompt references guide mesh assembly but never become direct runtime geometry.',
  counts: {
    total: assets.length,
    planned: assets.filter((asset) => asset.admission.status === 'planned').length,
    candidate: assets.filter((asset) => asset.admission.status === 'candidate').length,
    approved: assets.filter((asset) => asset.admission.status === 'approved').length,
    rejected: assets.filter((asset) => asset.admission.status === 'rejected').length,
  },
  assets,
}

mkdirSync(outputDir, { recursive: true })
writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n')
console.log(`wrote Crossing primitive registry: ${output.counts.total} assets (${output.counts.candidate} candidate, ${output.counts.approved} approved)`)
