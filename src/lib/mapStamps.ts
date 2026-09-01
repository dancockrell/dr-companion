import type { MapZone, MapZoneRoom } from '../bridge/types'
import { landmarksFor, type LandmarkKind } from './mapLandmarks'

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
  | 'service-bank'
  | 'service-healer'
  | 'service-guild'
  | 'service-inn'
  | 'service-forge'
  | 'service-library'
  | 'service-training'
  | 'service-gate'
  | 'service-arcane'
  | 'service-civic'

export type MapStampRole = 'background' | 'illustration' | 'hero'

export interface MapStamp {
  kind: MapStampKind
  label: string
  x: number
  y: number
  count: number
  rotation: number
  weight: number
  /** Background fabric, a readable terrain illustration, or an oversized landmark. */
  role: MapStampRole
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
  /** Copies per source room; values above one build dense town and terrain fabric. */
  density?: number
}

/**
 * Broad landscape facts which make sense as ink beneath the navigable map.
 * Every expression is word-bounded: "city" must not turn the Pillar of Unity
 * into a settlement, the same class of substring error that once made an
 * ordinary courtyard a hazard.
 */
const RULES: StampRule[] = [
  { kind: 'wetland', label: 'Wetland', pattern: /\b(swamp|marsh|bog|fen|wetland)\b/i, salience: 1.24, density: 1.1, maxCopies: 140 },
  { kind: 'coast', label: 'Coast', pattern: /\b(coast|shore|beach|strand|bay|cove|islands?|isles?|tidal)\b/i, salience: 1.16, density: 1.05, maxCopies: 140 },
  { kind: 'arid', label: 'Dry country', pattern: /\b(desert|dunes?|sand|sandy|wastes?|badlands)\b/i, salience: 1.22, density: 1.1, maxCopies: 140 },
  { kind: 'cultivated', label: 'Fields', pattern: /\b(farms?|farmlands?|pastures?|meadows?|orchards?|vineyards?|plantations?|(?:barley|wheat|grain|rice|corn|rye|oat|crop) fields?)\b/i, salience: 1.18, density: 1.15, maxCopies: 160 },
  { kind: 'frozen', label: 'Frozen', pattern: /\b(snow|snowy|ice|icy|frozen|glaciers?|frost|frostweavers?)\b/i, salience: 1.24, density: 1.05, maxCopies: 140 },
  { kind: 'burial', label: 'Burial ground', pattern: /\b(graveyards?|cemeter(?:y|ies)|necropolis|burial|tombs?|crypts?|barrows?)\b/i, salience: 1.2, density: 0.8, maxCopies: 90 },
  { kind: 'water', label: 'Waters', pattern: /\b(rivers?|lakes?|sea|ocean|streams?|water|canals?|ponds?)\b/i, density: 1.2, maxCopies: 180 },
  { kind: 'woodland', label: 'Woodland', pattern: /\b(forests?|woods?|groves?|trees?|jungle|thickets?)\b/i, density: 1.25, maxCopies: 180 },
  { kind: 'highland', label: 'High ground', pattern: /\b(mountain|cliff|ridge|peak|hill|canyon|ravine|crag|gorge|slope)\b/i, density: 1.1, maxCopies: 150 },
  { kind: 'underground', label: 'Below', pattern: /\b(caves?|cavern|tunnels?|mines?|grotto|underground|sewers?|passages?)\b/i, density: 0.9, maxCopies: 100 },
  // Settlement ink is plan-view fabric: repeated little footprints beside
  // streets, not one skyline announcing that the map contains a town.
  { kind: 'settlement', label: 'Buildings', pattern: /\b(streets?|lanes?|avenues?|squares?|plazas?|markets?|crossing|villages?|towns?|cities?|boulevards?)\b/i, density: 1.5, maxCopies: 420 },
  { kind: 'ruins', label: 'Old stones', pattern: /\b(ruins?|fallen|rubble)\b/i, density: 0.9, maxCopies: 100 },

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

/**
 * Reuse honest source rooms when an illustrated district needs more than one
 * faint impression per room. Placement remains seeded and route-aware, so the
 * extra ink reads as a continuous neighbourhood rather than a random loop.
 */
function repeatedEvidence(matches: MapZoneRoom[], count: number, seed: string): MapZoneRoom[] {
  const ordered = [...matches].sort((a, b) =>
    (a.x as number) - (b.x as number) ||
    (a.y as number) - (b.y as number) ||
    String(a.id ?? a.title ?? '').localeCompare(String(b.id ?? b.title ?? ''))
  )
  const divisor = (a: number, b: number): number => b ? divisor(b, a % b) : a
  let stride = Math.max(1, hash(`${seed}:stride`) % ordered.length)
  while (divisor(stride, ordered.length) !== 1) stride++
  const start = hash(`${seed}:start`) % ordered.length
  return Array.from({ length: count }, (_, index) => ordered[(start + index * stride) % ordered.length])
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

const SERVICE_STAMPS: Partial<Record<LandmarkKind, { kind: MapStampKind; label: string; weight: number }>> = {
  bank: { kind: 'service-bank', label: 'Bank', weight: 1.22 },
  healer: { kind: 'service-healer', label: 'Healer', weight: 1.18 },
  alchemy: { kind: 'service-healer', label: 'Apothecary', weight: 1.08 },
  guild: { kind: 'service-guild', label: 'Guild', weight: 1.22 },
  inn: { kind: 'service-inn', label: 'Inn', weight: 1.16 },
  craft: { kind: 'service-forge', label: 'Crafting', weight: 1.14 },
  weapon: { kind: 'service-forge', label: 'Weapons', weight: 1.12 },
  armor: { kind: 'service-forge', label: 'Armor', weight: 1.12 },
  library: { kind: 'service-library', label: 'Library', weight: 1.14 },
  hunt: { kind: 'service-training', label: 'Hunting ground', weight: 1.12 },
  trainer: { kind: 'service-training', label: 'Training', weight: 1.15 },
  travel: { kind: 'service-gate', label: 'Travel', weight: 1.16 },
  portal: { kind: 'service-gate', label: 'Portal', weight: 1.14 },
  magic: { kind: 'service-arcane', label: 'Arcane service', weight: 1.2 },
  office: { kind: 'service-civic', label: 'Public office', weight: 1.12 },
  justice: { kind: 'service-civic', label: 'Court', weight: 1.16 },
  post: { kind: 'service-civic', label: 'Post', weight: 1.08 },
  shop: { kind: 'market', label: 'Market', weight: 1.08 },
  dock: { kind: 'harbor', label: 'Harbor', weight: 1.12 },
  temple: { kind: 'worship', label: 'Temple', weight: 1.14 },
}

const LANDMARK_KINDS = new Set<MapStampKind>([
  'worship', 'fortification', 'bridge', 'harbor', 'market', 'burial', 'underground',
  'service-bank', 'service-healer', 'service-guild', 'service-inn', 'service-forge',
  'service-library', 'service-training', 'service-gate', 'service-arcane', 'service-civic',
])

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
  const baseOffset = kind === 'settlement' ? 14 : 19
  const offset = landmark ? 0 : baseOffset + (hash(`${seed}:offset`) % 13)
  const along = landmark ? 0 : (hash(`${seed}:along`) % 17) - 8
  const x = (anchor.x as number) + Math.cos(bearing + Math.PI / 2) * offset * side + Math.cos(bearing) * along
  const y = (anchor.y as number) + Math.sin(bearing + Math.PI / 2) * offset * side + Math.sin(bearing) * along
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
  const geographicCandidates = RULES.flatMap((rule) => {
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
    const copies = Math.min(rule.maxCopies ?? 1, named?.length ?? Math.max(
      1,
      rule.density
        ? Math.ceil(matches.length * rule.density)
        : Math.ceil(matches.length / (rule.roomsPerCopy ?? matches.length))
    ))
    const anchors = named
      ? distributedEvidence(named, copies, `${zoneKey}:${rule.kind}`)
      : repeatedEvidence(matches, copies, `${zoneKey}:${rule.kind}`)
    return anchors.map((anchor, index) => {
      const point = structuralPlacement(anchor, positioned, rule.kind, `${zoneKey}:${rule.kind}:${index}`)
      const role: MapStampRole = rule.minimum === 'named'
        ? 'hero'
        : index === 0 ? 'illustration' : 'background'
      return {
        stamp: {
          kind: rule.kind,
          label: rule.label,
          x: point.x,
          y: point.y,
          count: matches.length,
          rotation: point.rotation,
          weight: role === 'background'
            ? Math.min(0.62, 0.4 + Math.log2(matches.length + 1) / 28)
            : Math.min(1.08, 0.75 + Math.log2(matches.length + 1) / 18),
          role,
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

  // Major services are exaggerated landmarks, the same way an old atlas makes
  // a cathedral or station larger than the street plan beneath it. Nearby
  // rooms which describe the same service collapse into one hero drawing.
  const serviceAnchors: Array<{ room: MapZoneRoom; kind: MapStampKind }> = []
  const serviceCandidates = positioned.flatMap((room) => {
    const landmark = landmarksFor(room)[0]
    const presentation = landmark ? SERVICE_STAMPS[landmark.kind] : null
    if (!presentation) return []
    // A map sheet receives one exaggerated exemplar per service family. The
    // smaller room badges still identify every branch. Repeating a huge bank
    // or guild drawing at every matching room turns a city into a floor plan.
    if (serviceAnchors.some((entry) => entry.kind === presentation.kind)) return []
    serviceAnchors.push({ room, kind: presentation.kind })
    return [{
      stamp: {
        kind: presentation.kind,
        label: presentation.label,
        x: room.x as number,
        y: room.y as number,
        count: 1,
        rotation: (hash(`${zoneKey}:${presentation.kind}:${room.id ?? room.title}:rotation`) % 7) - 3,
        weight: presentation.weight,
        role: 'hero' as const,
        variant: hash(`${zoneKey}:${presentation.kind}:${room.id ?? room.title}:variant`) % 4,
      } satisfies MapStamp,
      score: 6 + presentation.weight,
      copyIndex: 0,
    }]
  })

  const candidates = [...serviceCandidates, ...geographicCandidates]
  // Generated assets are a vocabulary, not an instruction to print every
  // possible mark. Screen-sized maps need enough quiet paper for the route
  // graph to remain the first read, even when the underlying zone is huge.
  const decorationBudget = Math.min(64, Math.max(12, Math.ceil(Math.sqrt(positioned.length) * 1.8)))
  const serviceHeroes = serviceCandidates
    .sort((a, b) => b.score - a.score || a.stamp.kind.localeCompare(b.stamp.kind))
    .slice(0, 8)
  const geographicHeroes = geographicCandidates
    .filter((candidate) => candidate.stamp.role === 'hero')
    .sort((a, b) => b.score - a.score || a.stamp.kind.localeCompare(b.stamp.kind))
    .slice(0, 4)
  const heroes = [...serviceHeroes, ...geographicHeroes].slice(0, 10)
  const firstOfEachKind = candidates
    .filter((candidate) => candidate.stamp.role === 'illustration')
    .sort((a, b) => b.score - a.score || a.stamp.kind.localeCompare(b.stamp.kind))
  const townFabric = candidates
    .filter((candidate) => candidate.stamp.role === 'background' && candidate.stamp.kind === 'settlement')
    .sort((a, b) => a.copyIndex - b.copyIndex)
  const landscapeRepeats = candidates
    .filter((candidate) => candidate.stamp.role === 'background' && candidate.stamp.kind !== 'settlement')
    .sort((a, b) => a.copyIndex - b.copyIndex || b.score - a.score)
  const seen = new Set<string>()
  return [...heroes, ...firstOfEachKind, ...townFabric, ...landscapeRepeats]
    .filter(({ stamp }) => {
      const key = `${stamp.kind}:${stamp.role}:${Math.round(stamp.x)}:${Math.round(stamp.y)}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, decorationBudget)
    .map(({ stamp }) => stamp)
}
