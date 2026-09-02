import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'

const ledger = JSON.parse(readFileSync('data/art/map-stamps/curation.json', 'utf8'))
const layer = readFileSync('src/components/shared/MapStampLayer.tsx', 'utf8')
let failures = 0

function check(label, value, detail = '') {
  console.log(`${value ? 'OK  ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`)
  if (!value) failures++
}

check('curation ledger has a version', ledger.schemaVersion === 1)
check('selection policy is deterministic', /stable seeded/i.test(ledger.selection))
check('approved and rejected entries exist', ledger.approved.length > 0 && ledger.rejected.length > 0)

for (const item of ledger.approved) {
  const bytes = existsSync(item.path) ? readFileSync(item.path) : Buffer.alloc(0)
  check(`${item.path} exists`, bytes.length > 0)
  check(`${item.path} is a PNG`, bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a')
  check(`${item.path} retains alpha`, [4, 6].includes(bytes[25]))
  check(`${item.path} passed all three review scales`, ['full-resolution', 'parchment-composite', 'runtime-crop'].every((review) => item.reviews.includes(review)))
  const hash = createHash('sha256').update(bytes).digest('hex')
  check(`${item.path} matches its reviewed hash`, hash === item.sha256, hash.slice(0, 12))
  check(`${item.path} is referenced at runtime`, layer.includes(`/${item.path.replace('public/', '')}`))
  check(`${item.path} is not a placeholder`, statSync(item.path).size > 100_000)
}

const runtimeCatalog = layer.slice(layer.indexOf('const STAMP_ART'), layer.indexOf('/**\n * Pictorial cartography'))
for (const item of ledger.rejected) {
  check(`${item.path} records a concrete rejection`, item.reason.length >= 20)
  check(`${item.path} cannot be selected at runtime`, !runtimeCatalog.includes(`/${item.path.replace('public/', '')}`))
}

const batch = JSON.parse(readFileSync('data/art/map-stamps/batches/market-plaza-01.json', 'utf8'))
check('the first reel has one explicit camera idea', batch.magnific.motionPattern.includes('70-degree orbit'))
check('the execution prompt excludes project bookkeeping', !/DR Companion|filename|reviewer|runtime/i.test(batch.prompt))
check('raw, candidates, approved and runtime layers are separate', new Set(Object.values(batch.paths)).size === 4)
check('the unexecuted reel is an honest reusable template', batch.status === 'ready-template' && !('creationIdentifier' in batch.magnific) && !('actualCredits' in batch.magnific))
check('harvester requirements are explicit', ['python', 'Pillow', 'NumPy', 'ffmpeg', 'ffprobe'].every((dependency) => batch.harvest.requires.includes(dependency)))

if (failures) {
  console.error(`\n${failures} map-stamp curation check(s) failed`)
  process.exit(1)
}
console.log('\nall map-stamp curation checks passed')
