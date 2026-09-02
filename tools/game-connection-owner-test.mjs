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
check(
  'clearing connection output uses the same destructive icon as other buffer clears',
  /import \{[^}]*Trash2[^}]*\} from 'lucide-react'/.test(bar) &&
    /aria-label="Clear the scrollback"[\s\S]*?<Trash2 aria-hidden="true"/.test(bar) &&
    !/\bEraser\b/.test(bar),
)
check('the obsolete duplicate GamePane implementation is gone', !existsSync('src/components/game/GamePane.tsx'))
check('the live owner retains attach, detach, clear, status and port controls',
  /attachGame/.test(bar) && /detachGame/.test(bar) && /clearGame/.test(bar) && /gameState/.test(bar) && /validPort/.test(bar))
check('the app reaches the game workspace through its current hierarchy', /<GameChatColumn/.test(tree))

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
