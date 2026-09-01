/**
 * Visually reviewed landscape scenes from the Grok source pack.  This is the
 * only generic room-art pool: older local renders must not leak back in as
 * fallback filler.  Nearby rooms hold the same scene for three room numbers,
 * giving movement a readable visual rhythm instead of a per-room slot machine.
 */
const HOLD_ROOMS = 3

const GROK_SCENES = {
  forest: ['/grok-art/room-scenes/forest-sunlit-0261ab7e.jpg', '/grok-art/room-scenes/forest-clearing-06aeb546.jpg'],
  water: ['/grok-art/room-scenes/marsh-dusk-025a5488.jpg', '/grok-art/room-scenes/lantern-dock-02798b8e.jpg', '/grok-art/room-scenes/reed-marsh-0fb4267f.jpg'],
  ocean: ['/grok-art/room-scenes/storm-ocean-10d4c18a.jpg', '/grok-art/room-scenes/lighthouse-coast-0ee0be16.jpg'],
  cave: ['/grok-art/room-scenes/sea-cave-038edbd8.jpg'],
  mine: ['/grok-art/room-scenes/crystal-mine-3638b938.jpg'],
  mountain: ['/grok-art/room-scenes/cliff-monastery-0183963f.jpg', '/grok-art/room-scenes/mountain-bridge-05a1ad18.jpg'],
  snow: ['/grok-art/room-scenes/snowfield-0d5df7bf.jpg', '/grok-art/room-scenes/alpine-lake-108392d4.jpg'],
  desert: ['/grok-art/room-scenes/desert-canyon-0322415e.jpg'],
  temple: ['/grok-art/room-scenes/shrine-interior-0f2de22b.jpg'],
  apothecary: ['/grok-art/room-scenes/herbalist-ab006279.jpg', '/grok-art/room-scenes/apothecary-09cdec8e.jpg'],
  jeweler: ['/grok-art/room-scenes/jeweler-35a7845f.jpg'],
  magicShop: ['/grok-art/room-scenes/magic-shop-4ef50ab1.jpg'],
  archive: ['/grok-art/room-scenes/archive-494b55cb.jpg'],
  theater: ['/grok-art/room-scenes/theater-4013bf56.jpg'],
  training: ['/grok-art/room-scenes/training-hall-650f2679.jpg'],
  guildHall: ['/grok-art/room-scenes/guild-hall-441c3d78.jpg'],
  forge: ['/grok-art/room-scenes/forge-11c9cd64.jpg'],
  outfitter: ['/grok-art/room-scenes/leather-workshop-1390477d.jpg'],
  tailor: ['/grok-art/room-scenes/textile-shop-1eed98c2.jpg'],
  harbor: ['/grok-art/room-scenes/working-harbor-1d61dd6a.jpg'],
  grassland: ['/grok-art/room-scenes/storm-grassland-22f4384f.jpg'],
  orchard: ['/grok-art/room-scenes/apple-orchard-23efadaf.jpg'],
  courtyard: ['/grok-art/room-scenes/lantern-courtyard-2340613e.jpg'],
  ruins: ['/grok-art/room-scenes/woodland-ruins-2c3975b0.jpg'],
  town: ['/grok-art/room-scenes/night-market-04c61394.jpg', '/grok-art/room-scenes/town-square-2650911f.jpg'],
  treeTown: ['/grok-art/room-scenes/tree-city-04b6c4bd.jpg'],
} as const

type SceneFamily = keyof typeof GROK_SCENES

function familyFor(description: string): SceneFamily {
  if (/\b(treehouse|treetop|canopy|wood elf|leth deriel)\b/i.test(description)) return 'treeTown'
  if (/\b(apothecary|alchemy|alchemist|potion|herb shop|herbalist)\b/i.test(description)) return 'apothecary'
  if (/\b(magic shop|enchanter|enchanting|artificer|arcane shop|crystal shop|magical supplies)\b/i.test(description)) return 'magicShop'
  if (/\b(jeweler|jeweller|gem shop|gemcutter|goldsmith|silversmith)\b/i.test(description)) return 'jeweler'
  if (/\b(theater|theatre|stage|playhouse|auditorium|performance hall|music hall)\b/i.test(description)) return 'theater'
  if (/\b(training hall|practice hall|sparring room|sparring ring|combat academy|weapon practice)\b/i.test(description)) return 'training'
  if (/\b(library|archive|scriptorium|scribe|scroll room|reading room)\b/i.test(description)) return 'archive'
  if (/\b(bank|guildhall|guild hall|council hall|registry|public office|teller)\b/i.test(description)) return 'guildHall'
  if (/\b(mine|mineshaft|mining|ore|quarry|crystal cavern|crystal cave)\b/i.test(description)) return 'mine'
  if (/\b(forge|smithy|blacksmith|anvil|foundry)\b/i.test(description)) return 'forge'
  if (/\b(tailor|seamstress|clothier|weaver|textile|fabric|dye shop)\b/i.test(description)) return 'tailor'
  if (/\b(outfitter|tannery|leather|armorer|armor shop)\b/i.test(description)) return 'outfitter'
  if (/\b(courtyard|enclosed garden|walled garden|cloister)\b/i.test(description)) return 'courtyard'
  if (/\b(ruin|ruined|ancient columns|fallen temple|crumbling shrine)\b/i.test(description)) return 'ruins'
  if (/\b(temple|shrine|altar|chapel|sanctum|holy place)\b/i.test(description)) return 'temple'
  if (/\b(cave|cavern|grotto|tunnel|underground|crypt|tomb|sewer)\b/i.test(description)) return 'cave'
  if (/\b(desert|sand|dune|arid|badland|waste)\b/i.test(description)) return 'desert'
  if (/\b(snow|ice|frozen|frost|glacier|wintry|blizzard)\b/i.test(description)) return 'snow'
  if (/\b(mountain|cliff|ridge|summit|peak|highland|ascent|outcrop)\b/i.test(description)) return 'mountain'
  if (/\b(ocean|open sea|stormy sea|lighthouse|sea cliff)\b/i.test(description)) return 'ocean'
  if (/\b(harbor|harbour|wharf|quay|shipyard|boathouse|ferry landing)\b/i.test(description)) return 'harbor'
  if (/\b(water|river|sea|lake|shore|bay|dock|pier|marsh|swamp|bog|fen|wave|tide|reed)\b/i.test(description)) return 'water'
  if (/\b(orchard|apple grove|fruit tree|farmstead|farm yard)\b/i.test(description)) return 'orchard'
  if (/\b(grassland|prairie|plain|meadow|pasture|open field|savanna)\b/i.test(description)) return 'grassland'
  if (/\b(forest|tree|wood|grove|thicket|leaf|leaves|bough|bosk|tangle)\b/i.test(description)) return 'forest'
  return 'town'
}
function stableIndex(zone: string, room: number, length: number): number {
  let zoneHash = 0
  for (const char of zone) zoneHash = Math.imul(zoneHash, 31) + char.charCodeAt(0)
  return Math.abs(zoneHash + Math.floor(room / HOLD_ROOMS)) % length
}

export function grokRoomScene(zone: string, room: number, title?: string | null, text?: string | null): string {
  const family = familyFor(`${title ?? ''} ${text ?? ''}`)
  const pool = GROK_SCENES[family]
  return pool[stableIndex(zone, room, pool.length)]
}
