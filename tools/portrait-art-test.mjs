import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync('public/portraits/manifest.json', 'utf8'))
const ledger = JSON.parse(readFileSync('data/art/portrait-qa-ledger.json', 'utf8'))

let checked = 0
let failures = 0
const check = (label, condition) => {
  checked++
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`)
  if (!condition) failures++
}

function vp8Dimensions(bytes) {
  const marker = Buffer.from([0x9d, 0x01, 0x2a])
  const at = bytes.indexOf(marker)
  if (at < 0 || at + 7 > bytes.length) return null
  return { width: bytes.readUInt16LE(at + 3) & 0x3fff, height: bytes.readUInt16LE(at + 5) & 0x3fff }
}

for (const [key, record] of Object.entries(ledger.records)) {
  const portrait = readFileSync(record.file)
  check(`${key} remains a core installed portrait`, manifest.includes(`${key}.webp`))
  check(`${key} is a WebP container`, portrait.subarray(0, 4).toString() === 'RIFF' && portrait.subarray(8, 12).toString() === 'WEBP')
  check(`${key} dimensions match its reviewed canvas`, JSON.stringify(vp8Dimensions(portrait)) === JSON.stringify({ width: record.dimensions[0], height: record.dimensions[1] }))
  check(`${key} ledger hash describes the shipped pixels`, createHash('sha256').update(portrait).digest('hex').toUpperCase() === record.sha256)
  check(`${key} passed both runtime crop reviews`, record.pixelReviewed === true && record.cardCrop === 'pass' && record.radarCrop === 'pass')
  check(`${key} records lore evidence and approval`, record.loreReferences.length >= 2 && record.decision === 'approved' && record.reviewer)
}
const pairAssets = Object.values(ledger.contactSheetReview.pairReviews).flatMap((pair) => pair.assets).sort()
check('the contact-sheet review explicitly covers every core portrait', ledger.contactSheetReview.status === 'approved' && JSON.stringify(pairAssets) === JSON.stringify([...manifest].sort()))
check('every race pair records a reviewer decision and lore evidence', Object.values(ledger.contactSheetReview.pairReviews).every((pair) => pair.decision.startsWith('approved') && pair.loreReferences.length >= 2 && pair.notes))

console.log('')
// Far below the real count on purpose: a tripwire for a truncated or
// half-loaded run, not a regression test on the number of cases.
const MIN_EXPECTED = 17
if (checked < MIN_EXPECTED) {
  console.error(`FAILED: only ${checked} checks ran, expected at least ${MIN_EXPECTED}`)
  process.exit(1)
}
// `checked`, not a pass count: the denominator has to be the number of
// checks that ran, or it shrinks by one per failure and reports a smaller
// suite on exactly the run where you need to know the size did not change.
console.log(`${checked} checked, ${failures} failed`)
if (failures) {
  console.error('FAILED')
  process.exit(1)
}
console.log('all passed')
process.exit(0)
