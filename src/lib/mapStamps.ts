import type { MapZone, MapZoneRoom } from '../bridge/types'

export type MapStampKind =
  | 'seal'
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
  kind: Exclude<MapStampKind, 'seal'>
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
  { kind: 'settlement', label: 'Buildings', pattern: /\b(streets?|lanes?|avenues?|squares?|plazas?|markets?|crossing|villages?|towns?|cities?|boulevards?)\b/i, roomsPerCopy: 32, maxCopies: 12 },
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

function middle(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const i = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2
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

function quietPoint(rooms: MapZoneRoom[]): { x: number; y: number } {
  const points = rooms
    .filter((room) => room.x != null && room.y != null)
    .map((room) => ({ x: room.x as number, y: room.y as number }))
  if (!points.length) return { x: 0, y: 0 }

  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  // Find the quietest part of the authored sheet instead of always stamping
  // the lower-right corner, which is often a gate or a whole district. A
  // seven-by-seven sample is deterministic and cheap even for Crossing.
  let best = points[0]
  let bestDistance = -1
  for (let gy = 1; gy <= 7; gy++) {
    for (let gx = 1; gx <= 7; gx++) {
      const candidate = {
        x: minX + ((maxX - minX) * gx) / 8,
        y: minY + ((maxY - minY) * gy) / 8,
      }
      let nearest = Number.POSITIVE_INFINITY
      for (const point of points) {
        const distance = (candidate.x - point.x) ** 2 + (candidate.y - point.y) ** 2
        if (distance < nearest) nearest = distance
      }
      if (nearest > bestDistance) {
        best = candidate
        bestDistance = nearest
      }
    }
  }
  return best
}

/** Put a terrain drawing in open paper near the rooms that justify it.
 * Historical pictorial symbols sit beside the route network instead of being
 * centered directly on top of it. The median keeps the illustration in the
 * right district; the distance score finds nearby breathing room. */
function illustrationPoint(matches: MapZoneRoom[], rooms: MapZoneRoom[], seed: string): { x: number; y: number } {
  const evidenceCenter = {
    x: middle(matches.map((room) => room.x as number)),
    y: middle(matches.map((room) => room.y as number)),
  }
  const xs = rooms.map((room) => room.x as number)
  const ys = rooms.map((room) => room.y as number)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const insetX = Math.min(36, (maxX - minX) / 5)
  const insetY = Math.min(36, (maxY - minY) / 5)
  const safeMinX = minX + insetX
  const safeMaxX = maxX - insetX
  const safeMinY = minY + insetY
  const safeMaxY = maxY - insetY
  const shortSpan = Math.min(maxX - minX || 40, maxY - minY || 40)
  const center = {
    x: Math.max(safeMinX, Math.min(safeMaxX, evidenceCenter.x)),
    y: Math.max(safeMinY, Math.min(safeMaxY, evidenceCenter.y)),
  }
  const radius = Math.max(18, Math.min(70, shortSpan / 4))
  const start = hash(`${seed}:illustration`) % 12
  const candidates = [center]
  for (const ring of [0.55, 1]) {
    for (let step = 0; step < 12; step++) {
      const angle = ((start + step) * Math.PI) / 6
      candidates.push({
        x: Math.max(safeMinX, Math.min(safeMaxX, center.x + Math.cos(angle) * radius * ring)),
        y: Math.max(safeMinY, Math.min(safeMaxY, center.y + Math.sin(angle) * radius * ring)),
      })
    }
  }
  const score = (point: { x: number; y: number }) => {
    const nearestRoom = Math.min(...rooms.map((room) =>
      (point.x - (room.x as number)) ** 2 + (point.y - (room.y as number)) ** 2
    ))
    const fromEvidence = (point.x - evidenceCenter.x) ** 2 + (point.y - evidenceCenter.y) ** 2
    return nearestRoom - fromEvidence * 0.12
  }
  return candidates.reduce((best, point) => score(point) > score(best) ? point : best)
}

function spreadStamps(stamps: MapStamp[], rooms: MapZoneRoom[], zoneKey: string): MapStamp[] {
  if (stamps.length < 2) return stamps
  const xs = rooms.map((room) => room.x as number)
  const ys = rooms.map((room) => room.y as number)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const insetX = Math.min(36, (maxX - minX) / 5)
  const insetY = Math.min(36, (maxY - minY) / 5)
  const safeMinX = minX + insetX
  const safeMaxX = maxX - insetX
  const safeMinY = minY + insetY
  const safeMaxY = maxY - insetY
  const shortSpan = Math.min(maxX - minX || 40, maxY - minY || 40)
  const gap = Math.max(24, Math.min(52, shortSpan / 3))
  const placed = [stamps[0]]

  for (const stamp of stamps.slice(1)) {
    const start = hash(`${zoneKey}:${stamp.kind}:position`) % 8
    const candidates = [{ x: stamp.x, y: stamp.y }]
    for (let step = 0; step < 8; step++) {
      const angle = ((start + step) * Math.PI) / 4
      candidates.push({
        x: Math.max(safeMinX, Math.min(safeMaxX, stamp.x + Math.cos(angle) * gap)),
        y: Math.max(safeMinY, Math.min(safeMaxY, stamp.y + Math.sin(angle) * gap)),
      })
    }
    const score = (point: { x: number; y: number }) => Math.min(...placed.map((other) =>
      (point.x - other.x) ** 2 + (point.y - other.y) ** 2
    ))
    const best = candidates.reduce((winner, point) => score(point) > score(winner) ? point : winner)
    placed.push({ ...stamp, ...best })
  }
  return placed
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
  const sealAt = quietPoint(positioned)
  const seal: MapStamp = {
    kind: 'seal',
    label: zone.name ?? `Zone ${zoneKey}`,
    x: sealAt.x,
    y: sealAt.y,
    count: positioned.length,
    rotation: (hash(`${zoneKey}:seal`) % 9) - 4,
    weight: 1,
    variant: hash(`${zoneKey}:seal:variant`) % 4,
  }

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
      const point = illustrationPoint([anchor], positioned, `${zoneKey}:${rule.kind}:${index}`)
      return {
        stamp: {
          kind: rule.kind,
          label: rule.label,
          x: point.x,
          y: point.y,
          count: matches.length,
          rotation: (hash(`${zoneKey}:${rule.kind}:${index}`) % 15) - 7,
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

  // Density follows the source sheet. A tiny interior gets a compass and a
  // handful of features; Crossing can carry many small footprints without
  // turning the route graph into wallpaper.
  const decorationBudget = Math.min(24, Math.max(4, Math.ceil(Math.sqrt(positioned.length) * 0.72)))
  // First give every evidenced feature one mark; only then spend remaining
  // ink repeating the broadest districts. Without the rounds, four docks can
  // crowd all farmland off a large mixed-country sheet.
  const ordered = Array.from({ length: 12 }, (_, copyIndex) => candidates
    .filter((candidate) => candidate.copyIndex === copyIndex)
    .sort((a, b) => b.score - a.score || a.stamp.kind.localeCompare(b.stamp.kind)))
    .flat()
  return spreadStamps(
    [seal, ...ordered.slice(0, decorationBudget).map(({ stamp }) => stamp)],
    positioned,
    zoneKey
  )
}
