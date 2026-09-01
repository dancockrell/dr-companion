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

if (checks < 8) {
  console.log(`FAIL only ${checks} checks ran; expected 8`)
  process.exit(1)
}
console.log(`\n${checks} checks, ${failures} failed`)
process.exit(failures ? 1 : 0)
