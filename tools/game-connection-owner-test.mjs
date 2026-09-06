import { existsSync, readFileSync } from 'node:fs'

const chat = readFileSync('src/components/room/GameChatColumn.tsx', 'utf8')
const bar = readFileSync('src/components/game/GameConnectionBar.tsx', 'utf8')
const tree = readFileSync('src/App.tsx', 'utf8')
let checked = 0
let failed = 0
const check = (name, pass) => {
  checked++
  if (!pass) failed++
  console.log(`${pass ? 'OK  ' : 'FAIL'} ${name}`)
}

check('the connection bar is mounted in the live game workspace', /<GameConnectionBar/.test(chat))
check('the obsolete duplicate GamePane implementation is gone', !existsSync('src/components/game/GamePane.tsx'))
check('the live owner retains attach, detach, clear, status and port controls',
  /attachGame/.test(bar) && /detachGame/.test(bar) && /clearGame/.test(bar) && /gameState/.test(bar) && /validPort/.test(bar))
check('the app reaches the game workspace through its current hierarchy', /<GameChatColumn/.test(tree))

// The display half of "a dropped socket leaves the pane saying disconnected".
// tools/backlog-test.mjs proves gameState() flips and carries the backend's
// reason; that is worth nothing if the bar renders a bare flag and leaves the
// reason unread, which is the failure this repo has already paid for once - a
// header offering Attach while game text poured into the pane behind it.
//
// Rewritten for issue #501, and deliberately: the old body matched the exact
// expression `link.connected ? ... : link.note`, which is a mechanism, and the
// name above is a property. Those came apart the moment this bar was made to
// read `linkPhase` like every other consumer of the link - the reason is still
// rendered, the flag is no longer tested inline, and the old regex went red at
// the change that made its own name MORE true. A test whose name is right and
// whose body pins the implementation defends the defect: the honest-looking
// move when it reddens is to put the inline test back.
//
// So this asserts the property twice over: the reason reaches the screen, and
// the bar does not decide "connected" for itself. The second half is what
// #501 was actually about; the whole consumer census that enforces it lives in
// tools/link-reconnect-test.mjs, and this is the one file's share of it.
check('a disconnected bar reads the reason rather than only the flag',
  /link\.note/.test(bar) && /linkPhase\(/.test(bar))
check('and reads the connection through linkPhase rather than testing the flag inline',
  !/link\.connected/.test(bar.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')))

console.log('')
// Far below the real count on purpose: a tripwire for a truncated or
// half-loaded run, not a regression test on the number of cases.
const MIN_EXPECTED = 3
if (checked < MIN_EXPECTED) {
  console.error(`FAILED: only ${checked} checks ran, expected at least ${MIN_EXPECTED}`)
  process.exit(1)
}
// `checked`, not a pass count: the denominator has to be the number of
// checks that ran, or it shrinks by one per failure and reports a smaller
// suite on exactly the run where you need to know the size did not change.
console.log(`${checked} checked, ${failed} failed`)
if (failed) {
  console.error('FAILED')
  process.exit(1)
}
console.log('all passed')
process.exit(0)
