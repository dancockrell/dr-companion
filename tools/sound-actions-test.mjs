import { readFileSync } from 'node:fs'

const sound = readFileSync('src/components/game/SoundControls.tsx', 'utf8')
const pinBar = readFileSync('src/components/shared/MapPinBar.tsx', 'utf8')
let failed = 0
const check = (name, pass) => {
  if (!pass) failed++
  console.log(`${pass ? 'OK  ' : 'FAIL'} ${name}`)
}

check('Sound has no focusable zero-opacity row actions', !/opacity-0/.test(sound))
check('Sound row actions carry visible keyboard focus rings', (sound.match(/focus-visible:ring-2/g) ?? []).length >= 4)
check('track add/remove names the target playlist', /targetName/.test(sound) && /aria-label=\{`Remove \$\{t\.title\} from \$\{p\.name\}`\}/.test(sound))
check('favorite and station icon actions have explicit names', /aria-label=\{`Remove \$\{f\.name\}/.test(sound) && /Save \$\{s\.name\} to favorites/.test(sound))
check('playlist deletion requires an explicit named confirmation', /confirm\(`Delete playlist/.test(sound))
check('sound removal actions use delete icons rather than close icons', (sound.match(/<Trash2 className="h-3 w-3"/g) ?? []).length === 3)
check('saved-pin edit is always visible and focus-ringed', !/opacity-0/.test(pinBar) && /Edit \$\{pin\.label\}/.test(pinBar) && /focus-visible:ring-2/.test(pinBar))
check('saved pins use disclosure semantics and Escape returns focus', !/role="menu"/.test(pinBar) && /aria-controls="saved-pins-list"/.test(pinBar) && /triggerRef\.current\?\.focus/.test(pinBar))
check('saved-pin count is grammatical in both its title and accessible name', /savedPinCountLabel/.test(pinBar) && /pins\.length === 1 \? 'pin' : 'pins'/.test(pinBar) && /aria-label=\{savedPinCountLabel\}/.test(pinBar))

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
