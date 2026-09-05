/**
 * The override store: export, import, and what happens when two players
 * disagree.
 *
 * The rule this suite exists to hold is the merge one, and it is a rule about
 * whose work survives: **the local player's own choice always wins**. An
 * import is somebody else's opinion arriving at a machine whose owner has
 * already expressed their own, and a merge that silently replaces it is
 * indistinguishable from losing it. Conflicts come back as a list for a human
 * to settle; nothing resolves them here.
 *
 * The resolver itself (`appearanceFor`, the noun table, the snapshot fields)
 * is tested in `tools/presentation-bridge-test.mjs`, beside the compiler that
 * uses it. This file is only the store.
 *
 *   node tools/appearance-test.mjs
 */
import {
  APPEARANCE_STORAGE_KEY,
  appearanceFor,
  exportAppearanceOverrides,
  importAppearanceOverrides,
  loadAppearanceOverrides,
  resetAppearanceOverride,
  setAppearanceOverride,
} from '../src/lib/appearance.ts'
import { armorPieceId } from '../src/lib/armorLoadout.ts'
import defaults from '../src/data/appearanceDefaults.json' with { type: 'json' }

let pass = 0
let fail = 0

function ok(label, cond, detail) {
  if (cond) {
    pass += 1
    console.log(`OK   ${label.padEnd(66)} ${detail ?? ''}`)
  } else {
    fail += 1
    console.log(`FAIL ${label.padEnd(66)} ${detail ?? ''}`)
  }
}

// storage.ts reads `localStorage`, which Node does not have, and returns its
// fallback on the resulting ReferenceError. That is the right behaviour and it
// also means every write below would be a no-op, so the whole suite would pass
// while exercising nothing. Stand one up.
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, v) },
  removeItem: (k) => { store.delete(k) },
}

// Two real ids, taken from the compiled table rather than typed here, so this
// suite keeps working when the registry's contents change.
const IDS = defaults.registry.ids
const [ID_A, ID_B] = IDS

console.log('-- the stand-in store actually stores (control for everything below) --')
{
  store.clear()
  ok('the registry published at least two ids for these cases to use',
    typeof ID_A === 'string' && typeof ID_B === 'string' && ID_A !== ID_B,
    `${IDS.length} ids`)
  ok('a write reaches the store', setAppearanceOverride('a bastard sword', ID_A) === true)
  ok('...and is readable back, so a green result below is not an empty no-op',
    loadAppearanceOverrides()[armorPieceId('a bastard sword')] === ID_A,
    JSON.stringify(loadAppearanceOverrides()))
  ok('the key is the one the app declares', store.has(APPEARANCE_STORAGE_KEY))
}

console.log('\n-- export --')
{
  store.clear()
  setAppearanceOverride('a bastard sword', ID_A)
  const file = exportAppearanceOverrides()
  ok('one versioned object', file.version === 1)
  ok('marked as a player artefact, not a generated table', file.provenance === 'player')
  ok('carrying the choices', file.overrides[armorPieceId('a bastard sword')] === ID_A)

  store.clear()
  ok('an empty store exports an empty object, not a refusal',
    Object.keys(exportAppearanceOverrides().overrides).length === 0)
}

console.log('\n-- import: the local player always wins --')
{
  store.clear()
  setAppearanceOverride('a bastard sword', ID_A)
  const theirs = {
    version: 1,
    provenance: 'player',
    overrides: {
      [armorPieceId('a bastard sword')]: ID_B,
      [armorPieceId('a steel helm')]: ID_B,
    },
  }
  const result = importAppearanceOverrides(theirs)

  ok('an item the local player had not chosen is taken', result.added === 1, String(result.added))
  ok('...and is actually in the store afterwards',
    loadAppearanceOverrides()[armorPieceId('a steel helm')] === ID_B)
  ok('a disagreement is returned as a conflict', result.conflicts.length === 1, JSON.stringify(result.conflicts))
  ok('the conflict names both sides so a human can settle it',
    result.conflicts[0]?.mine === ID_A && result.conflicts[0]?.theirs === ID_B)
  ok('THE RULE: the local choice is untouched, not silently overwritten',
    loadAppearanceOverrides()[armorPieceId('a bastard sword')] === ID_A,
    loadAppearanceOverrides()[armorPieceId('a bastard sword')])
  ok('...and the resolver still reports the local choice',
    appearanceFor('weapon', 'a bastard sword')?.modelId === ID_A)

  // The same file twice must not grow anything or re-report a settled item as
  // newly added.
  const again = importAppearanceOverrides(theirs)
  ok('re-importing the same file adds nothing', again.added === 0, String(again.added))
  ok('...and still reports the one genuine disagreement', again.conflicts.length === 1)
}

console.log('\n-- import: agreement is not a conflict --')
{
  store.clear()
  setAppearanceOverride('a bastard sword', ID_A)
  const result = importAppearanceOverrides({
    version: 1,
    provenance: 'player',
    overrides: { [armorPieceId('a bastard sword')]: ID_A },
  })
  ok('an identical choice is neither added nor a conflict',
    result.added === 0 && result.conflicts.length === 0,
    `${result.added} added, ${result.conflicts.length} conflicts`)
}

console.log('\n-- import: unknown ids are counted, never stored --')
{
  store.clear()
  const result = importAppearanceOverrides({
    version: 1,
    provenance: 'player',
    overrides: {
      'bastard-sword': 'dr.shared.nothing.at.all',
      'steel-helm': 'dr.shared.also.not.real',
      'a-real-one': ID_A,
    },
  })
  ok('an id this build does not admit is not stored',
    loadAppearanceOverrides()['bastard-sword'] === undefined)
  ok('...it is counted, so a file that half-vanished says so', result.ignoredUnknownIds === 2,
    String(result.ignoredUnknownIds))
  ok('the usable entry still lands - one bad row does not discard the good ones',
    result.added === 1 && loadAppearanceOverrides()['a-real-one'] === ID_A)
}

console.log('\n-- import: rubbish in --')
{
  store.clear()
  ok('null imports to an empty result rather than throwing',
    importAppearanceOverrides(null).added === 0)
  ok('a file with no overrides key is inert', importAppearanceOverrides({ version: 1 }).added === 0)
  const malformed = importAppearanceOverrides({
    overrides: { 'a-thing': 42, '': ID_A, 'another': null },
  })
  ok('non-string and empty-key entries are counted as malformed, not stored',
    malformed.ignoredMalformed === 3, String(malformed.ignoredMalformed))
  ok('...and nothing was written', Object.keys(loadAppearanceOverrides()).length === 0)
}

console.log('\n-- reset --')
{
  store.clear()
  setAppearanceOverride('a bastard sword', ID_A)
  resetAppearanceOverride('a bastard sword')
  ok('reset removes the entry', loadAppearanceOverrides()[armorPieceId('a bastard sword')] === undefined)
  ok('...and the item returns to its compiled default',
    appearanceFor('weapon', 'a bastard sword')?.modelId === defaults.weapon.classes['Large Edged'] &&
      appearanceFor('weapon', 'a bastard sword')?.provenance === 'derived')
  ok('resetting something never set is not an error',
    (resetAppearanceOverride('a thing nobody owns'), true))
}

delete globalThis.localStorage

console.log('')
console.log(`${pass} checked, ${fail} failed`)
if (fail > 0) {
  console.error('FAILED')
  process.exit(1)
}
console.log('all passed')
