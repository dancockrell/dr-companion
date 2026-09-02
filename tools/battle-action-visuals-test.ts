import { readFileSync } from 'node:fs'
import { MACROS } from '../src/data/macros.ts'

const source = readFileSync('src/lib/battleActionVisuals.ts', 'utf8')
const objectBody = source.match(/const ACTION_ICONS[^=]*=\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
const entries = [...objectBody.matchAll(/'([^']+)'\s*:\s*Icons\.([A-Za-z0-9_]+)/g)]
const actualKeys = entries.map((match) => match[1])
const actualIcons = entries.map((match) => match[2])
const expectedKeys = MACROS.flatMap((macro) =>
  macro.variations.map((variation) => `${macro.id}:${variation.id}`)
)

let failed = 0
const check = (name: string, pass: boolean, detail = '') => {
  if (!pass) failed++
  console.log(`${pass ? 'OK  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
}

const missing = expectedKeys.filter((key) => !actualKeys.includes(key))
const extra = actualKeys.filter((key) => !expectedKeys.includes(key))
check('every macro variation has an icon', missing.length === 0, missing.join(', '))
check('the icon map has no stale actions', extra.length === 0, extra.join(', '))
check('every action key appears exactly once', new Set(actualKeys).size === actualKeys.length)
check('every action uses a distinct icon', new Set(actualIcons).size === expectedKeys.length)
check('the contract covers a meaningful catalog', expectedKeys.length >= 40, `${expectedKeys.length} actions`)

console.log(failed ? `\n${failed} failed` : '\nall battle action visual checks passed')
process.exit(failed ? 1 : 0)
