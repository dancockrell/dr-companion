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

export interface MapStamp {
  kind: MapStampKind
  label: string
  x: number
  y: number
  count: number
  rotation: number
  weight: number
}

interface StampRule {
  kind: Exclude<MapStampKind, 'seal'>
  label: string
  pattern: RegExp
  salience?: number
}

/**
 * Broad landscape facts which make sense as ink beneath the navigable map.
 * Every expression is word-bounded: "city" must not turn the Pillar of Unity
 * into a settlement, the same class of substring error that once made an
 * ordinary courtyard a hazard.
 */
const RULES: StampRule[] = [
  { kind: 'wetland', label: 'Wetland', pattern: /\b(swamp|marsh|bog|fen|wetland)\b/i, salience: 1.24 },
  { kind: 'coast', label: 'Coast', pattern: /\b(coast|shore|beach|strand|bay|cove|islands?|isles?|tidal)\b/i, salience: 1.16 },
  { kind: 'arid', label: 'Dry country', pattern: /\b(desert|dunes?|sand|sandy|wastes?|badlands)\b/i, salience: 1.22 },
  { kind: 'cultivated', label: 'Fields', pattern: /\b(farms?|farmland|pastures?|meadows?|orchards?|vineyards?|plantations?|(?:barley|wheat|grain|rice|corn|rye|oat|crop) fields?)\b/i, salience: 1.18 },
  { kind: 'frozen', label: 'Frozen', pattern: /\b(snow|snowy|ice|icy|frozen|glaciers?|frost|frostweavers?)\b/i, salience: 1.24 },
  { kind: 'burial', label: 'Burial ground', pattern: /\b(graveyards?|cemeter(?:y|ies)|necropolis|burial|tombs?|crypts?|barrows?)\b/i, salience: 1.2 },
  { kind: 'water', label: 'Waters', pattern: /\b(rivers?|lakes?|sea|ocean|docks?|piers?|ferr(?:y|ies)|harbou?rs?|streams?|water|canals?|ponds?|quays?)\b/i },
  { kind: 'woodland', label: 'Woodland', pattern: /\b(forests?|woods?|groves?|trees?|jungle|thickets?)\b/i },
  { kind: 'highland', label: 'High ground', pattern: /\b(mountain|cliff|ridge|peak|hill|canyon|ravine|crag|gorge|slope)\b/i },
  { kind: 'underground', label: 'Below', pattern: /\b(caves?|cavern|tunnels?|mines?|grotto|underground|sewers?|passages?)\b/i },
  { kind: 'settlement', label: 'Settlement', pattern: /\b(street|road|lane|avenue|square|plaza|market|crossing|village|town|city|boulevard)\b/i },
  { kind: 'ruins', label: 'Old stones', pattern: /\b(ruins?|fortress|castle|keep)\b/i },
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

function spreadStamps(stamps: MapStamp[], rooms: MapZoneRoom[], zoneKey: string): MapStamp[] {
  if (stamps.length < 2) return stamps
  const xs = rooms.map((room) => room.x as number)
  const ys = rooms.map((room) => room.y as number)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const shortSpan = Math.min(maxX - minX || 40, maxY - minY || 40)
  const gap = Math.max(24, Math.min(52, shortSpan / 3))
  const placed = [stamps[0]]

  for (const stamp of stamps.slice(1)) {
    const start = hash(`${zoneKey}:${stamp.kind}:position`) % 8
    const candidates = [{ x: stamp.x, y: stamp.y }]
    for (let step = 0; step < 8; step++) {
      const angle = ((start + step) * Math.PI) / 4
      candidates.push({
        x: Math.max(minX, Math.min(maxX, stamp.x + Math.cos(angle) * gap)),
        y: Math.max(minY, Math.min(maxY, stamp.y + Math.sin(angle) * gap)),
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
 * Derive a restrained set of stable, factual marks from the rooms on one
 * visible level. The seal is always present; terrain stamps need repeated
 * evidence so one room called "Garden" does not declare a whole zone forest.
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
  }

  const threshold = Math.min(6, Math.max(2, Math.ceil(positioned.length / 180)))
  const terrain = RULES.flatMap((rule) => {
    const matches = positioned.filter((room) => {
      const words = [room.title, ...(room.tags ?? [])].filter(Boolean).join(' · ')
      return rule.pattern.test(words)
    })
    if (matches.length < threshold) return []

    return [{
      stamp: {
        kind: rule.kind,
        label: rule.label,
        x: middle(matches.map((room) => room.x as number)),
        y: middle(matches.map((room) => room.y as number)),
        count: matches.length,
        rotation: (hash(`${zoneKey}:${rule.kind}`) % 11) - 5,
        weight: Math.min(1.28, 0.82 + Math.log2(matches.length + 1) / 12),
      } satisfies MapStamp,
      score: (matches.length / positioned.length) * (rule.salience ?? 1),
    }]
  })

  // Four factual washes plus the seal is enough to give a zone a visual
  // grammar. More becomes wallpaper and starts competing with the map.
  terrain.sort((a, b) => b.score - a.score || a.stamp.kind.localeCompare(b.stamp.kind))
  return spreadStamps([seal, ...terrain.slice(0, 4).map(({ stamp }) => stamp)], positioned, zoneKey)
}
