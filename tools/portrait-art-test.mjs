import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const portrait = readFileSync('public/portraits/dwarf-female.webp')
const manifest = JSON.parse(readFileSync('public/portraits/manifest.json', 'utf8'))
const ledger = JSON.parse(readFileSync('data/art/portrait-qa-ledger.json', 'utf8'))
const record = ledger.records['dwarf-female']

let failures = 0
const check = (label, condition) => {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`)
  if (!condition) failures++
}

check('female Dwarf remains a core installed portrait', manifest.includes('dwarf-female.webp'))
check('replacement is a decodable WebP container', portrait.subarray(0, 4).toString() === 'RIFF' && portrait.subarray(8, 12).toString() === 'WEBP')
check('replacement keeps the 256x384 portrait contract', portrait.readUInt16LE(26) === 256 && portrait.readUInt16LE(28) === 384)
check('QA ledger describes the exact shipped pixels', createHash('sha256').update(portrait).digest('hex').toUpperCase() === record.sha256)
check('replacement passed card and radar crop review', record.pixelReviewed === true && record.cardCrop === 'pass' && record.radarCrop === 'pass')
check('lore evidence is recorded with the decision', record.loreReferences.length >= 2 && record.decision === 'approved' && record.reviewer)
check('the remaining core contact-sheet review is honestly pending', ledger.contactSheetReview.status === 'pending-review')

console.log(failures ? `\n${failures} failed` : '\nall portrait art checks passed')
process.exit(failures ? 1 : 0)
