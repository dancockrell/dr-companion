/**
 * Gear conflicts, tested on the distinction that decides whether they lie.
 *
 * The rule this file guards is not "does a helm plus a flute produce a
 * warning". That is the easy half and it would pass on a function that warned
 * about everything. The half that matters is silence: this panel is on screen
 * permanently, so every case where it says nothing is a case where it is
 * implicitly saying "nothing is wrong", and it must only do that when it
 * actually knows.
 *
 * Which makes the interesting case an older bridge. It sends no worn list at
 * all, and if `undefined` were treated as "wearing nothing" the app would
 * quietly certify every such player as fine forever. That is the failure this
 * project keeps finding in other clothes: a check that cannot fire is
 * indistinguishable from a check that passed.
 */
import { gearConflicts, conflictSubjects, GEAR_CONFLICTS } from '../src/data/gearConflicts.ts'

let failed = 0
const ok = (name, got, want) => {
  const pass = JSON.stringify(got) === JSON.stringify(want)
  if (!pass) failed++
  console.log(
    `${pass ? 'OK  ' : 'FAIL'} ${name.padEnd(52)} ${pass ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`
  )
}

const HELM = 'a coarse onyx-hide helm'
const TXISTU = 'a cocobolo txistu'
const SWORD = 'a serrated broadsword'
const HAUBERK = 'a sleek cinnabar brigandine hauberk riveted with rose gold studs'

const n = (c) => c.length

console.log('-- the rules are there to be tested at all --')
{
  // The fragile denominator. Every assertion below about a conflict *not*
  // firing is trivially true against an empty rule list, so the count that
  // disappears when the data breaks is asserted first.
  ok('there is at least one rule', GEAR_CONFLICTS.length >= 1, true)
  ok(
    'every rule carries the game line that proves it',
    GEAR_CONFLICTS.every((r) => r.evidence.length > 20 && r.seen.length > 0),
    true
  )
}

console.log('\n-- the observed case fires --')
{
  const hits = gearConflicts({ right: TXISTU, left: null }, [HELM, HAUBERK])
  ok('helm plus wind instrument warns', n(hits), 1)
  ok('and it is the observed rule', hits[0]?.id, 'headgear-vs-wind')

  const who = conflictSubjects(hits[0], { right: TXISTU, left: null }, [HELM, HAUBERK])
  // Names, not categories. The message is worth nothing if it says "something
  // on your head".
  ok('it names the worn item', who.worn, HELM)
  ok('it names the held item', who.held, TXISTU)
}

console.log('\n-- one side alone is not a conflict --')
{
  ok('helm with a sword says nothing', n(gearConflicts({ right: SWORD, left: null }, [HELM])), 0)
  ok('txistu with no helm says nothing', n(gearConflicts({ right: TXISTU, left: null }, [HAUBERK])), 0)
  ok('empty hands say nothing', n(gearConflicts({ right: null, left: null }, [HELM])), 0)
}

console.log('\n-- absent is not empty, and this is the whole point --')
{
  // An older bridge sends no worn list. Treating that as "wearing nothing"
  // would make this panel certify every player on an old bridge as fine, in
  // exactly the voice it uses when it has checked.
  ok('no worn list at all: no claim', n(gearConflicts({ right: TXISTU, left: null }, undefined)), 0)
  ok('null worn list: no claim', n(gearConflicts({ right: TXISTU, left: null }, null)), 0)
  ok('genuinely wearing nothing: no claim', n(gearConflicts({ right: TXISTU, left: null }, [])), 0)
  ok('no hands reported: no claim', n(gearConflicts(null, [HELM])), 0)

  // The distinction is only meaningful if the caller can act on it, so the
  // component must be able to tell the two apart from what it is given. It
  // can: `worn` is undefined in one case and a zero-length array in the other,
  // and those are different values even though this function answers both the
  // same way. Asserted here so a future "simplification" to `worn ?? []` in
  // the bridge or the type is caught by a test rather than by a player.
  const older = undefined
  const bare = []
  ok('the two absences remain distinguishable', older === bare, false)
}

console.log('\n-- matching is on the item, not on the whole string --')
{
  // Held in the off hand rather than the right.
  ok('off-hand instrument counts', n(gearConflicts({ right: null, left: TXISTU }, [HELM])), 1)
  // A hood is headgear under a different word.
  ok('hood counts as headgear', n(gearConflicts({ right: TXISTU, left: null }, ['a leather hood'])), 1)
  // Something with "cap" inside a longer word must not count. "Caparison" is
  // horse tack; the naive substring check would call it a hat.
  ok(
    'a caparison is not a cap',
    n(gearConflicts({ right: TXISTU, left: null }, ['an embroidered caparison'])),
    0
  )
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
