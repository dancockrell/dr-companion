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
import { gameCommandForIntent } from '../src/lib/presentationBridge.ts'

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
  ok('focus-room sends nothing (Godot already has every cell position)',
    gameCommandForIntent({ kind: 'focus-room', roomId: '1-14' }) === null)
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

console.log('')
console.log(`${pass} checked, ${fail} failed`)
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
