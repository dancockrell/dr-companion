import { existsSync, readFileSync } from 'node:fs'

const chat = readFileSync('src/components/room/GameChatColumn.tsx', 'utf8')
const bar = readFileSync('src/components/game/GameConnectionBar.tsx', 'utf8')
const tree = readFileSync('src/App.tsx', 'utf8')
let failed = 0
const check = (name, pass) => {
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
check('a disconnected bar reads the reason rather than only the flag',
  /link\.connected \?[^\n]*: *link\.note/.test(bar) && /!link\.connected/.test(bar))

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
