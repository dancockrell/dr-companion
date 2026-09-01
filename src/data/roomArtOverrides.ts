/**
 * Hand-curated corrections for room art with clear description/image mismatches.
 * Multiple approved images rotate deterministically by room key, so long
 * stretches gain variety without changing randomly between launches.
 */
type RoomRange = readonly [number, number]
type Rule = { zone: string; ranges: readonly RoomRange[]; arts: readonly string[] }

const RULES: readonly Rule[] = [
  // Pokekehekepi: replace sci-fi/snowy-town failures with dark sand.
  { zone: '95', ranges: [[175, 243], [246, 249]], arts: ['/room-scenes/curated-pokekehekepi-korgi.webp'] },
  { zone: '95', ranges: [[78, 83], [87, 92], [94, 95], [118, 120], [129, 131], [133, 164], [173, 173]], arts: ['/rooms/108-high-dunes.webp'] },
  { zone: '95', ranges: [[84, 86], [96, 117], [121, 128], [132, 132], [165, 172], [174, 174]], arts: ['/rooms/108-high-dunes.webp'] },

  // Submerged rooms: use actual underwater/murky scenes.
  { zone: '7', ranges: [[8, 63]], arts: ['/room-scenes/curated-underwater-marsh-channel.webp'] },
  { zone: '112', ranges: [[73, 74], [77, 77], [113, 155]], arts: ['/room-scenes/curated-underwater-marsh-channel.webp'] },

  // Ehhrsk Highway and Breech Tunnels: wet sewer / low rough tunnel art.
  { zone: '90', ranges: [[734, 782]], arts: ['/room-scenes/archetype-sewer-0.webp', '/room-scenes/archetype-sewer-5.webp'] },
  { zone: '42', ranges: [[116, 116], [137, 168], [338, 346]], arts: ['/room-scenes/archetype-mine-tunnel-6.webp', '/room-scenes/archetype-mine-tunnel-1.webp'] },

  // Seord Fal: hazardous rushing river.
  { zone: '106', ranges: [[117, 159]], arts: ['/room-scenes/curated-seord-fal.webp'] },

  // Temple of the North Wind: replace a clean torchlit stair hall with frozen catacombs.
  { zone: '127', ranges: [[435, 436], [450, 505]], arts: ['/room-scenes/curated-north-wind-catacombs.webp'] },

  // M'Riss: the old shared sea-cave fallback was serving dunes, swamp, woods and tunnels.
  { zone: '108', ranges: [[1, 17], [25, 30]], arts: ['/rooms/108-high-dunes.webp', '/room-scenes/archetype-desert-6.webp'] },
  { zone: '108', ranges: [[18, 23]], arts: ['/rooms/108-high-dunes.webp', '/room-scenes/archetype-desert-1.webp'] },
  { zone: '108', ranges: [[205, 216]], arts: ['/room-scenes/archetype-swamp-0.webp', '/room-scenes/archetype-swamp-4.webp', '/room-scenes/archetype-swamp-7.webp'] },
  { zone: '108', ranges: [[152, 152], [154, 155], [157, 157], [161, 165]], arts: ['/room-scenes/archetype-forest-path-0.webp', '/room-scenes/archetype-forest-path-4.webp', '/room-scenes/archetype-forest-path-7.webp'] },
  { zone: '108', ranges: [[362, 366]], arts: ['/room-scenes/archetype-mine-tunnel-1.webp', '/room-scenes/archetype-mine-tunnel-6.webp'] },

  // Boar Clan: split a forest-village fallback into field, path, forest and mountain art.
  { zone: '127', ranges: [[560, 580]], arts: ['/rooms/127-midfield.webp', '/rooms/127-midfield-north.webp', '/rooms/127-midfield-south.webp'] },
  { zone: '127', ranges: [[114, 121], [163, 163]], arts: ['/room-scenes/archetype-forest-path-4.webp', '/room-scenes/archetype-forest-path-8.webp'] },
  { zone: '127', ranges: [[19, 28]], arts: ['/room-scenes/archetype-forest-path-1.webp', '/room-scenes/archetype-forest-path-8.webp'] },
  { zone: '127', ranges: [[124, 129]], arts: ['/room-scenes/archetype-forest-path-3.webp', '/room-scenes/archetype-forest-path-4.webp'] },
  { zone: '127', ranges: [[555, 559], [581, 581]], arts: ['/room-scenes/archetype-forest-path-4.webp', '/room-scenes/archetype-forest-path-8.webp'] },
  { zone: '127', ranges: [[649, 650], [653, 654]], arts: ['/room-scenes/archetype-mountain-pass-7.webp', '/room-scenes/archetype-mountain-pass-8.webp'] },

  // Crossing-area paths: replace an unrelated urban canal scene.
  { zone: '1', ranges: [[505, 514]], arts: ['/room-scenes/archetype-forest-path-2.webp', '/room-scenes/archetype-forest-path-7.webp'] },
  { zone: '1', ranges: [[249, 257], [259, 259], [261, 262]], arts: ['/room-scenes/archetype-garden-1.webp', '/room-scenes/archetype-garden-6.webp'] },
  { zone: '1', ranges: [[889, 891]], arts: ['/room-scenes/archetype-mine-tunnel-1.webp', '/room-scenes/archetype-mine-tunnel-6.webp'] },

  // High-reuse places whose generated fallback depicted the wrong kind of environment.
  { zone: '1', ranges: [[295, 300], [408, 425], [621, 634]], arts: ['/room-scenes/curated-crossing-sewer.webp'] },
  { zone: '66', ranges: [[411, 446]], arts: ['/room-scenes/curated-maelshyves-ascent.webp'] },
  { zone: '4', ranges: [[140, 172]], arts: ['/room-scenes/curated-hunting-preserve-grasslands.webp'] },
  { zone: '4', ranges: [[301, 320], [327, 328], [330, 340]], arts: ['/room-scenes/curated-rain-grooved-outcrop.webp'] },
  { zone: '98', ranges: [[25, 25], [37, 52], [58, 61], [73, 84]], arts: ['/room-scenes/curated-shadaer-jama.webp'] },
  { zone: '40a', ranges: [[156, 187]], arts: ['/room-scenes/curated-duvli-rinu.webp'] },

  // Velakan roads: replace a single enclosed palace courtyard reused across unrelated roads.
  { zone: '47', ranges: [[97, 114], [363, 363], [401, 403]], arts: ['/room-scenes/archetype-desert-6.webp', '/room-scenes/archetype-desert-2.webp'] },
  { zone: '47', ranges: [[144, 144], [370, 378], [404, 404]], arts: ['/room-scenes/archetype-desert-6.webp', '/room-scenes/archetype-desert-1.webp'] },
  { zone: '47', ranges: [[73, 80], [86, 86]], arts: ['/rooms/47-before-the-palace-wall.webp', '/rooms/47-beside-the-palace-wall.webp'] },
  { zone: '47', ranges: [[352, 359], [361, 361]], arts: ['/rooms/47-before-the-palace-gate.webp', '/rooms/47-palace-gates.webp'] },
  { zone: '47', ranges: [[405, 407]], arts: ['/room-scenes/archetype-desert-6.webp'] },
  { zone: '47', ranges: [[115, 116]], arts: ['/room-scenes/archetype-desert-6.webp'] },

  // Zone 116 cave network: the old shared image was an exterior rocky hillside.
  { zone: '116', ranges: [[108, 137]], arts: ['/room-scenes/archetype-cavern-0.webp', '/room-scenes/archetype-cavern-3.webp', '/room-scenes/archetype-cavern-5.webp'] },
  { zone: '116', ranges: [[506, 506], [508, 511]], arts: ['/room-scenes/archetype-cavern-8.webp', '/room-scenes/archetype-cavern-2.webp'] },
  { zone: '116', ranges: [[94, 98], [105, 106]], arts: ['/room-scenes/archetype-cavern-1.webp', '/room-scenes/archetype-cavern-4.webp'] },
  { zone: '116', ranges: [[138, 142]], arts: ['/room-scenes/archetype-cavern-3.webp', '/room-scenes/archetype-cavern-7.webp'] },
  { zone: '116', ranges: [[336, 338], [341, 341]], arts: ['/room-scenes/archetype-mine-tunnel-1.webp', '/room-scenes/archetype-mine-tunnel-6.webp'] },
  { zone: '116', ranges: [[496, 499]], arts: ['/room-scenes/archetype-cavern-0.webp', '/room-scenes/archetype-cavern-6.webp'] },
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
