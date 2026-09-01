import type { MapZone, MapZoneRoom } from '../bridge/types'

export type MapStampKind =
  | 'water'
  | 'woodland'
  | 'highland'
  | 'underground'
  | 'settlement'
  | 'ruins'
  | 'wetland'
  | 'coast'
  | 'arid'
  | 'cultivated'
  | 'frozen'
  | 'burial'
  | 'worship'
  | 'fortification'
  | 'bridge'
  | 'harbor'
  | 'market'

export interface MapStamp {
  kind: MapStampKind
  label: string
  x: number
  y: number
  count: number
  rotation: number
  weight: number
  /** Selects a stable drawing from the family so repeated marks do not tile. */
  variant: number
}

interface StampRule {
  kind: MapStampKind
  label: string
  pattern: RegExp
  salience?: number
  /** Evidence needed before a broad landscape is claimed. */
  minimum?: 'repeated' | 'named'
  /** How quickly a large district earns another small drawing. */
  roomsPerCopy?: number
  maxCopies?: number
}

/**
 * Broad landscape facts which make sense as ink beneath the navigable map.
 * Every expression is word-bounded: "city" must not turn the Pillar of Unity
 * into a settlement, the same class of substring error that once made an
 * ordinary courtyard a hazard.
 */
const RULES: StampRule[] = [
  { kind: 'wetland', label: 'Wetland', pattern: /\b(swamp|marsh|bog|fen|wetland)\b/i, salience: 1.24, roomsPerCopy: 24, maxCopies: 4 },
  { kind: 'coast', label: 'Coast', pattern: /\b(coast|shore|beach|strand|bay|cove|islands?|isles?|tidal)\b/i, salience: 1.16, roomsPerCopy: 28, maxCopies: 4 },
  { kind: 'arid', label: 'Dry country', pattern: /\b(desert|dunes?|sand|sandy|wastes?|badlands)\b/i, salience: 1.22, roomsPerCopy: 28, maxCopies: 4 },
  { kind: 'cultivated', label: 'Fields', pattern: /\b(farms?|farmlands?|pastures?|meadows?|orchards?|vineyards?|plantations?|(?:barley|wheat|grain|rice|corn|rye|oat|crop) fields?)\b/i, salience: 1.18, roomsPerCopy: 24, maxCopies: 5 },
  { kind: 'frozen', label: 'Frozen', pattern: /\b(snow|snowy|ice|icy|frozen|glaciers?|frost|frostweavers?)\b/i, salience: 1.24, roomsPerCopy: 30, maxCopies: 4 },
  { kind: 'burial', label: 'Burial ground', pattern: /\b(graveyards?|cemeter(?:y|ies)|necropolis|burial|tombs?|crypts?|barrows?)\b/i, salience: 1.2, roomsPerCopy: 18, maxCopies: 3 },
  { kind: 'water', label: 'Waters', pattern: /\b(rivers?|lakes?|sea|ocean|streams?|water|canals?|ponds?)\b/i, roomsPerCopy: 32, maxCopies: 4 },
  { kind: 'woodland', label: 'Woodland', pattern: /\b(forests?|woods?|groves?|trees?|jungle|thickets?)\b/i, roomsPerCopy: 32, maxCopies: 5 },
  { kind: 'highland', label: 'High ground', pattern: /\b(mountain|cliff|ridge|peak|hill|canyon|ravine|crag|gorge|slope)\b/i, roomsPerCopy: 32, maxCopies: 4 },
  { kind: 'underground', label: 'Below', pattern: /\b(caves?|cavern|tunnels?|mines?|grotto|underground|sewers?|passages?)\b/i, roomsPerCopy: 34, maxCopies: 3 },
  // Settlement ink is plan-view fabric: repeated little footprints beside
  // streets, not one skyline announcing that the map contains a town.
  { kind: 'settlement', label: 'Buildings', pattern: /\b(streets?|lanes?|avenues?|squares?|plazas?|markets?|crossing|villages?|towns?|cities?|boulevards?)\b/i, roomsPerCopy: 8, maxCopies: 24 },
  { kind: 'ruins', label: 'Old stones', pattern: /\b(ruins?|fallen|rubble)\b/i, roomsPerCopy: 20, maxCopies: 3 },

  // Named features need only one honest source room. They are the black-ink
  // anchors seen on old survey maps: a church, bridge or keep is itself the
  // evidence and should not need six duplicate room names to appear.
  { kind: 'worship', label: 'Temple', pattern: /\b(temples?|church(?:es)?|chapels?|cathedrals?|shrines?|abbeys?|monaster(?:y|ies))\b/i, minimum: 'named', roomsPerCopy: 3, maxCopies: 4 },
  { kind: 'fortification', label: 'Fortification', pattern: /\b(castles?|keeps?|forts?|fortresses?|gatehouses?|citadels?|watchtowers?|battlements?)\b/i, minimum: 'named', roomsPerCopy: 5, maxCopies: 4 },
  { kind: 'bridge', label: 'Bridge', pattern: /\bbridges?\b/i, minimum: 'named', roomsPerCopy: 4, maxCopies: 5 },
  { kind: 'harbor', label: 'Harbor', pattern: /\b(docks?|piers?|whar(?:f|ves)|quays?|harbou?rs?|ferr(?:y|ies)|jett(?:y|ies))\b/i, minimum: 'named', roomsPerCopy: 5, maxCopies: 4 },
  { kind: 'market', label: 'Market', pattern: /\b(markets?|bazaars?|agoras?|caravanserai)\b/i, minimum: 'named', roomsPerCopy: 4, maxCopies: 3 },
]

function hash(text: string): number {
  let value = 2166136261
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i)
    value = Math.imul(value, 16777619)
  }
  return value >>> 0
}

/**
 * Choose anchors across the whole district, not the first N matching rooms.
 * The first point is seeded per map; every later point is whichever source is
 * farthest from those already chosen. That makes a long river receive marks
 * along its course and a town receive footprints in several neighbourhoods.
 */
function distributedEvidence(matches: MapZoneRoom[], count: number, seed: string): MapZoneRoom[] {
  if (matches.length <= count) return matches
  const chosen = [matches[hash(`${seed}:first`) % matches.length]]
  while (chosen.length < count) {
    let best = matches[0]
    let bestDistance = -1
    for (const candidate of matches) {
      if (chosen.includes(candidate)) continue
      const nearest = Math.min(...chosen.map((other) =>
        ((candidate.x as number) - (other.x as number)) ** 2 +
        ((candidate.y as number) - (other.y as number)) ** 2
      ))
      const tieBreak = hash(`${seed}:${candidate.id ?? candidate.title ?? ''}`) / 0xffffffff
      const score = nearest + tieBreak * 0.001
      if (score > bestDistance) {
        best = candidate
        bestDistance = score
      }
    }
    chosen.push(best)
  }
  return chosen
}

/** Collapse all rooms inside one named landmark into one map impression. */
function namedEvidence(matches: MapZoneRoom[], rule: StampRule): MapZoneRoom[] {
  const byName = new Map<string, MapZoneRoom>()
  for (const room of matches) {
    const labels = room.tags ?? []
    const label = labels.find((candidate) => rule.pattern.test(candidate))
    const titlePart = (room.title ?? '').split(',').find((candidate) => rule.pattern.test(candidate))
    const name = (label ?? titlePart ?? room.title ?? `${room.x}:${room.y}`)
      .toLocaleLowerCase()
      .replace(/[^a-z0-9']+/g, ' ')
      .trim()
    if (!byName.has(name)) byName.set(name, room)
  }
  const spatiallyDistinct: MapZoneRoom[] = []
  for (const candidate of byName.values()) {
    const repeatsNearby = spatiallyDistinct.some((other) =>
      Math.hypot(
        (candidate.x as number) - (other.x as number),
        (candidate.y as number) - (other.y as number)
      ) < 150
    )
    if (!repeatsNearby) spatiallyDistinct.push(candidate)
  }
  return spatiallyDistinct
}

const LANDMARK_KINDS = new Set<MapStampKind>(['worship', 'fortification', 'bridge', 'harbor', 'market', 'burial', 'underground'])

/** Find the direction of the route through an evidence room. */
function routeBearing(anchor: MapZoneRoom, rooms: MapZoneRoom[]): number {
  const targets = new Set([...(anchor.links ?? []).map((link) => link.to), ...(anchor.to ?? [])])
  let neighbor = rooms.find((room) => room.id != null && targets.has(room.id))
  if (!neighbor) {
    neighbor = rooms
      .filter((room) => room !== anchor)
      .reduce<MapZoneRoom | undefined>((best, room) => {
        if (!best) return room
        const distance = ((room.x as number) - (anchor.x as number)) ** 2 + ((room.y as number) - (anchor.y as number)) ** 2
        const bestDistance = ((best.x as number) - (anchor.x as number)) ** 2 + ((best.y as number) - (anchor.y as number)) ** 2
        return distance < bestDistance ? room : best
      }, undefined)
  }
  if (!neighbor) return 0
  return Math.atan2((neighbor.y as number) - (anchor.y as number), (neighbor.x as number) - (anchor.x as number))
}

/**
 * Attach a drawing to the geography that caused it. Landmarks sit directly on
 * their room. Terrain and town fabric sit a short normal step beside the local
 * route, like buildings and field hatching on a survey sheet. Nothing searches
 * for a large blank patch, because that produced the floating clip-art the
 * user correctly rejected.
 */
function structuralPlacement(
  anchor: MapZoneRoom,
  rooms: MapZoneRoom[],
  kind: MapStampKind,
  seed: string
): { x: number; y: number; rotation: number } {
  const bearing = routeBearing(anchor, rooms)
  const landmark = LANDMARK_KINDS.has(kind)
  const side = hash(`${seed}:side`) % 2 ? 1 : -1
  const offset = landmark ? 0 : kind === 'settlement' ? 17 : 21
  const x = (anchor.x as number) + Math.cos(bearing + Math.PI / 2) * offset * side
  const y = (anchor.y as number) + Math.sin(bearing + Math.PI / 2) * offset * side
  const routeRotation = (bearing * 180) / Math.PI
  const naturalRotation = (hash(`${seed}:rotation`) % 11) - 5
  return {
    x,
    y,
    rotation: kind === 'settlement' || kind === 'bridge' ? routeRotation : naturalRotation,
  }
}

/**
 * Build a stable stamp composition for one map sheet. Broad country still
 * needs repeated evidence, while named landmarks can stand on one source
 * room. Large districts earn repeated small marks spread across their actual
 * extent: this is a map-specific drawing plan, not a four-item terrain legend.
 */
export function deriveMapStamps(
  zone: Pick<MapZone, 'zone' | 'name'>,
  rooms: MapZoneRoom[]
): MapStamp[] {
  const positioned = rooms.filter((room) => room.x != null && room.y != null)
  if (!positioned.length) return []

  const zoneKey = String(zone.zone ?? zone.name ?? 'map')
  const threshold = Math.min(6, Math.max(2, Math.ceil(positioned.length / 180)))
  const candidates = RULES.flatMap((rule) => {
    const matches = positioned.filter((room) => {
      const title = room.title ?? ''
      const authoredLabels = (room.tags ?? []).join(' · ')
      if (rule.minimum === 'named') {
        // A cartographer's explicit room label is strong evidence. A title is
        // also evidence unless it is merely a road named after the feature:
        // Church Street is not itself a church.
        return rule.pattern.test(authoredLabels) || (
          rule.pattern.test(title) && !/\b(streets?|roads?|lanes?|avenues?|boulevards?)\b/i.test(title)
        )
      }
      return rule.pattern.test([title, authoredLabels].filter(Boolean).join(' · '))
    })
    const required = rule.minimum === 'named' ? 1 : threshold
    if (matches.length < required) return []

    const named = rule.minimum === 'named' ? namedEvidence(matches, rule) : null
    const copies = Math.min(
      rule.maxCopies ?? 1,
      named?.length ?? Math.max(1, Math.ceil(matches.length / (rule.roomsPerCopy ?? matches.length)))
    )
    const anchors = named
      ? distributedEvidence(named, copies, `${zoneKey}:${rule.kind}`)
      : distributedEvidence(matches, copies, `${zoneKey}:${rule.kind}`)
    return anchors.map((anchor, index) => {
      const point = structuralPlacement(anchor, positioned, rule.kind, `${zoneKey}:${rule.kind}:${index}`)
      return {
        stamp: {
          kind: rule.kind,
          label: rule.label,
          x: point.x,
          y: point.y,
          count: matches.length,
          rotation: point.rotation,
          weight: Math.min(1.05, 0.68 + Math.log2(matches.length + 1) / 18),
          variant: hash(`${zoneKey}:${rule.kind}:${index}:variant`) % 4,
        } satisfies MapStamp,
        // Named black-ink landmarks outrank texture. Landscape then ranks by
        // how much of this particular sheet supports it.
        score: (rule.minimum === 'named' ? 2 : 0) +
          (matches.length / positioned.length) * (rule.salience ?? 1) - index * 0.002,
        copyIndex: index,
      }
    })
  })

  // Density follows the source sheet. Tiny interiors stay honest and sparse;
  // Crossing can carry many small footprints without turning the route graph
  // into wallpaper.
  // At most 25 geographic impressions. The earlier 40-mark experiment made
  // the busiest sheets harder to read than the room graph they explain.
  const decorationBudget = Math.min(25, Math.max(4, Math.ceil(Math.sqrt(positioned.length) * 1.05)))
  const firstOfEachKind = candidates
    .filter((candidate) => candidate.copyIndex === 0)
    .sort((a, b) => b.score - a.score || a.stamp.kind.localeCompare(b.stamp.kind))
  const townFabric = candidates
    .filter((candidate) => candidate.copyIndex > 0 && candidate.stamp.kind === 'settlement')
    .sort((a, b) => a.copyIndex - b.copyIndex)
  const landscapeRepeats = candidates
    .filter((candidate) => candidate.copyIndex > 0 && candidate.stamp.kind !== 'settlement')
    .sort((a, b) => a.copyIndex - b.copyIndex || b.score - a.score)
  return [...firstOfEachKind, ...townFabric, ...landscapeRepeats]
    .slice(0, decorationBudget)
    .map(({ stamp }) => stamp)
}
