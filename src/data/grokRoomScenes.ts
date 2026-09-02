/**
 * Visually reviewed landscape scenes from the Grok source pack.  This is the
 * only generic room-art pool: older local renders must not leak back in as
 * fallback filler. When the description does not support a family, the
 * selector returns no literal scene so the caller can keep the honest room
 * fingerprint instead of presenting a confident but invented location.
 */
const GROK_SCENES = {
  forest: [
    '/grok-art/room-scenes/deep-forest-sunbeams-403f52df.jpg',
    '/grok-art/room-scenes/ancient-forest-36342832.jpg',
    '/grok-art/room-scenes/young-woodland-2d872f5f.jpg',
    '/grok-art/room-scenes/moonlit-forest-road-9c594ba5.jpg',
  ],
  water: [
    '/grok-art/room-scenes/marsh-dusk-025a5488.jpg',
    '/grok-art/room-scenes/lantern-dock-02798b8e.jpg',
    '/grok-art/room-scenes/reed-marsh-0fb4267f.jpg',
    '/grok-art/room-scenes/autumn-mountain-stream-44d208fc.jpg',
    '/grok-art/room-scenes/wetland-pier-dawn-2f9d3487.jpg',
  ],
  ocean: ['/grok-art/room-scenes/storm-ocean-10d4c18a.jpg', '/grok-art/room-scenes/lighthouse-coast-0ee0be16.jpg'],
  cave: ['/grok-art/room-scenes/catacomb-vault-86126f69.jpg'],
  mine: ['/grok-art/room-scenes/crystal-mine-3638b938.jpg'],
  mountain: [
    '/grok-art/room-scenes/mountain-meadow-84245eb6.jpg',
    '/grok-art/room-scenes/cliff-valley-e8aa1349.jpg',
  ],
  snow: [
    '/grok-art/room-scenes/snowfield-0d5df7bf.jpg',
    '/grok-art/room-scenes/alpine-lake-108392d4.jpg',
    '/grok-art/room-scenes/windswept-snowfield-93cbec8e.jpg',
    '/grok-art/room-scenes/frozen-city-8ac67c07.jpg',
  ],
  temple: ['/grok-art/room-scenes/shrine-interior-0f2de22b.jpg'],
  apothecary: ['/grok-art/room-scenes/herbalist-ab006279.jpg', '/grok-art/room-scenes/apothecary-09cdec8e.jpg'],
  jeweler: ['/grok-art/room-scenes/jeweler-35a7845f.jpg'],
  magicShop: ['/grok-art/room-scenes/magic-shop-4ef50ab1.jpg'],
  archive: ['/grok-art/room-scenes/archive-494b55cb.jpg'],
  theater: ['/grok-art/room-scenes/theater-4013bf56.jpg'],
  training: ['/grok-art/room-scenes/training-hall-650f2679.jpg'],
  guildHall: ['/grok-art/room-scenes/guild-hall-441c3d78.jpg'],
  healerWard: ['/grok-art/room-scenes/healer-ward-f3a8421c.jpg'],
  armory: ['/grok-art/room-scenes/armory-7142832a.jpg'],
  locksmith: ['/grok-art/room-scenes/locksmith-ee33bafb.jpg'],
  forge: ['/grok-art/room-scenes/forge-11c9cd64.jpg'],
  outfitter: ['/grok-art/room-scenes/leather-workshop-1390477d.jpg'],
  tailor: ['/grok-art/room-scenes/textile-shop-1eed98c2.jpg'],
  harbor: [
    '/grok-art/room-scenes/working-harbor-1d61dd6a.jpg',
    '/grok-art/room-scenes/working-river-docks-174a62c2.jpg',
    '/grok-art/room-scenes/riverside-timber-town-5707fe76.jpg',
    '/grok-art/room-scenes/lantern-pier-night-3f16f5eb.jpg',
    '/grok-art/room-scenes/covered-pier-night-ba01d7e4.jpg',
  ],
  grassland: ['/grok-art/room-scenes/storm-grassland-22f4384f.jpg', '/grok-art/room-scenes/mountain-meadow-84245eb6.jpg'],
  orchard: ['/grok-art/room-scenes/apple-orchard-23efadaf.jpg'],
  courtyard: ['/grok-art/room-scenes/lantern-courtyard-2340613e.jpg', '/grok-art/room-scenes/glasshouse-garden-4d19a989.jpg'],
  ruins: [
    '/grok-art/room-scenes/woodland-ruins-2c3975b0.jpg',
    '/grok-art/room-scenes/ancient-field-ruins-9bf266af.jpg',
    '/grok-art/room-scenes/standing-stone-glade-8d15e0af.jpg',
  ],
  town: [
    '/grok-art/room-scenes/town-square-2650911f.jpg',
    '/grok-art/room-scenes/rainy-city-alley-72b7a786.jpg',
  ],
  bridge: [
    '/grok-art/room-scenes/lantern-bridge-night-5dbfe8ff.jpg',
    '/grok-art/room-scenes/stone-bridge-lanterns-dee585d4.jpg',
  ],
  vineyard: ['/grok-art/room-scenes/vineyard-lantern-road-3734f583.jpg'],
  islandVillage: ['/grok-art/room-scenes/tropical-island-village-d6fb2276.jpg'],
  forestHut: ['/grok-art/room-scenes/forest-hut-6bc5be5d.jpg'],
} as const

type SceneFamily = keyof typeof GROK_SCENES

export function familyFor(description: string): SceneFamily | null {
  if (/\b(treehouse|treetop|canopy|wood elf|leth deriel)\b/i.test(description)) return 'forest'
  if (/\b(tropical village|island village|island settlement|palm village)\b/i.test(description)) return 'islandVillage'
  if (/\b(forest hut|woodland hut|ranger hut|hunter's hut|hunters' hut)\b/i.test(description)) return 'forestHut'
  // A named street remains a street even when its name contains a service.
  // Without this guard, Crossing's Bank Street confidently displayed a bank
  // interior because specialist words intentionally outrank generic town art.
  if (/\b(bank street|bank road|bank avenue|bank boulevard|bank lane|bank alley)\b/i.test(description)) return 'town'
  if (/\b((river|stream|creek|brook|canal|waterway|lakeshore|marsh) bank|(east|west|north|south|far|near|opposite) bank)\b/i.test(description)) return 'water'
  if (/\b(guildleader|guildmaster|society master's office|master's office|official office|records office|public office|registry|bank|teller)\b/i.test(description)) return 'guildHall'
  if (/\b(hospital|infirmary|healing ward|healer's ward|treatment room|sickroom|clinic)\b/i.test(description)) return 'healerWard'
  if (/\b(armory|armoury|arms room|weapon storehouse|weapon racks?)\b/i.test(description)) return 'armory'
  if (/\b(locksmith|lock shop|lockpick shop|lockpicking workshop)\b/i.test(description)) return 'locksmith'
  if (/\b(tannery|tanner's shop|tanning room|tanning workshop)\b/i.test(description)) return 'outfitter'
  if (/\b(carpet shop|carpet merchant|rug shop|rug merchant)\b/i.test(description)) return 'tailor'
  if (/\b(glove shop|glover's shop|glove merchant)\b/i.test(description)) return 'tailor'
  if (/\b(apothecary|alchemy|alchemist|potion|herb shop|herbalist)\b/i.test(description)) return 'apothecary'
  if (/\b(magic shop|enchanter|enchanting|artificer|arcane shop|crystal shop|magical supplies)\b/i.test(description)) return 'magicShop'
  if (/\b(jeweler|jeweller|gem shop|gemcutter|goldsmith|silversmith)\b/i.test(description)) return 'jeweler'
  if (/\b(theater|theatre|stage|playhouse|auditorium|performance hall|music hall)\b/i.test(description)) return 'theater'
  if (/\b(training hall|practice hall|sparring room|sparring ring|combat academy|weapon practice)\b/i.test(description)) return 'training'
  if (/\b(library|archive|scriptorium|scribe|scroll room|reading room)\b/i.test(description)) return 'archive'
  if (/\b(guild|guildhall|guild hall|council hall)\b/i.test(description)) return 'guildHall'
  if (/\b(mine|mineshaft|mining|ore|quarry|crystal cavern|crystal cave)\b/i.test(description)) return 'mine'
  if (/\b(forge|smithy|blacksmith|anvil|foundry)\b/i.test(description)) return 'forge'
  if (/\b(tailor|seamstress|clothier|weaver|textile|fabric|dye shop)\b/i.test(description)) return 'tailor'
  if (/\b(outfitter|tannery|leather|armorer|armor shop)\b/i.test(description)) return 'outfitter'
  if (/\b(courtyard|enclosed garden|walled garden|cloister)\b/i.test(description)) return 'courtyard'
  if (/\b(vineyard|grapevine|grape vines|wine road)\b/i.test(description)) return 'vineyard'
  if (/\b(ruin|ruined|ancient columns|fallen temple|crumbling shrine)\b/i.test(description)) return 'ruins'
  if (/\b(temple|shrine|altar|chapel|sanctum|holy place)\b/i.test(description)) return 'temple'
  if (/\b(cave|cavern|grotto|tunnel|underground|crypt|tomb|sewer)\b/i.test(description)) return 'cave'
  if (/\b(snow|ice|frozen|frost|glacier|wintry|blizzard)\b/i.test(description)) return 'snow'
  if (/\b(mountain|cliff|ridge|summit|peak|highland|ascent|outcrop)\b/i.test(description)) return 'mountain'
  if (/\b(ocean|open sea|stormy sea|lighthouse|sea cliff)\b/i.test(description)) return 'ocean'
  if (/\b(harbor|harbour|wharf|quay|shipyard|boathouse|ferry landing)\b/i.test(description)) return 'harbor'
  if (/\b(bridge|causeway|viaduct)\b/i.test(description)) return 'bridge'
  if (/\b(water|river|sea|lake|shore|bay|dock|pier|marsh|swamp|bog|fen|wave|tide|reed)\b/i.test(description)) return 'water'
  if (/\b(orchard|apple grove|fruit tree|farmstead|farm yard)\b/i.test(description)) return 'orchard'
  if (/\b(grassland|prairie|plain|meadow|pasture|open field|savanna)\b/i.test(description)) return 'grassland'
  if (/\b(forest|tree|wood|grove|thicket|leaf|leaves|bough|bosk|tangle)\b/i.test(description)) return 'forest'
  if (/\b(town square|night market|market square|village square|city plaza|town plaza|street|avenue|boulevard|city road|town road|alley)\b/i.test(description)) return 'town'
  return null
}

/**
 * Room prose is supporting evidence, not a reliable subject label. Keep its
 * fallback vocabulary environmental so incidental furnishings such as a
 * leather chair, an anvil-shaped ornament, or a shelf of books cannot turn a
 * private office into a workshop, forge, or archive.
 */
function familyForProse(description: string): SceneFamily | null {
  if (/\b(treehouse|treetop settlement|canopy settlement|leth deriel)\b/i.test(description)) return 'forest'
  if (/\b(tropical village|island village|island settlement|palm village)\b/i.test(description)) return 'islandVillage'
  if (/\b(forest hut|woodland hut|ranger hut|hunter's hut|hunters' hut)\b/i.test(description)) return 'forestHut'
  if (/\b(vineyard|grapevine|grape vines|wine road)\b/i.test(description)) return 'vineyard'
  if (/\b(ruins?|ruined temple|ancient columns|crumbling shrine)\b/i.test(description)) return 'ruins'
  if (/\b(cave|cavern|grotto|underground tunnel|crypt|catacomb|tomb|sewer)\b/i.test(description)) return 'cave'
  if (/\b(snowfield|snow-covered|ice field|frozen lake|glacier|blizzard)\b/i.test(description)) return 'snow'
  if (/\b(mountain|cliff|ridge|summit|highland|mountain pass)\b/i.test(description)) return 'mountain'
  if (/\b(ocean|open sea|stormy sea|lighthouse|sea cliff)\b/i.test(description)) return 'ocean'
  if (/\b(harbor|harbour|wharf|quay|shipyard|boathouse|ferry landing)\b/i.test(description)) return 'harbor'
  if (/\b(stone bridge|wooden bridge|rope bridge|causeway|viaduct)\b/i.test(description)) return 'bridge'
  if (/\b(river|lakeshore|shoreline|marsh|swamp|bog|fen|tidal water|reed bed)\b/i.test(description)) return 'water'
  if (/\b(orchard|apple grove|fruit trees?|farmstead|farm yard)\b/i.test(description)) return 'orchard'
  if (/\b(grassland|prairie|open plain|meadow|pasture|open field|savanna)\b/i.test(description)) return 'grassland'
  if (/\b(forest|woodland|grove|thicket|bosk|dense tangle)\b/i.test(description)) return 'forest'
  return null
}
export function stableSceneIndex(zone: string, room: number, length: number): number {
  let zoneHash = 0
  for (const char of zone) zoneHash = Math.imul(zoneHash, 31) + char.charCodeAt(0)
  // A room id is an identity, not a spatial coordinate. Hash every room on
  // its own until the map pipeline provides an explicit topology-derived
  // scene cluster; arithmetic buckets falsely group disconnected locations.
  return Math.abs(zoneHash + room) % length
}

/** Specific atmosphere is a claim and requires support in the room text. */
function atmosphereMatches(scene: string, description: string): boolean {
  if (/storm/i.test(scene) && !/\b(storm|stormy|thunder|lightning|rain|tempest|squall)\b/i.test(description)) return false
  if (/dusk/i.test(scene) && !/\b(dusk|evening|twilight|sunset)\b/i.test(description)) return false
  if (/night/i.test(scene) && !/\b(night|nighttime|darkness|moonlit|moonlight)\b/i.test(description)) return false
  if (/sunlit/i.test(scene) && !/\b(sunlit|sunlight|sunny|bright sun)\b/i.test(description)) return false
  if (/dawn/i.test(scene) && !/\b(dawn|sunrise|daybreak|early morning)\b/i.test(description)) return false
  if (/rainy/i.test(scene) && !/\b(rain|rainy|downpour|drizzle|wet street|wet cobble)\b/i.test(description)) return false
  return true
}

export function grokRoomScene(zone: string, room: number, title?: string | null, text?: string | null): string | null {
  const description = `${title ?? ''} ${text ?? ''}`
  const family = familyFor(title ?? '') ?? familyForProse(text ?? '')
  if (family === null) return null
  const pool = GROK_SCENES[family].filter((scene) => atmosphereMatches(scene, description))
  // An honest fingerprint is preferable to a literal scene whose weather or
  // time contradicts the game. A one-image atmospheric family can therefore
  // deliberately resolve to no image until neutral art exists.
  if (pool.length === 0) return null
  return pool[stableSceneIndex(zone, room, pool.length)]
}
