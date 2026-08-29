/**
 * The card tier logic, which is the part with real failure modes.
 *
 * The one that matters: a deck must never render nothing. Six goblins
 * attacking you and an empty panel is the single unforgivable outcome, so the
 * floor is asserted explicitly at absurd widths.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const dir = mkdtempSync(join(tmpdir(), 'cards-'))
const out = join(dir, 'cards.mjs')
writeFileSync(
  out,
  ts.transpileModule(readFileSync('src/lib/cards.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
)
const m = await import(pathToFileURL(out).href)

let fails = 0
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label.padEnd(46)} ${JSON.stringify(got)}`)
}

console.log('-- tier picks the widest thing that fits --')
check('700px, 3 cards -> full', m.tierFor(700, 3), 'full')
check('400px, 3 cards -> compact', m.tierFor(400, 3), 'compact')
check('300px, 6 cards -> row', m.tierFor(300, 6), 'row')
// Rows beat fanning while they still fit: a 22px sliver showing one letter is
// not information, and 14 rows of 32px is.
check('200px, 12 cards -> row', m.tierFor(200, 12), 'row')
check('200px, 30 cards -> fan', m.tierFor(200, 30), 'fan')
check('60px,  6 cards -> count', m.tierFor(60, 6), 'count')

console.log('\n-- the floor: a deck with cards never renders nothing --')
for (const w of [0, 1, 12, 40, 95]) {
  const t = m.tierFor(w, 6)
  const ok = t === 'count'
  if (!ok) fails++
  console.log(`${ok ? 'OK  ' : 'FAIL'} width ${String(w).padEnd(4)} still shows the count  -> ${t}`)
}

console.log('\n-- an empty deck is the only case that shows nothing --')
check('0 cards -> count', m.tierFor(9999, 0), 'count')

console.log('\n-- identical nouns collapse, different statuses do not --')
const raw = [
  { id: 'a', deck: 'hostile', name: 'a goblin', noun: 'goblin', status: 'alive', count: 1 },
  { id: 'b', deck: 'hostile', name: 'a goblin', noun: 'goblin', status: 'alive', count: 1 },
  { id: 'c', deck: 'hostile', name: 'a goblin', noun: 'goblin', status: 'dead', count: 1 },
]
const collapsed = m.collapse(raw)
check('three goblins -> two cards', collapsed.length, 2)
check('the living pair carries x2', collapsed.find((c) => c.status === 'alive').count, 2)

console.log('\n-- ordering: stunned first, dead last, stable by name --')
const sorted = m.sortCards([
  { id: '1', deck: 'hostile', name: 'zeta', noun: 'z', status: 'alive', count: 1 },
  { id: '2', deck: 'hostile', name: 'alpha', noun: 'a', status: 'dead', count: 1 },
  { id: '3', deck: 'hostile', name: 'beta', noun: 'b', status: 'stunned', count: 1 },
  { id: '4', deck: 'hostile', name: 'alpha2', noun: 'a2', status: 'alive', count: 1 },
])
check('order', sorted.map((c) => c.name), ['beta', 'alpha2', 'zeta', 'alpha'])

console.log('\n-- trailingCellSpansRow: does the last cell land alone in a fresh row --')
// Real screenshot case: Hostile + People populated (2 preceding cells, 2
// columns) left "On the floor" half-width with a dead gap beside it on the
// first pass - the arithmetic was backwards and nobody caught it by reading
// the code, only by looking at what it actually drew.
check('0 preceding, 2 cols: nothing above it, spans alone', m.trailingCellSpansRow(0, 2), true)
check('1 preceding, 2 cols: shares row 1 with the one cell before it', m.trailingCellSpansRow(1, 2), false)
check('2 preceding, 2 cols: row 1 just filled, lands alone in row 2', m.trailingCellSpansRow(2, 2), true)
check('3 preceding, 2 cols: shares row 2 with the last of the three', m.trailingCellSpansRow(3, 2), false)
check('4 preceding, 2 cols: two full rows before it, lands alone', m.trailingCellSpansRow(4, 2), true)
// Not hardcoded to 2 columns, in case the grid ever grows.
check('3 preceding, 3 cols: exactly one full row before it, lands alone', m.trailingCellSpansRow(3, 3), true)
check('2 preceding, 3 cols: shares the first row, which still has room', m.trailingCellSpansRow(2, 3), false)

console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
