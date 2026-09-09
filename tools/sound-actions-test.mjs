import { readFileSync } from 'node:fs'

/*
 * Three checks on `MapPinBar.tsx` stood alongside the sound controls here,
 * because the two shared a disclosure pattern and the saved-pin count's
 * grammar. The pin bar was a map control and is gone (docs/NO-3D.md).
 *
 * `savedPinsLabel` itself is still tested, in tools/pins-test.mjs, and pins
 * are still written by Lich scripts and by the AI claims panel - so the
 * grammar still matters even with nothing drawing it today.
 */
const sound = readFileSync('src/components/game/SoundControls.tsx', 'utf8')
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
// This used to also assert the literal `pins.length === 1 ? 'pin' : 'pins'`,
// which is the ternary and not the grammar. Its name says grammar, and the
// grammar is now decided by savedPinsLabel() in mapPins.ts and checked there
// at 0, 1, 2 and 11 by running it - so the mechanism assertion went red on a
// change that made the property it names more true, not less. What is left
// here is this suite's own interest: that the title and the accessible name
// are one computed label rather than two strings that can drift apart.

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
