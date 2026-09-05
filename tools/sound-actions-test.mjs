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
check('sound removal actions use decorative delete icons rather than close icons', (sound.match(/<Trash2 aria-hidden="true" className="h-3 w-3"/g) ?? []).length === 3)
check('saved-pin edit is always visible and focus-ringed', !/opacity-0/.test(pinBar) && /Edit \$\{pin\.label\}/.test(pinBar) && /focus-visible:ring-2/.test(pinBar))
check('saved pins use disclosure semantics and Escape returns focus', !/role="menu"/.test(pinBar) && /aria-controls="saved-pins-list"/.test(pinBar) && /triggerRef\.current\?\.focus/.test(pinBar))
// This used to also assert the literal `pins.length === 1 ? 'pin' : 'pins'`,
// which is the ternary and not the grammar. Its name says grammar, and the
// grammar is now decided by savedPinsLabel() in mapPins.ts and checked there
// at 0, 1, 2 and 11 by running it - so the mechanism assertion went red on a
// change that made the property it names more true, not less. What is left
// here is this suite's own interest: that the title and the accessible name
// are one computed label rather than two strings that can drift apart.
check('saved-pin count is grammatical in both its title and accessible name', /const savedPinCountLabel = savedPinsLabel\(pins\.length\)/.test(pinBar) && /title=\{`\$\{savedPinCountLabel\} - click to browse`\}/.test(pinBar) && /aria-label=\{savedPinCountLabel\}/.test(pinBar))

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
