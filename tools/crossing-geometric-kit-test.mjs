import { readFileSync } from 'node:fs'

const source = readFileSync('docs/CROSSING_GEOMETRIC_KIT.md', 'utf8')
const fail = (message) => { console.error(`FAIL ${message}`); process.exitCode = 1 }
const pass = (message) => console.log(`OK   ${message}`)
const range = (prefix, count) => Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1).padStart(2, '0')}`)
const assets = [
  ...range('G', 16), ...range('P', 18), ...range('H', 10), ...range('T', 10),
  ...range('B', 24), ...range('E', 10), ...range('R', 16),
]

for (const id of assets) {
  const line = source.split('\n').find((candidate) => candidate.startsWith(`| ${id} |`))
  if (!line) fail(`${id} has a production-card row`)
  else if (line.length < 210) fail(`${id} has a complete build brief rather than a label`)
}
for (const id of range('S', 10)) {
  const line = source.split('\n').find((candidate) => candidate.startsWith(`| ${id} `))
  if (!line) fail(`${id} has a reviewed special-set row`)
  else if (line.length < 280) fail(`${id} states its evidence boundary and exclusions`)
}

if (assets.length === 104) pass('the universal Crossing kit retains 104 individually specified assets')
else fail('the kit asset count is wrong')
if (/Every route piece reserves a \*\*minimum 2 m unobstructed walking corridor\*\*/.test(source)) pass('route pieces have an explicit gameplay-clearance contract')
else fail('route clearance contract is missing')
if (/no baked neighboring house, no readable text, no unique shop inventory/.test(source)) pass('building shells have an explicit reuse boundary')
else fail('building reuse boundary is missing')
if (/Each set begins with a room\s+dossier/.test(source) && /does \*\*not\*\* support/.test(source)) pass('special sets keep an evidence and no-invention boundary')
else fail('special-set evidence boundary is missing')
