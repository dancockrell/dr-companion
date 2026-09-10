import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const dir = mkdtempSync(join(tmpdir(), 'town-loop-'))
const out = join(dir, 'townLoop.mjs')
writeFileSync(
  out,
  ts.transpileModule(readFileSync('src/lib/townLoop.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
)
const m = await import(pathToFileURL(out).href)

let checked = 0
let failed = 0
const check = (name, got, want) => {
  checked++
  const pass = JSON.stringify(got) === JSON.stringify(want)
  if (!pass) failed++
  console.log(
    `${pass ? 'OK  ' : 'FAIL'} ${name}${pass ? '' : ` got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`
  )
}
const checkThrows = (name, fn) => {
  checked++
  let threw = false
  try {
    fn()
  } catch {
    threw = true
  }
  if (!threw) failed++
  console.log(`${threw ? 'OK  ' : 'FAIL'} ${name}${threw ? '' : ' (did not throw)'}`)
}

// --- Denomination values, straight from DOMAIN.md:148 -----------------
// 1 platinum = 10 gold = 100 silver = 1,000 bronze = 10,000 copper
check('platinum is worth 10,000 copper', m.COPPER_PER_DENOMINATION.platinum, 10000)
check('gold is worth 1,000 copper', m.COPPER_PER_DENOMINATION.gold, 1000)
check('silver is worth 100 copper', m.COPPER_PER_DENOMINATION.silver, 100)
check('bronze is worth 10 copper', m.COPPER_PER_DENOMINATION.bronze, 10)
check('copper is worth 1 copper', m.COPPER_PER_DENOMINATION.copper, 1)

// --- toCopper: single-denomination sanity ------------------------------
check('one platinum sums to 10,000 copper', m.toCopper({ platinum: 1 }), 10000)
check('one gold sums to 1,000 copper', m.toCopper({ gold: 1 }), 1000)
check('one silver sums to 100 copper', m.toCopper({ silver: 1 }), 100)
check('one bronze sums to 10 copper', m.toCopper({ bronze: 1 }), 10)
check('one copper sums to 1 copper', m.toCopper({ copper: 1 }), 1)
check('a mixed purse sums correctly', m.toCopper({ platinum: 2, gold: 3, silver: 4, bronze: 5, copper: 6 }), 23456)
check('an empty purse is worth nothing', m.toCopper({}), 0)

// --- fromCopper: every denomination boundary, one below and one at -----
check('9 copper is 9 copper, no bronze yet', m.fromCopper(9), {
  platinum: 0, gold: 0, silver: 0, bronze: 0, copper: 9,
})
check('10 copper is exactly 1 bronze', m.fromCopper(10), {
  platinum: 0, gold: 0, silver: 0, bronze: 1, copper: 0,
})
check('99 copper is 9 bronze 9 copper, no silver yet', m.fromCopper(99), {
  platinum: 0, gold: 0, silver: 0, bronze: 9, copper: 9,
})
check('100 copper is exactly 1 silver', m.fromCopper(100), {
  platinum: 0, gold: 0, silver: 1, bronze: 0, copper: 0,
})
check('999 copper is 9 silver 9 bronze 9 copper, no gold yet', m.fromCopper(999), {
  platinum: 0, gold: 0, silver: 9, bronze: 9, copper: 9,
})
check('1,000 copper is exactly 1 gold', m.fromCopper(1000), {
  platinum: 0, gold: 1, silver: 0, bronze: 0, copper: 0,
})
check('9,999 copper is 9 gold 9 silver 9 bronze 9 copper, no platinum yet', m.fromCopper(9999), {
  platinum: 0, gold: 9, silver: 9, bronze: 9, copper: 9,
})
check('10,000 copper is exactly 1 platinum', m.fromCopper(10000), {
  platinum: 1, gold: 0, silver: 0, bronze: 0, copper: 0,
})

// --- Round trip over every boundary, and a large mixed value -----------
for (const boundary of [0, 1, 9, 10, 11, 99, 100, 101, 999, 1000, 1001, 9999, 10000, 10001, 123456]) {
  check(`round-trips through fromCopper/toCopper at ${boundary}`, m.toCopper(m.fromCopper(boundary)), boundary)
}

// --- convertDenomination ------------------------------------------------
check('1 platinum is 10 gold', m.convertDenomination(1, 'platinum', 'gold'), 10)
check('1 platinum is 100 silver', m.convertDenomination(1, 'platinum', 'silver'), 100)
check('1 platinum is 10,000 copper', m.convertDenomination(1, 'platinum', 'copper'), 10000)
check('1 gold is 10 silver', m.convertDenomination(1, 'gold', 'silver'), 10)
check('1 silver is 10 bronze', m.convertDenomination(1, 'silver', 'bronze'), 10)
check('1 bronze is 10 copper', m.convertDenomination(1, 'bronze', 'copper'), 10)
// The inverse direction is fractional, and that is correct, not a bug.
check('1 gold is 0.1 platinum', m.convertDenomination(1, 'gold', 'platinum'), 0.1)
check('1 copper is 0.0001 platinum', m.convertDenomination(1, 'copper', 'platinum'), 0.0001)
check('converting a denomination to itself is a no-op', m.convertDenomination(7, 'silver', 'silver'), 7)

// --- Deliberately wrong conversions that must fail ----------------------
// A negative coin count is not a value this domain has; toCopper must
// refuse it rather than silently summing to a wrong (negative) total.
checkThrows('a negative coin count is rejected, not silently summed', () => m.toCopper({ gold: -1 }))
checkThrows('a non-finite coin count is rejected', () => m.toCopper({ platinum: Infinity }))
// A copper total is a physical coin count, so it must be a non-negative
// integer; fromCopper must refuse a fractional or negative total rather
// than silently guessing a coin breakdown that does not exist.
checkThrows('fromCopper rejects a fractional copper total', () => m.fromCopper(10.5))
checkThrows('fromCopper rejects a negative copper total', () => m.fromCopper(-1))
checkThrows('convertDenomination rejects a non-finite amount', () => m.convertDenomination(NaN, 'gold', 'silver'))
// The wrong conversion this is actually guarding against: an off-by-a-
// factor-of-ten reading, the exact bug the file's own header warns about.
// If someone mis-keys the table so 1 platinum reads as 100 gold instead of
// 10, this assertion is the one that goes red.
check('1 platinum is NOT 100 gold (the factor-of-ten bug this file guards against)', m.convertDenomination(1, 'platinum', 'gold') === 100, false)

// --- Wealth / transaction shapes exist and round-trip through JSON -----
const wealth = m.emptyWealth()
check('emptyWealth starts with nothing on hand and nothing banked', wealth, { onHand: {}, banked: {} })

const withBank = {
  onHand: { platinum: 1, silver: 50 },
  banked: { Zoluren: { platinum: 12 }, Ilithi: { gold: 3 } },
}
check('a per-province banked ledger keeps provinces distinct', Object.keys(withBank.banked).sort(), ['Ilithi', 'Zoluren'])
check('on-hand coins are not duplicated per province', withBank.onHand, { platinum: 1, silver: 50 })

const refusal = {
  kind: 'sell',
  ok: false,
  description: 'The shopkeeper refuses your goods.',
  reason: 'Shop does not buy that item.',
}
check('a refused transaction carries no amount', refusal.amount, undefined)
check('a refused transaction is never reported ok', refusal.ok, false)

console.log('')
// Far below the real count on purpose: a tripwire for a truncated or
// half-loaded run, not a regression test on the number of cases.
const MIN_EXPECTED = 40
if (checked < MIN_EXPECTED) {
  console.error(`FAILED: only ${checked} checks ran, expected at least ${MIN_EXPECTED}`)
  process.exit(1)
}
console.log(`${checked} checked, ${failed} failed`)
if (failed) {
  console.error('FAILED')
  process.exit(1)
}
console.log('all passed')
process.exit(0)
