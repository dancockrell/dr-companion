import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const taskFlow = read('src/components/dashboard/TaskFlowPanel.tsx')
const scripts = read('src/components/shared/ScriptLibraryPanel.tsx')
const profiles = read('src/components/layout/ProfilesPanel.tsx')
const panel = read('src/components/shared/Panel.tsx')
const links = read('src/components/shared/LinksPanel.tsx')
const connection = read('src/components/game/GameConnectionBar.tsx')
const consolePanel = read('src/components/layout/Console.tsx')
const sound = read('src/components/game/SoundControls.tsx')
const music = read('src/components/game/MusicTransport.tsx')

let checked = 0
let failed = 0
function check(condition, message) {
  checked += 1
  // A failure here is fatal by design: this file throws rather than
  // continuing, so the run stops on the first wrong icon. `failed` therefore
  // only ever reaches 1, and exists so the count line below has the same
  // shape as every other suite's.
  if (!condition) {
    failed += 1
    console.log(`FAIL ${message}`)
    throw new Error(message)
  }
  console.log(`OK   ${message}`)
}

check(taskFlow.includes('Bookmark') && !taskFlow.includes('<Star'), 'task tiles must use Bookmark for the hotbar')
check(scripts.includes('<Bookmark') && !scripts.includes('<Star'), 'script rows must use Bookmark for the hotbar')
check(taskFlow.includes('className="h-3 w-3"') && scripts.includes('className="h-3 w-3"'), 'hotbar bookmarks must share a 12px icon size')
check(sound.includes('<Star') && music.includes('<Star'), 'Star must remain reserved for media favorites')

check(profiles.includes('<CopyPlus') && !profiles.includes('<Copy '), 'profile duplication must use CopyPlus')
check(profiles.includes("Copy this character's settings onto the one you are playing"), 'profile copy must retain its explanatory title')

check(panel.includes('<AppWindow') && !panel.includes('<ExternalLink'), 'in-app panel windows must use AppWindow')
// `MapPanel.tsx` was checked here for using `<AppWindow` rather than an
// external-link icon on its pop-out button. It is gone with the map
// (docs/NO-3D.md), and no surviving panel carries a pop-out button of its
// own - `Dashboard.tsx` owns the only one. Removed rather than repointed:
// the assertion was about that button, and repointing it at a file that
// does not have one would be a check that cannot fail.
check(links.includes('<ExternalLink'), 'real outbound links must retain ExternalLink')
check(panel.includes('aria-label="Open in its own window"'), 'panel window action must retain its accessible name')

check(connection.includes('<Trash2 className="h-3.5 w-3.5"') && !connection.includes('<Eraser'), 'game scrollback clear must use the shared 14px Trash2')
check(consolePanel.includes('<Trash2 className="h-3.5 w-3.5"'), 'console clear must use the shared 14px Trash2')
check(connection.includes('aria-label="Clear the scrollback"'), 'scrollback clear must retain its specific accessible name')

console.log('')
// Far below the real count on purpose: a tripwire for a truncated or
// half-loaded run, not a regression test on the number of cases.
const MIN_EXPECTED = 9
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
