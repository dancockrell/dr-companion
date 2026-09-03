/**
 * PANEL_DATA_CONTRACTS had no test.
 *
 * Its whole purpose is answering "can this window be shown, and with what
 * data" for every PanelId - which means the one failure mode worth guarding
 * against is a PanelId with no matching contract entry. `Record<PanelId, X>`
 * makes TypeScript itself refuse a missing key at compile time, which this
 * test cannot improve on directly - but it can catch the human mistake TS
 * cannot: an entry present but empty/placeholder (no real purpose, no real
 * data named), which compiles fine and tells a reader nothing.
 *
 *   node tools/panel-data-contracts-test.mjs
 */
import { readFileSync } from 'node:fs'
import { PANEL_DATA_CONTRACTS, panelIsShowable } from '../src/lib/panelDataContracts.ts'

// panels.tsx renders React components (JSX) and can't be imported directly
// under plain node the way this file's other, pure-data imports can - read
// its PANEL_TITLES keys as text instead, the same "read the real source,
// don't hand-copy the list" discipline as importing it, without pulling in
// a whole component tree just to read an object's keys.
const panelsSource = readFileSync(new URL('../src/components/dashboard/panels.tsx', import.meta.url), 'utf8')
const titlesBlock = panelsSource.match(/PANEL_TITLES[^{]*\{([\s\S]*?)\n\}/)?.[1] ?? ''
const panelIdsFromSource = [...titlesBlock.matchAll(/^\s*(\w+):/gm)].map((m) => m[1])

let pass = 0
let fail = 0

function ok(label, cond, detail) {
  if (cond) {
    pass += 1
    console.log(`OK   ${label.padEnd(70)} ${detail ?? ''}`)
  } else {
    fail += 1
    console.log(`FAIL ${label.padEnd(70)} ${detail ?? ''}`)
  }
}

const panelIds = panelIdsFromSource
ok('the regex actually found panel ids in panels.tsx (a broken match would silently check nothing)', panelIds.length >= 10, String(panelIds.length))

console.log('-- every named panel has a real, non-placeholder data contract --')
for (const id of panelIds) {
  const contract = PANEL_DATA_CONTRACTS[id]
  ok(`${id}: has a contract entry`, contract != null)
  if (!contract) continue
  ok(`${id}: purpose is a real sentence, not empty`, typeof contract.purpose === 'string' && contract.purpose.length > 20, contract.purpose?.slice(0, 40))
  ok(`${id}: names at least one real data source`, Array.isArray(contract.dataNeeded) && contract.dataNeeded.length > 0, JSON.stringify(contract.dataNeeded))
  ok(`${id}: requiresLiveCharacter is a real boolean, not left undefined`, typeof contract.requiresLiveCharacter === 'boolean')
}

console.log('\n-- PANEL_DATA_CONTRACTS names nothing beyond what PANEL_TITLES/PanelId actually has --')
{
  const extra = Object.keys(PANEL_DATA_CONTRACTS).filter((id) => !panelIds.includes(id))
  ok('no stale entries for a panel id that no longer exists', extra.length === 0, JSON.stringify(extra))
}

console.log('\n-- panelIsShowable: the honest-degradation check --')
{
  ok('a panel that needs a live character is not showable without one', panelIsShowable('inventory', false) === false)
  ok('a panel that needs a live character is showable with one', panelIsShowable('inventory', true) === true)
  ok('a panel that works offline (scripts) is showable either way', panelIsShowable('scripts', false) === true && panelIsShowable('scripts', true) === true)
}

console.log('')
console.log(`${pass} checked, ${fail} failed`)
if (fail > 0) {
  console.error('FAILED')
  process.exit(1)
}
console.log('all passed')
