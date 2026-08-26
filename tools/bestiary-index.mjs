/**
 * Turn the scraped bestiary into a lookup the app can ship.
 *
 *   node tools/bestiary-index.mjs
 *
 * Two indexes, because the noun alone is not enough. 773 creatures share only
 * 408 nouns: twenty-seven are some kind of "creature", fourteen are a "troll",
 * ten are a "goblin". Keying on the noun and taking the first match would
 * report one troll's level for a different troll, confidently and wrongly.
 *
 * So:
 *
 *   byName  normalised full name -> everything we know
 *   byNoun  noun -> only the fields every candidate agrees on
 *
 * The second is the useful part. All fourteen trolls being skinnable is a fact
 * worth showing even when we cannot tell which troll this is; their differing
 * levels are not, so the level is simply absent rather than guessed.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const IN = 'data/elanthipedia/bestiary.json'
const OUT = 'src/data/bestiary.json'

const yes = (v) => /^(yes|true)$/i.test(String(v ?? '').trim())
const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^\d-]/g, ''))
  return Number.isFinite(n) && n !== 0 ? n : undefined
}

/** Same rule as lib/room.ts, kept in step deliberately. */
function nounOf(name) {
  const cleaned = name
    .toLowerCase()
    .replace(/^(a|an|the|some)\s+/, '')
    .replace(/[^a-z\s'-]/g, '')
    .trim()
  const words = cleaned.split(/\s+/)
  return words[words.length - 1] || cleaned
}

const normalise = (s) =>
  s.toLowerCase().replace(/^(a|an|the|some)\s+/, '').replace(/[^a-z\s'-]/g, '').trim()

function lore(v) {
  const out = {
    level: num(v.naturallevel),
    minCap: num(v.MinCap),
    maxCap: num(v.MaxCap),
    bodyType: v.BodyType || undefined,
    bodySize: v.BodySize || undefined,
    attackRange: v['Attack Range'] || undefined,
    castsSpells: v['Casts Spells'] ? yes(v['Casts Spells']) : undefined,
    stealthy: v.Stealthy ? yes(v.Stealthy) : undefined,
    skinnable: v.Skinnable ? yes(v.Skinnable) : undefined,
    hasBoxes: v['Has Boxes'] ? yes(v['Has Boxes']) : undefined,
    hasCoins: v['Has Coins'] ? yes(v['Has Coins']) : undefined,
    hasGems: v['Has Gems'] ? yes(v['Has Gems']) : undefined,
  }
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k]
  return out
}

const raw = JSON.parse(readFileSync(IN, 'utf8'))

const byName = {}
const groups = {}
for (const [title, v] of Object.entries(raw)) {
  const l = lore(v)
  if (Object.keys(l).length === 0) continue
  byName[normalise(title)] = l
  ;(groups[nounOf(title)] ??= []).push(l)
}

/** Keep a field only where every candidate says the same thing. */
const byNoun = {}
for (const [noun, list] of Object.entries(groups)) {
  if (list.length === 1) {
    byNoun[noun] = list[0]
    continue
  }
  const agreed = {}
  const keys = new Set(list.flatMap((l) => Object.keys(l)))
  for (const k of keys) {
    const values = list.map((l) => l[k])
    if (values.some((v) => v === undefined)) continue
    if (new Set(values).size === 1) agreed[k] = values[0]
  }
  if (Object.keys(agreed).length) byNoun[noun] = agreed
}

mkdirSync('src/data', { recursive: true })
writeFileSync(OUT, JSON.stringify({ byName, byNoun }))

const bytes = readFileSync(OUT).length
console.log(`${Object.keys(byName).length} by name, ${Object.keys(byNoun).length} by noun`)
console.log(`${(bytes / 1024).toFixed(1)} KB`)

// What the ambiguity actually costs, printed rather than assumed.
const ambiguous = Object.entries(groups).filter(([, l]) => l.length > 1)
const lostLevel = ambiguous.filter(([n]) => byNoun[n] && byNoun[n].level === undefined)
console.log(
  `${ambiguous.length} ambiguous nouns; ${lostLevel.length} of them lose the level to disagreement`
)
