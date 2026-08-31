/**
 * Hand-curated corrections for room art with clear description/image mismatches.
 * Multiple approved images rotate deterministically by room key, so long
 * stretches gain variety without changing randomly between launches.
 */
type RoomRange = readonly [number, number]
type Rule = { zone: string; ranges: readonly RoomRange[]; arts: readonly string[] }

const RULES: readonly Rule[] = [
  // 95::Pokekehekepi korgi: Dark sand better matches the shadowed korgi than the sci-fi/planet render.
  {
    zone: '95',
    ranges: [[175, 243], [246, 249]],
    arts: ['/rooms/108-high-dunes.webp'],
  },
  // 95::Pokekehekepi olpo'staho: Silver sand disappearing into darkness; replaces a snowy town scene.
  {
    zone: '95',
    ranges: [[78, 83], [87, 92], [94, 95], [118, 120], [129, 131], [133, 164], [173, 173]],
    arts: ['/rooms/108-high-dunes.webp'],
  },
  // 95::Pokekehekepi ghedo: Silver sand disappearing into darkness; replaces a snowy town scene.
  {
    zone: '95',
    ranges: [[84, 86], [96, 117], [121, 128], [132, 132], [165, 172], [174, 174]],
    arts: ['/rooms/108-high-dunes.webp'],
  },
  // 7::In The Water: Submerged, tangled darkness matches the marsh-water description.
  {
    zone: '7',
    ranges: [[8, 63]],
    arts: ['/rooms/150-deep-water.webp'],
  },
  // 112::In the Water: Murky deep channel; replaces a dry harbor/town image.
  {
    zone: '112',
    ranges: [[73, 74], [77, 77], [113, 155]],
    arts: ['/rooms/150-deep-water.webp'],
  },
  // 90::Ehhrsk Highway: Green-lit wet tunnels match the lichen/sewage highway description.
  {
    zone: '90',
    ranges: [[734, 782]],
    arts: ['/room-scenes/archetype-sewer-0.webp', '/room-scenes/archetype-sewer-5.webp'],
  },
  // 42::The Breech Tunnels: Low rough passages fit the crawling sharp-rock tunnel.
  {
    zone: '42',
    ranges: [[116, 116], [137, 168], [338, 346]],
    arts: ['/room-scenes/archetype-mine-tunnel-6.webp', '/room-scenes/archetype-mine-tunnel-1.webp'],
  },
  // 106::Seord Fal: Violent watercourse fits the hazardous rushing river.
  {
    zone: '106',
    ranges: [[117, 159]],
    arts: ['/rooms/13-waterfall.webp'],
  },
  // 108::Sand Valley: Open dunes replace a sea-cave fallback; approved variants reduce repetition.
  {
    zone: '108',
    ranges: [[1, 17], [25, 30]],
    arts: ['/rooms/108-high-dunes.webp', '/room-scenes/archetype-desert-6.webp'],
  },
  // 108::Dune Crest: Dune terrain instead of the sea-cave fallback.
  {
    zone: '108',
    ranges: [[18, 23]],
    arts: ['/rooms/108-high-dunes.webp', '/room-scenes/archetype-desert-1.webp'],
  },
  // 108::The Bog Wallows: Wet swamp scenes replace the sea-cave fallback.
  {
    zone: '108',
    ranges: [[205, 216]],
    arts: ['/room-scenes/archetype-swamp-0.webp', '/room-scenes/archetype-swamp-4.webp', '/room-scenes/archetype-swamp-7.webp'],
  },
  // 108::Wishing Well Grove: Wooded paths replace the sea-cave fallback.
  {
    zone: '108',
    ranges: [[152, 152], [154, 155], [157, 157], [161, 165]],
    arts: ['/room-scenes/archetype-forest-path-0.webp', '/room-scenes/archetype-forest-path-4.webp', '/room-scenes/archetype-forest-path-7.webp'],
  },
  // 108::Tunnel: Actual tunnel art replaces the sea-cave fallback.
  {
    zone: '108',
    ranges: [[362, 366]],
    arts: ['/room-scenes/archetype-mine-tunnel-1.webp', '/room-scenes/archetype-mine-tunnel-6.webp'],
  },
  // 127::Derelict Togball Field: Existing field art fits the derelict playing field much better than a forest village.
  {
    zone: '127',
    ranges: [[560, 580]],
    arts: ['/rooms/127-midfield.webp', '/rooms/127-midfield-north.webp', '/rooms/127-midfield-south.webp'],
  },
  // 127::Dark Trees Path: Dark wooded trail instead of a village scene.
  {
    zone: '127',
    ranges: [[114, 121], [163, 163]],
    arts: ['/room-scenes/archetype-forest-path-4.webp', '/room-scenes/archetype-forest-path-8.webp'],
  },
  // 127::Split-Log Path: Forest path art instead of a village scene.
  {
    zone: '127',
    ranges: [[19, 28]],
    arts: ['/room-scenes/archetype-forest-path-1.webp', '/room-scenes/archetype-forest-path-8.webp'],
  },
  // 127::Forest: Forest art instead of a village scene.
  {
    zone: '127',
    ranges: [[124, 129]],
    arts: ['/room-scenes/archetype-forest-path-3.webp', '/room-scenes/archetype-forest-path-4.webp'],
  },
  // 127::Overgrown Path: Overgrown wooded path instead of a village scene.
  {
    zone: '127',
    ranges: [[555, 559], [581, 581]],
    arts: ['/room-scenes/archetype-forest-path-4.webp', '/room-scenes/archetype-forest-path-8.webp'],
  },
  // 127::Mountain Pass: Mountain pass art instead of a village scene.
  {
    zone: '127',
    ranges: [[649, 650], [653, 654]],
    arts: ['/room-scenes/archetype-mountain-pass-7.webp', '/room-scenes/archetype-mountain-pass-8.webp'],
  },
  // 1::Tree-lined Path: Wooded path replaces an unrelated urban canal scene.
  {
    zone: '1',
    ranges: [[505, 514]],
    arts: ['/room-scenes/archetype-forest-path-2.webp', '/room-scenes/archetype-forest-path-7.webp'],
  },
  // 1::Garden Path: Garden paths replace an unrelated urban canal scene.
  {
    zone: '1',
    ranges: [[249, 257], [259, 259], [261, 262]],
    arts: ['/room-scenes/archetype-garden-1.webp', '/room-scenes/archetype-garden-6.webp'],
  },
  // 1::Tunnel: Tunnel art replaces an unrelated urban canal scene.
  {
    zone: '1',
    ranges: [[889, 891]],
    arts: ['/room-scenes/archetype-mine-tunnel-1.webp', '/room-scenes/archetype-mine-tunnel-6.webp'],
  },
]

function hashRoomKey(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function roomArtOverride(zone: string, room: number): string | null {
  for (const rule of RULES) {
    if (rule.zone !== zone) continue
    if (!rule.ranges.some(([first, last]) => room >= first && room <= last)) continue
    const key = `${zone}-${room}`
    return rule.arts[hashRoomKey(key) % rule.arts.length]
  }
  return null
}
