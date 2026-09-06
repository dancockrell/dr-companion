/**
 * The intent path's decision half: which `presentation:intent` events become
 * real game commands, and - the half that actually matters for safety -
 * which ones must not.
 *
 * Rust already refuses a walk whose exit is not in the published snapshot,
 * so these checks are not about exit legality. They are about this app not
 * turning a read-only intent (inspect, focus) into an outgoing command, and
 * not sending an empty or whitespace one.
 */
import { gameCommandForIntent, travelTargetForIntent } from '../src/lib/presentationBridge.ts'

let pass = 0
let fail = 0
function ok(what, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`OK   ${what.padEnd(64)} ${detail}`)
  } else {
    fail++
    console.log(`FAIL ${what.padEnd(64)} ${detail}`)
  }
}

console.log('-- walk: the one intent that becomes a game command --')
{
  const a = gameCommandForIntent({ kind: 'walk', fromRoomId: '1-14', exitMove: 'north' })
  ok('a walk becomes a command', a !== null)
  ok('the command is the exit move verbatim, not a rewritten one', a?.command === 'north', String(a?.command))
  ok('it carries a label naming the viewer as the source', /viewer/i.test(a?.label ?? ''), a?.label)

  const b = gameCommandForIntent({ kind: 'walk', fromRoomId: '1-14', exitMove: 'go gate' })
  ok('a multi-word exit ("go gate") survives intact', b?.command === 'go gate', String(b?.command))

  const c = gameCommandForIntent({ kind: 'walk', exitMove: '  climb wall  ' })
  ok('surrounding whitespace is trimmed', c?.command === 'climb wall', JSON.stringify(c?.command))
}

console.log('\n-- the read-only intents must never become a game command --')
{
  ok('inspect-entity sends nothing',
    gameCommandForIntent({ kind: 'inspect-entity', entityId: 'x' }) === null)
  ok('inspect-ground-item sends nothing',
    gameCommandForIntent({ kind: 'inspect-ground-item', itemId: 'x' }) === null)
  ok('travel-to-room sends no game command (it becomes a bridge intent, not typing)',
    gameCommandForIntent({ kind: 'travel-to-room', roomId: '1-14' }) === null)
  // An inspect intent that happened to carry an exitMove must still not walk:
  // the decision keys on kind, never on which fields are present.
  ok('an inspect intent carrying an exitMove still sends nothing',
    gameCommandForIntent({ kind: 'inspect-entity', entityId: 'x', exitMove: 'north' }) === null)
}

console.log('\n-- malformed or unknown intents are dropped, never guessed at --')
{
  ok('an unknown kind sends nothing', gameCommandForIntent({ kind: 'teleport-to-moon' }) === null)
  ok('no kind at all sends nothing', gameCommandForIntent({}) === null)
  ok('a walk with no exitMove sends nothing', gameCommandForIntent({ kind: 'walk' }) === null)
  ok('a walk with an empty exitMove sends nothing',
    gameCommandForIntent({ kind: 'walk', exitMove: '' }) === null)
  ok('a walk with a whitespace-only exitMove sends nothing',
    gameCommandForIntent({ kind: 'walk', exitMove: '   ' }) === null)
}

console.log('\n-- travel-to-room: the click on a distant tile, and the id it must send --')
{
  // Issue #444. A cell id is `${zoneId}-${roomId}`; `map_walk` takes Lich's
  // bare room number. Getting this wrong does not fail loudly - it walks the
  // character to a real room nobody asked for - so the wrong answers are all
  // made available here rather than only the right one.
  ok('a cell id resolves to the room number after its last hyphen',
    travelTargetForIntent({ kind: 'travel-to-room', roomId: '1-14' }) === 14,
    String(travelTargetForIntent({ kind: 'travel-to-room', roomId: '1-14' })))
  ok('the zone half is not what is sent',
    travelTargetForIntent({ kind: 'travel-to-room', roomId: '1-14' }) !== 1)
  ok('a hyphen in the zone id does not change which half is the room',
    travelTargetForIntent({ kind: 'travel-to-room', roomId: 'zone-7-903' }) === 903,
    String(travelTargetForIntent({ kind: 'travel-to-room', roomId: 'zone-7-903' })))
  ok('a large room number survives intact',
    travelTargetForIntent({ kind: 'travel-to-room', roomId: '1-17750' }) === 17750)

  ok('a walk intent is not a travel request',
    travelTargetForIntent({ kind: 'walk', fromRoomId: '1-14', exitMove: 'north' }) === null)
  ok('an inspect intent carrying a roomId is still not a travel request',
    travelTargetForIntent({ kind: 'inspect-entity', entityId: 'x', roomId: '1-14' }) === null)
  ok('the superseded focus-room kind travels nowhere',
    travelTargetForIntent({ kind: 'focus-room', roomId: '1-14' }) === null)

  // Everything that does not leave a whole positive number. `Number('')` is 0
  // and `parseInt('12abc')` is 12; either would send the character somewhere.
  for (const bad of ['', '1-', '-14', '1-abc', '1-12abc', '1-1.5', '1--', 'nohyphen', '1- 14', '1-0']) {
    ok(`a room id of ${JSON.stringify(bad)} travels nowhere`,
      travelTargetForIntent({ kind: 'travel-to-room', roomId: bad }) === null,
      String(travelTargetForIntent({ kind: 'travel-to-room', roomId: bad })))
  }
  // Not a malformed id: `1--3` is zone `1-` and room 3, and splitting at the
  // last hyphen is what makes that readable. Kept because it is the case the
  // "split at the first hyphen" version would have got wrong.
  ok('a zone id that itself ends in a hyphen still resolves its room',
    travelTargetForIntent({ kind: 'travel-to-room', roomId: '1--3' }) === 3,
    String(travelTargetForIntent({ kind: 'travel-to-room', roomId: '1--3' })))
  ok('a missing roomId travels nowhere',
    travelTargetForIntent({ kind: 'travel-to-room' }) === null)
}

console.log('')
// `pass + fail`, not `pass`: the denominator has to be the number of checks
// that ran, or it shrinks by one per failure and the line reports a smaller
// suite on exactly the run where you need to know the size did not change.
console.log(`${pass + fail} checked, ${fail} failed`)
// Set well below the real count (14 at time of writing): this exists to
// catch a suite that crashed partway or never ran, not to be re-tuned every
// time a check is added.
const MIN_EXPECTED_CHECKS = 10
if (pass + fail < MIN_EXPECTED_CHECKS) {
  console.error(
    `FAILED: only ${pass + fail} checks ran, expected at least ${MIN_EXPECTED_CHECKS} - the suite did not finish`
  )
  process.exit(1)
}
if (fail > 0) {
  console.error('FAILED')
  process.exit(1)
}
console.log('all passed')
