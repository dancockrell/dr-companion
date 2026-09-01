import { existsSync, readFileSync } from 'node:fs'

const catalog = JSON.parse(readFileSync('data/art/scene-art-catalog.json', 'utf8'))
let failures = 0
const check = (condition, label) => {
  if (!condition) failures++
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`)
}

const runtime = catalog.assets.filter((asset) => asset.runtimeEligible)
const rejected = runtime.filter((asset) => asset.audit.verdict === 'rejected')
const pending = runtime.filter((asset) => asset.audit.status !== 'visually-reviewed')
const missing = runtime.filter((asset) => !existsSync(`public${asset.path}`))
const incompleteGenerated = runtime.filter((asset) => asset.provenance.provider === 'Magnific'
  && (!asset.provenance.model || !asset.provenance.prompt || !asset.replacementHistory.length))

check(catalog.schemaVersion === 1, 'catalog schema is recognized')
check(runtime.length > 0, 'catalog records runtime-selected scene assets')
check(rejected.length === 0, 'no rejected asset is runtime eligible')
check(pending.length === 0, 'every runtime-eligible asset is visually reviewed')
check(missing.length === 0, 'every runtime-eligible asset exists on disk')
check(incompleteGenerated.length === 0, 'generated runtime art has model, prompt, and replacement history')

if (rejected.length) console.error('Rejected runtime assets:', rejected.map((asset) => asset.path))
if (pending.length) console.error('Pending runtime assets:', pending.map((asset) => asset.path))
if (missing.length) console.error('Missing runtime assets:', missing.map((asset) => asset.path))
if (incompleteGenerated.length) console.error('Incomplete generated metadata:', incompleteGenerated.map((asset) => asset.path))
process.exit(failures ? 1 : 0)
