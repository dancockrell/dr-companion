import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const taskFlow = read('src/components/dashboard/TaskFlowPanel.tsx')
const scripts = read('src/components/shared/ScriptLibraryPanel.tsx')
const profiles = read('src/components/layout/ProfilesPanel.tsx')
const panel = read('src/components/shared/Panel.tsx')
const map = read('src/components/shared/MapPanel.tsx')
const links = read('src/components/shared/LinksPanel.tsx')
const connection = read('src/components/game/GameConnectionBar.tsx')
const consolePanel = read('src/components/layout/Console.tsx')
const sound = read('src/components/game/SoundControls.tsx')
const music = read('src/components/game/MusicTransport.tsx')

let passed = 0
function check(condition, message) {
  if (!condition) throw new Error(message)
  passed += 1
}

check(taskFlow.includes('Bookmark') && !taskFlow.includes('<Star'), 'task tiles must use Bookmark for the hotbar')
check(scripts.includes('<Bookmark') && !scripts.includes('<Star'), 'script rows must use Bookmark for the hotbar')
check(taskFlow.includes('className="h-3 w-3"') && scripts.includes('className="h-3 w-3"'), 'hotbar bookmarks must share a 12px icon size')
check(sound.includes('<Star') && music.includes('<Star'), 'Star must remain reserved for media favorites')

check(profiles.includes('<CopyPlus') && !profiles.includes('<Copy '), 'profile duplication must use CopyPlus')
check(profiles.includes("Copy this character's settings onto the one you are playing"), 'profile copy must retain its explanatory title')

check(panel.includes('<AppWindow') && !panel.includes('<ExternalLink'), 'in-app panel windows must use AppWindow')
check(map.includes('<AppWindow'), 'map window and generic panel window must share AppWindow')
check(links.includes('<ExternalLink'), 'real outbound links must retain ExternalLink')
check(panel.includes('aria-label="Open in its own window"'), 'panel window action must retain its accessible name')

check(connection.includes('<Trash2 className="h-3.5 w-3.5"') && !connection.includes('<Eraser'), 'game scrollback clear must use the shared 14px Trash2')
check(consolePanel.includes('<Trash2 className="h-3.5 w-3.5"'), 'console clear must use the shared 14px Trash2')
check(connection.includes('aria-label="Clear the scrollback"'), 'scrollback clear must retain its specific accessible name')

console.log(`icon semantics: ${passed} checks passed`)
