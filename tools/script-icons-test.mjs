/**
 * inferScriptIcon (scriptIcons.ts) - the icon guess for Lich scripts and any
 * unrecognised Python task. Its only import is `SCRIPT_ICON_KEYS` from the
 * same file, no lucide/React, so Node's native TS type-stripping can import
 * it directly - see the file's own header comment for why it's split from
 * scriptIconComponents.ts in the first place.
 */
import { inferScriptIcon, SCRIPT_ICON_KEYS } from '../src/lib/scriptIcons.ts'

let failed = 0
let checked = 0
const ok = (name, cond, detail = '') => {
  checked++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
  if (!cond) failed++
}

console.log('-- matches drawn from the real corpus (C:\\Ruby4Lich5\\Lich5\\scripts) --')
const cases = [
  ['bankbot', '', 'landmark'],
  ['sell-loot', '', 'coins'],
  ['accept-sell', '', 'coins'],
  ['craft', '', 'hammer'],
  ['smith', '', 'anvil'],
  ['mining-buddy', '', 'pickaxe'],
  ['chop-wood', '', 'trees'],
  ['create_remedies', '', 'flask-conical'],
  ['alchemy', '', 'flask-conical'],
  ['combat-trainer', '', 'sword'],
  ['hunting-buddy', '', 'sword'],
  // Genuinely ambiguous: "remedy" is crafted (create_remedies) as often as
  // it's administered (tendme, heal-remedy). flask-conical is checked
  // before heart-pulse, so the crafting reading wins for any name carrying
  // "remed" - a defensible tie-break, not a bug, and this pins it down so a
  // future reorder is a deliberate choice rather than a silent flip.
  ['heal-remedy', '', 'flask-conical'],
  ['tendme', '', 'heart-pulse'],
  ['automap', '', 'map'],
  ['go2', '', 'compass'],
  ['burgle', '', 'unlock'],
  ['lockbox', '', 'lock'],
  ['vanity-pet', '', 'paw-print'],
  ['bug-grabber', '', 'paw-print'],
  ['bard-whistle', '', 'music'],
  ['boggle_blast', '', 'dice-5'],
  ['cleric-quests', '', 'puzzle'],
  ['inventory-manager', '', 'backpack'],
  ['sell-pouches', '', 'coins'],
  ['journal', '', 'book-open'],
  ['status-monitor', '', 'activity'],
  ['setupaliases', '', 'settings'],
  ['lich5-update', '', 'refresh-cw'],
  ['companion_bridge', '', 'cable'],
]
for (const [name, summary, expected] of cases) {
  const got = inferScriptIcon(name, summary)
  ok(`${name} -> ${expected}`, got === expected, `got ${got}`)
}

console.log('')
console.log('-- summary text is checked too, not just the name --')
ok(
  'a name with no signal but a summary that has one still matches',
  inferScriptIcon('multi', 'Sells items to the nearest shop.') === 'coins'
)

console.log('')
console.log('-- specificity: money words beat generic craft/bot words on the same name --')
// bankbot contains "bot," which matches nothing craft-related, but this
// guards the ordering assumption directly: bank-flavoured words are checked
// before the generic categories, so a name that could plausibly read as
// several things lands on the most specific one.
ok('bankbot reads as a bank, not a generic watcher', inferScriptIcon('bankbot', '') === 'landmark')

console.log('')
console.log('-- nothing recognisable falls back to the generic icon, not a wrong guess --')
ok(
  'a name matching no pattern at all falls back to gem',
  inferScriptIcon('xz19_q', '') === 'gem'
)
ok('an empty name and summary also falls back to gem', inferScriptIcon('', '') === 'gem')

console.log('')
console.log('-- every returned key is a real key, never a typo --')
const keys = new Set(SCRIPT_ICON_KEYS)
const allNames = [...cases.map((c) => c[0]), 'multi', 'bankbot', 'xz19_q', '']
let badKey = null
for (const name of allNames) {
  const k = inferScriptIcon(name, '')
  if (!keys.has(k)) {
    badKey = k
    break
  }
}
ok('no case produced a key outside SCRIPT_ICON_KEYS', badKey === null, String(badKey))

console.log('')
console.log('-- case-insensitive, since real script names are lowercase but summaries are not --')
ok(
  'a capitalised summary still matches',
  inferScriptIcon('multi', 'Automatically Sells your loot at the Bank.') === 'landmark'
)

console.log('')
ok('enough was checked for a pass to mean something', checked >= 35, `${checked} assertions`)

console.log('')
console.log(failed === 0 ? 'all passed' : `${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
