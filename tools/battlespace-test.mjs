import { readFileSync } from 'node:fs'

let failures = 0
function check(label, value) {
  if (value) console.log(`OK   ${label}`)
  else { console.error(`FAIL ${label}`); failures += 1 }
}

const battle = readFileSync(new URL('../src/components/room/BattleColumn.tsx', import.meta.url), 'utf8')
const actions = readFileSync(new URL('../src/components/room/BattleActionBar.tsx', import.meta.url), 'utf8')
const chat = readFileSync(new URL('../src/components/room/GameChatColumn.tsx', import.meta.url), 'utf8')
const radar = readFileSync(new URL('../src/components/shared/CombatRadar.tsx', import.meta.url), 'utf8')
const scene = readFileSync(new URL('../src/components/room/RoomScene.tsx', import.meta.url), 'utf8')

check('the battle scene uses a landscape tactical field', /shape="landscape"/.test(battle) && /aspect-\[4\/3\]/.test(scene))
check('room details and inventory receive the remaining useful height', /min-h-\[13rem\][^"']*flex-1/.test(battle))
check('the full room description is permanently below the battle', /aria-label="Room description"/.test(battle) && /<ClassicRoomText/.test(battle))
check('inventory is permanently visible beside the room description', /aria-label="Inventory"/.test(battle) && /<InventoryPanel/.test(battle))
check('combat controls use the complete grouped macro catalog', /MACROS\.filter/.test(actions) && /'combat'/.test(actions) && /'goods'/.test(actions) && /'magic'/.test(actions))
check('every combat variation is a directly wired compact icon button', /macro\.variations\.map/.test(actions) && /onClick=\{\(\) => run\(variation\.commands\)\}/.test(actions) && /h-9 w-9/.test(actions))
check('tasks overlay rather than permanently split the game stream', /absolute inset-0/.test(chat) && /<StreamTabs/.test(chat) && /<TaskFlowPanel/.test(chat))
check('the radar has persistent grab-scroll enemy and friendly columns', /label="Enemies"/.test(radar) && /label="Friends"/.test(radar) && /Scrollable friendly and enemy radar columns/.test(radar) && /side="left"/.test(radar) && /side="right"/.test(radar) && /useDragScroll/.test(radar))
check('room art is the fixed base layer underneath the tactical radar', /aria-label="Room art"/.test(scene) && /absolute inset-0 z-0/.test(scene) && /aria-label="Tactical radar over room art"/.test(scene) && /absolute inset-0 z-10/.test(scene))
check('room exits are always wired from live compass or mapped movement commands', /stream\.compass\?\.value \?\? here\?\.moves/.test(battle))

if (failures) process.exit(1)
console.log('\nall battlespace checks passed')
