import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const ledger = JSON.parse(readFileSync('data/art/pin-icons/curation.json', 'utf8'))
const pins = readFileSync('src/lib/mapPins.ts', 'utf8')
const glyph = readFileSync('src/components/shared/PinIconGlyph.tsx', 'utf8')
const canvas = readFileSync('src/components/shared/MapCanvas.tsx', 'utf8')
let failures = 0
const check = (label, value, detail = '') => {
  console.log(`${value ? 'OK  ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`)
  if (!value) failures++
}

check('pin-art ledger has a version', ledger.schemaVersion === 1)
for (const item of ledger.approved) {
  const asset = readFileSync(item.path)
  const hash = createHash('sha256').update(asset).digest('hex')
  check(`${item.key} is a PNG`, asset.subarray(0, 8).toString('hex') === '89504e470d0a1a0a')
  check(`${item.key} is 192px square`, asset.readUInt32BE(16) === 192 && asset.readUInt32BE(20) === 192)
  check(`${item.key} retains alpha`, [4, 6].includes(asset[25]))
  check(`${item.key} matches its reviewed hash`, hash === item.sha256, hash.slice(0, 12))
  check(`${item.key} is admitted to the saved-icon vocabulary`, pins.includes(`'${item.key}'`))
  check(`${item.key} has an HTML renderer`, glyph.includes('customPinIconHref(icon)'))
  check(`${item.key} has an SVG map renderer`, canvas.includes('customPinIconHref(customIcon)'))
  check(`${item.key} records every runtime surface`, item.runtimeSurfaces.length >= 6)
}

if (failures) process.exit(1)
console.log('\nall pin-art checks passed')
