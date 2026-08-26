/**
 * The bestiary lookup.
 *
 * The failure this guards against is confident wrongness: fourteen creatures
 * share the noun "troll" and they do not share a level, so the card must not
 * report one troll's level for another. Absent is fine. Wrong is not.
 */
import { readFileSync } from 'node:fs'

const data = JSON.parse(readFileSync('src/data/bestiary.json', 'utf8'))
const raw = JSON.parse(readFileSync('data/elanthipedia/bestiary.json', 'utf8'))

let fails = 0
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label.padEnd(54)} ${JSON.stringify(got)}`)
}

const nounOf = (name) => {
  const c = name.toLowerCase().replace(/^(a|an|the|some)\s+/, '').replace(/[^a-z\s'-]/g, '').trim()
  const w = c.split(/\s+/)
  return w[w.length - 1] || c
}

console.log('-- an exact name carries everything --')
check('kobold has a level', data.byName['kobold']?.level, 4)
check('kobold is skinnable', data.byName['kobold']?.skinnable, true)

console.log('\n-- an ambiguous noun carries only what all agree on --')
for (const noun of ['troll', 'goblin', 'creature', 'bear']) {
  const entry = data.byNoun[noun]
  if (!entry) continue
  const levels = new Set(
    Object.entries(raw)
      .filter(([t]) => nounOf(t) === noun)
      .map(([, v]) => v.naturallevel)
      .filter(Boolean)
  )
  // If the candidates disagreed on level, the index must not carry one.
  const ok = levels.size <= 1 || entry.level === undefined
  if (!ok) fails++
  console.log(
    `${ok ? 'OK  ' : 'FAIL'} ${noun.padEnd(12)} ${levels.size} distinct levels -> index level ${JSON.stringify(entry.level)}`
  )
}

console.log('\n-- no by-noun entry may claim a field its candidates dispute --')
let bad = 0
for (const [noun, entry] of Object.entries(data.byNoun)) {
  const candidates = Object.entries(raw).filter(([t]) => nounOf(t) === noun)
  if (candidates.length < 2) continue
  for (const [k, v] of Object.entries(entry)) {
    const src = {
      level: 'naturallevel', minCap: 'MinCap', maxCap: 'MaxCap',
      bodyType: 'BodyType', bodySize: 'BodySize', attackRange: 'Attack Range',
      castsSpells: 'Casts Spells', stealthy: 'Stealthy', skinnable: 'Skinnable',
      hasBoxes: 'Has Boxes', hasCoins: 'Has Coins', hasGems: 'Has Gems',
    }[k]
    // Normalised the same way the generator does, or "yes" and "Yes" read as
    // a disagreement and the test fails on its own casing.
    const norm = (x) =>
      /^(yes|true)$/i.test(String(x).trim())
        ? true
        : /^(no|false)$/i.test(String(x).trim())
          ? false
          : String(x).trim()
    const seen = new Set(
      candidates.map(([, c]) => c[src]).filter((x) => x !== undefined).map(norm)
    )
    if (seen.size > 1) {
      bad++
      if (bad <= 3) console.log(`     ${noun}.${k} = ${v} but sources disagree: ${[...seen]}`)
    }
  }
}
check('disputed fields kept', bad, 0)

console.log('\n-- corpses still resolve --')
const trimmed = 'a kobold which appears dead'
  .toLowerCase()
  .replace(/^(a|an|the|some)\s+/, '')
  .replace(/\s+which appears dead$/, '')
check('dead kobold finds the kobold', data.byName[trimmed]?.level, 4)

console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
