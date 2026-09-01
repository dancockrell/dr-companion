/**
 * Visually reviewed landscape scenes from the Grok source pack.  This is the
 * only generic room-art pool: older local renders must not leak back in as
 * fallback filler.  Nearby rooms hold the same scene for three room numbers,
 * giving movement a readable visual rhythm instead of a per-room slot machine.
 */
const HOLD_ROOMS = 3

const GROK_SCENES = {
  forest: ['/grok-art/room-scenes/forest-sunlit-0261ab7e.jpg', '/grok-art/room-scenes/forest-clearing-06aeb546.jpg'],
  water: ['/grok-art/room-scenes/marsh-dusk-025a5488.jpg', '/grok-art/room-scenes/lantern-dock-02798b8e.jpg'],
  cave: ['/grok-art/room-scenes/sea-cave-038edbd8.jpg'],
  mountain: ['/grok-art/room-scenes/cliff-monastery-0183963f.jpg', '/grok-art/room-scenes/mountain-bridge-05a1ad18.jpg'],
  desert: ['/grok-art/room-scenes/desert-canyon-0322415e.jpg'],
  town: ['/grok-art/room-scenes/night-market-04c61394.jpg'],
  treeTown: ['/grok-art/room-scenes/tree-city-04b6c4bd.jpg'],
} as const

type SceneFamily = keyof typeof GROK_SCENES

function familyFor(description: string): SceneFamily {
  if (/\b(treehouse|treetop|canopy|wood elf|leth deriel)\b/i.test(description)) return 'treeTown'
  if (/\b(cave|cavern|grotto|tunnel|underground|crypt|tomb|sewer)\b/i.test(description)) return 'cave'
  if (/\b(desert|sand|dune|arid|badland|waste)\b/i.test(description)) return 'desert'
  if (/\b(mountain|cliff|ridge|summit|peak|highland|ascent|outcrop)\b/i.test(description)) return 'mountain'
  if (/\b(water|river|sea|lake|shore|bay|dock|pier|marsh|swamp|bog|fen|wave|tide)\b/i.test(description)) return 'water'
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

