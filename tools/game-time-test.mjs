#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { formatGameDateTime, formatGameTime } from '../src/lib/gameTime.ts'

let checks = 0
let failures = 0
function ok(condition, label) {
  checks++
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`)
  if (!condition) failures++
}

const instant = Date.UTC(2026, 7, 31, 21, 7, 9)
const compact = formatGameTime(instant, 'en-GB')
const full = formatGameDateTime(instant, 'en-GB')
ok(/\d{2}:\d{2}/.test(compact), 'compact time follows the requested locale clock')
ok(full.includes('2026') && /\d{2}:\d{2}:\d{2}/.test(full), 'full tooltip includes date and time')
ok(formatGameTime(0, 'en-GB') === '--:--', 'unknown legacy time is labelled honestly')
ok(formatGameDateTime(Number.NaN, 'en-GB') === 'Time unavailable', 'invalid time never becomes a misleading current time')

const row = readFileSync('src/components/game/GameLineRow.tsx', 'utf8')
const tabs = readFileSync('src/components/game/StreamTabs.tsx', 'utf8')
const column = readFileSync('src/components/room/GameChatColumn.tsx', 'utf8')
ok(row.includes('<time') && row.includes('showTime'), 'game rows render an accessible time element on demand')
ok(tabs.includes('showStream showTime'), 'search results expose time and source channel')
ok(tabs.includes('offClasses={offClasses} showTime'), 'game channel history exposes compact times')
ok(column.includes('query={query}'), 'the scrollback search query reaches the transcript')

console.log('')
// This suite already had a floor - `if (checks < 8)` - and it is kept at 8
// rather than lowered to the "well below the real count" the rest of #406
// uses. Lowering a floor that already works would weaken a check to make it
// look like its neighbours. What changed is only the shape: the failure went
// out as a `FAIL` line, which `tools/run-tests.mjs` counts as one more failed
// check rather than as the run refusing to report at all. A floor has to sit
// outside what it counts.
const MIN_EXPECTED = 8
if (checks < MIN_EXPECTED) {
  console.error(`FAILED: only ${checks} checks ran, expected at least ${MIN_EXPECTED}`)
  process.exit(1)
}
// `checks`, not a pass count: the denominator has to be the number of checks
// that ran, or it shrinks by one per failure and reports a smaller suite on
// exactly the run where you need to know the size did not change.
console.log(`${checks} checked, ${failures} failed`)
if (failures) {
  console.error('FAILED')
  process.exit(1)
}
console.log('all passed')
process.exit(0)
