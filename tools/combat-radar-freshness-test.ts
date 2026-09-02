import assert from 'node:assert/strict'
import { hasFreshRadarPlacement, RADAR_PLACEMENT_MAX_AGE_SECONDS } from '../src/lib/combatRadarFreshness.ts'

let checks = 0
function check(label: string, actual: boolean, expected: boolean) {
  assert.equal(actual, expected, label)
  checks++
  console.log(`OK   ${label}`)
}

const placement = (age: number | null, range: 'melee' | null = 'melee', relation: string | null = 'in front of you') =>
  hasFreshRadarPlacement({ range, relation, enrichedAgeSeconds: age })

check('a just-assessed hostile may occupy its range ring', placement(0), true)
check('the freshness boundary remains usable', placement(RADAR_PLACEMENT_MAX_AGE_SECONDS), true)
check('an older assess cannot masquerade as current geometry', placement(RADAR_PLACEMENT_MAX_AGE_SECONDS + 1), false)
check('a never-assessed hostile stays in the roster', placement(null), false)
check('a range without a relation cannot produce a position', placement(2, 'melee', null), false)
check('a relation without a range cannot produce a position', placement(2, null), false)
check('a bad future-clock age is rejected instead of treated as fresh', placement(-1), false)

assert.ok(checks >= 7, 'the freshness suite ran its complete contract')
console.log('\nall combat radar freshness checks passed')
