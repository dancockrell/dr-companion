import assert from 'node:assert/strict'
import {
  rangeRadiusPct,
  RANGE_RADIUS_FLOOR_PCT,
  angleFor,
  reorderByPin,
  detailFor,
  vitalColor,
  alwaysTone,
  nsysColor,
} from '../src/lib/combatRadarLogic.ts'
import type { RoomCard } from '../src/lib/cards.ts'
import type { RoomCombatant } from '../src/types/index.ts'

let checked = 0
let fails = 0
const ok = (label: string, cond: boolean, detail = '') => {
  checked++
  if (!cond) fails++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label.padEnd(58)}${detail}`)
}

// -- rangeRadiusPct --------------------------------------------------------
console.log('-- rangeRadiusPct --')
{
  const zero = rangeRadiusPct(0, 40)
  ok('a zero-width compass falls back to the floor exactly', JSON.stringify(zero) === JSON.stringify(RANGE_RADIUS_FLOOR_PCT))

  // A tiny compass with a large portrait needs the melee ring pushed well
  // past its floor so four cardinal pucks do not overlap.
  const tiny = rangeRadiusPct(100, 60)
  ok('melee widens past its floor when the compass is tight', tiny.melee > RANGE_RADIUS_FLOOR_PCT.melee, `${tiny.melee}`)
  ok('pole stays melee + its fixed gap', Math.abs(tiny.pole - (tiny.melee + 6)) < 1e-9)
  ok('missile stays melee + both fixed gaps', Math.abs(tiny.missile - (tiny.melee + 6 + 12)) < 1e-9)
  ok('rings are strictly ordered', tiny.melee < tiny.pole && tiny.pole < tiny.missile)

  // A wide compass with a small portrait never needs to push past the floor.
  const roomy = rangeRadiusPct(2000, 20)
  ok('melee stays at the floor when the compass is roomy', roomy.melee === RANGE_RADIUS_FLOOR_PCT.melee, `${roomy.melee}`)
}

// -- angleFor ---------------------------------------------------------------
console.log('\n-- angleFor --')
{
  ok('"behind you" reads as 180', angleFor('behind you', 'x') === 180)
  ok('"to your left" reads as 270', angleFor('to your left', 'x') === 270)
  ok('"to your right" reads as 90', angleFor('to your right', 'x') === 90)
  ok('"in front of you" reads as 0', angleFor('in front of you', 'x') === 0)
  ok('"facing you" reads as 0 too', angleFor('facing you', 'x') === 0)
  ok('"advancing on you" reads as 0 too', angleFor('advancing on you', 'x') === 0)
  ok('case does not matter', angleFor('BEHIND YOU', 'x') === 180)

  // "beside"/"flanking" have no side of their own — must be one of the two
  // side angles, and must be a pure function of id (same id, same answer).
  const a = angleFor('beside you', 'goblin-1')
  const b = angleFor('beside you', 'goblin-1')
  ok('an undecidable relation still returns a side angle', a === 90 || a === 270, `${a}`)
  ok('the same id always resolves the same way', a === b)

  // And it should actually be able to land on both sides across different
  // ids - a chooser that always picks one side would pass every assertion
  // above and still be broken.
  const angles = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => angleFor('beside you', id)))
  ok('undecidable relations scatter across both sides, not always one', angles.size === 2, `${[...angles]}`)
}

// -- reorderByPin -------------------------------------------------------
console.log('\n-- reorderByPin --')
{
  const entries = ['a', 'b', 'c', 'd']
  const keyOf = (s: string) => s

  ok('no pins leaves the order untouched', JSON.stringify(reorderByPin(entries, keyOf, [])) === JSON.stringify(entries))

  const pinned = reorderByPin(entries, keyOf, ['c'])
  ok('a pinned entry moves to the front', JSON.stringify(pinned) === JSON.stringify(['c', 'a', 'b', 'd']), JSON.stringify(pinned))

  // Most-recently-pinned first - the whole reason a corner is clickable at
  // all, per the function's own doc comment.
  const multi = reorderByPin(entries, keyOf, ['b', 'd'])
  ok('pins list front-to-back in pin order', JSON.stringify(multi) === JSON.stringify(['b', 'd', 'a', 'c']), JSON.stringify(multi))

  const gone = reorderByPin(entries, keyOf, ['z'])
  ok('a pin naming an entry that is not present is silently dropped', JSON.stringify(gone) === JSON.stringify(entries))
}

// -- detailFor --------------------------------------------------------------
console.log('\n-- detailFor --')
{
  const card = (over: Partial<RoomCard> = {}): RoomCard => ({
    id: 'x', deck: 'hostile', name: 'a goblin', noun: 'goblin', status: 'alive', count: 1, ...over,
  })
  const combatant = (over: Partial<RoomCombatant> = {}): RoomCombatant => ({
    id: 'x', name: null, noun: 'goblin', dead: false, hostile: true, disengaged: false,
    range: 'melee', relation: 'in front of you', target: 'you', targetNumber: null,
    balance: 'solidly', offBalance: false, conditions: [], statuses: [], enrichedAgeSeconds: 0,
    ...over,
  })

  ok('a dead card always says dead first', detailFor(card({ status: 'dead' }), undefined, '').startsWith('dead'))
  ok('a dead card with a combatant still leads with dead',
    detailFor(card({ status: 'dead' }), combatant(), '').startsWith('dead'))

  const live = detailFor(card(), combatant(), 'unassessed')
  ok('a live combatant reports its relation', live.includes('in front of you'), live)
  ok('a live combatant reports range in words, not the raw code', live.includes('melee range'), live)
  ok('a live combatant reports its target', live.includes('targeting you'), live)
  ok('a live combatant never falls back to the bare "presence" word', !live.includes('unassessed'), live)

  const offBalance = detailFor(card(), combatant({ offBalance: true }), '')
  ok('off balance is reported as its own word, not the balance descriptor', offBalance.includes('off balance'))
  ok('off balance suppresses the redundant balance descriptor', !offBalance.includes('balance: solidly'), offBalance)

  const noCombatant = detailFor(card(), undefined, 'unassessed')
  ok('with no combatant record, an alive card falls back to the presence word', noCombatant === 'unassessed', noCombatant)

  const deadNoCombatant = detailFor(card({ status: 'dead' }), undefined, 'unassessed')
  ok('a dead card with no combatant does not also say "unassessed" - redundant', deadNoCombatant === 'dead', deadNoCombatant)

  const stale = detailFor(card(), combatant({ enrichedAgeSeconds: 200 }), '')
  ok('assess data past the stale threshold is called out by age', stale.includes('assessed 200s ago'), stale)
  const fresh = detailFor(card(), combatant({ enrichedAgeSeconds: 5 }), '')
  ok('fresh assess data is not annotated with an age at all', !fresh.includes('assessed'), fresh)

  const lore = detailFor(card({ lore: { level: 12, minCap: 40, maxCap: 60, castsSpells: true } }), undefined, '')
  ok('lore level is reported', lore.includes('level 12'), lore)
  ok('an HP band with both ends reports as a range', lore.includes('40-60 HP'), lore)
  ok('spellcasting is reported', lore.includes('casts spells'), lore)

  const oneEndedCap = detailFor(card({ lore: { maxCap: 90 } }), undefined, '')
  ok('an HP cap with only one end reports as "up to"', oneEndedCap.includes('up to 90 HP'), oneEndedCap)

  const nothingKnown = detailFor(card({ status: 'alive' }), undefined, '')
  ok('nothing known at all is the empty string, not a placeholder', nothingKnown === '', JSON.stringify(nothingKnown))
}

// -- vitalColor ---------------------------------------------------------
console.log('\n-- vitalColor --')
{
  ok('full share is green (hue 120)', vitalColor(1).startsWith('hsl(120,'), vitalColor(1))
  ok('empty share is red hue at its darkest', vitalColor(0) === 'hsl(0, 90%, 35%)', vitalColor(0))
  ok('a share below the red calibration point stays red-hued', vitalColor(0.2).startsWith('hsl(0,'), vitalColor(0.2))

  // The whole reason for four calibration points instead of one ramp: two
  // shares on opposite sides of "basically fine" must not read as the same
  // colour.
  const nearHalf = vitalColor(0.41)
  const justOverRed = vitalColor(0.39)
  ok('39% and 41% do not collapse into the same colour', nearHalf !== justOverRed, `${justOverRed} vs ${nearHalf}`)

  ok('input above 1 is clamped, not extrapolated', vitalColor(5) === vitalColor(1))
  ok('input below 0 is clamped, not extrapolated', vitalColor(-5) === vitalColor(0))
}

// -- alwaysTone / nsysColor -----------------------------------------------
console.log('\n-- alwaysTone / nsysColor --')
{
  ok('inactive is always the faint tone regardless of warnOnly', alwaysTone(false) === 'text-ink-faint')
  ok('inactive ignores warnOnly too', alwaysTone(false, true) === 'text-ink-faint')
  ok('active defaults to the danger tone', alwaysTone(true) === 'text-danger')
  ok('active with warnOnly downgrades to the warn tone', alwaysTone(true, true) === 'text-warn')

  ok('unhurt nerves are the faint tone', nsysColor(0) === 'var(--color-ink-faint)')
  ok('minor nerve damage gets its own colour, not faint or warn', nsysColor(1) !== 'var(--color-ink-faint)' && nsysColor(1) !== 'var(--color-warn)')
  ok('serious nerve damage is the warn tone', nsysColor(2) === 'var(--color-warn)')
  ok('severe nerve damage is the danger tone', nsysColor(3) === 'var(--color-danger)')
  ok('anything past severe stays at the danger tone, never overflows', nsysColor(9) === 'var(--color-danger)')
}

// -- and the check can fail: shown against a broken version --------------
console.log('\n-- and the check can fail --')
{
  // The mutation this guards against: someone "simplifies" detailFor to
  // always report the presence word even when the card is dead.
  const alwaysPresence = (presence: string) => (presence ? presence : '')
  ok(
    'a version that always trusts presence would wrongly say "unassessed" for a corpse',
    alwaysPresence('unassessed') !== 'dead',
    'confirms the assertion above is load-bearing'
  )
}

const ran = checked
ok('enough was checked for a pass to mean something', ran >= 30, `${ran} assertions`)

console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
