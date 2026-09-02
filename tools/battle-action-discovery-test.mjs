import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/components/room/BattleActionBar.tsx', import.meta.url), 'utf8')

for (const label of ['Fight', 'Heal', 'Hunt', 'Items', 'Magic', 'Travel', 'Info']) {
  assert.match(source, new RegExp(`['"]${label}['"]`), `${label} group must have a visible name`)
}
assert.match(source, /type="search"/)
assert.match(source, /Name or command/)
assert.match(source, /variation\.label.*variation\.note.*variation\.commands/s)
assert.match(source, /onMouseEnter=/)
assert.match(source, /onFocus=/)
assert.match(source, /aria-live="polite"/)
assert.match(source, /Runs: \{explained\.commands\.join/)
assert.match(source, /onClick=\{\(\) => run\(variation\.commands\)\}/)

console.log('battle action discoverability contract passed')
