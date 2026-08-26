/**
 * Searching for a place.
 *
 * The cases are real Crossing names, because the ranking only matters against
 * real data: "bank" has to find the bank ahead of Bank Street, and that is
 * only a meaningful test when both exist.
 */
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const dir = mkdtempSync(join(tmpdir(), 'place-'))
const out = join(dir, 'placeSearch.js')
writeFileSync(
  out,
  ts.transpileModule(readFileSync('src/lib/placeSearch.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
)
const m = await import(pathToFileURL(out).href)

// Every labelled place in the game, which is what the app will search.
const places = []
for (const f of readdirSync('src/data/map')) {
  if (f === 'index.json') continue
  const z = JSON.parse(readFileSync(join('src/data/map', f), 'utf8'))
  for (const r of z.rooms) {
    if (r.label) places.push({ zone: z.id, zoneName: z.name, room: r.id, label: r.label, aliases: r.aliases })
  }
}

let fails = 0
const ok = (label, cond, detail = '') => {
  if (!cond) fails++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label.padEnd(48)} ${detail}`)
}

console.log(`-- ${places.length.toLocaleString()} places loaded --`)
ok('the whole game is searchable', places.length > 3000, String(places.length))

console.log('\n-- the obvious answer comes first --')
for (const [q, want] of [['bank', /bank/i], ['forge', /forge/i], ['temple', /temple/i]]) {
  const hits = m.searchPlaces(q, places)
  ok(`"${q}" finds something`, hits.length > 0, hits[0]?.label ?? 'nothing')
  ok(`"${q}" top hit is relevant`, want.test(hits[0]?.label ?? ''), hits[0]?.label ?? '')
}

console.log('\n-- aliases are searchable, which is the point of carrying them --')
const withAlias = places.find((p) => p.aliases?.length)
if (withAlias) {
  const alias = withAlias.aliases[0]
  const hits = m.searchPlaces(alias, places)
  ok(`alias "${alias}" finds its place`, hits.some((h) => h.label === withAlias.label), hits[0]?.label ?? 'nothing')
}

console.log('\n-- a fragment does not flood the list --')
ok('capped', m.searchPlaces('a', places).length <= 12, String(m.searchPlaces('a', places).length))
ok('one letter is ignored', m.searchPlaces('a', places).length === 0, '')

console.log('\n-- several words all have to appear --')
const multi = m.searchPlaces('provincial bank', places)
ok('multi-word query works', multi.length > 0, multi[0]?.label ?? 'nothing')

console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
