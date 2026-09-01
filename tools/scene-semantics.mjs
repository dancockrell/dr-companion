const textOf = (value) => String(value ?? '').toLowerCase()

const CATEGORY_RULES = [
  { category: 'sewer', title: /\b(sewer|drain|cesspit|waste tunnel)\b/, lore: /\b(sewage|sewer|drainage|wastewater)\b/, traits: { environment: 'underground', subtype: 'sewer', water: 'present', civilization: 'infrastructure' } },
  { category: 'mine-tunnel', title: /\b(tunnel|tunnels|cavern|caverns|cave|catacombs|burrows|warrens|labyrinth|mine|shaft|ossuary|sepulcher)\b/, lore: /\b(subterranean|underground|tunnel|cavern|stalactite|mine shaft)\b/, traits: { environment: 'underground', subtype: 'passage', civilization: 'mixed' } },
  { category: 'desert', title: /\b(desert|dune|dunes|sands|sand valley|waste|badlands)\b/, lore: /\b(dunes?|arid|parched|sand stretches|sandy expanse)\b/, traits: { environment: 'desert', subtype: 'overland', water: 'absent', civilization: 'wilderness', elevation: 'low' } },
  { category: 'swamp', title: /\b(swamp|marsh|fen|fens|bog|muck|morass|wetland)\b/, lore: /\b(marsh|bog|swamp|standing water|reeds|muddy water|soggy)\b/, traits: { environment: 'wetland', subtype: 'overland', water: 'present', civilization: 'wilderness', elevation: 'low' } },
  { category: 'riverside', title: /\b(river|riverside|water's edge|waters edge|lake shore|shoreline|riverbank|channel|stream|creek|waterfall)\b/, lore: /\b(river|stream|creek|flowing water|riverbank|shoreline|waterfall)\b/, traits: { environment: 'waterside', subtype: 'bank', water: 'present', civilization: 'wilderness', elevation: 'low' } },
  { category: 'mountain-pass', title: /\b(mountain|ridge|cliff|outcrop|pass|escarpment|ascent|summit|slope|peak|crag)\b/, lore: /\b(steep|mountain|cliff|precipice|ridge|summit|high above|rocky ascent)\b/, traits: { environment: 'mountain', subtype: 'route', civilization: 'wilderness', elevation: 'high' } },
  { category: 'garden', title: /\b(garden|gardens|courtyard|orchard|arboretum)\b/, lore: /\b(flowerbeds?|hedges?|orchard|cultivated garden|courtyard)\b/, traits: { environment: 'cultivated', subtype: 'garden', civilization: 'settled', elevation: 'low' } },
  { category: 'grassland', title: /\b(grassland|grasslands|prairie|meadow|field|fields|savanna|farmland|farmlands|pasture)\b/, lore: /\b(tall grass|grassland|meadow|pasture|tilled|cultivated|rows of crops|open field)\b/, traits: { environment: 'grassland', subtype: 'overland', civilization: 'wilderness', elevation: 'low' } },
  { category: 'deep-forest', title: /\b(forest|woods|wood|grove|understory|brambles|tangle|thicket|jungle)\b/, lore: /\b(forest|woodland|trees|canopy|undergrowth|brambles|thicket|grove)\b/, traits: { environment: 'forest', subtype: 'interior', civilization: 'wilderness', elevation: 'low' } },
  { category: 'regional-city', title: /\b(street|circle|boulevard|plaza|lane|avenue|promenade|city walk|town road|highway)\b/, lore: /\b(cobbled|buildings line|shops line|city street|town street)\b/, traits: { environment: 'settlement', subtype: 'street', civilization: 'urban', elevation: 'low' } },
]

const ROUTE = /\b(path|trail|road|track|way|trace|route)\b/
const SPORTS = /\b(goal line|field of play|arena|stadium|tournament|playing field)\b/
const SETTLEMENT = /\b(building|buildings|house|houses|shop|shops|wall|walls|gate|town|city|village|settlement|cottage|inn|temple)\b/
const WATER = /\b(river|stream|creek|water|pool|lake|shore|marsh|swamp|bog|canal)\b/
const ELEVATED = /\b(mountain|ridge|cliff|peak|summit|slope|ascent|precipice|high above)\b/
const AUTO_ASSIGN_SCORE = 5

function unknownAnalysis(text, signals = [], confidence = 0) {
  return {
    category: null,
    confidence,
    traits: {
      environment: 'unknown',
      subtype: 'unknown',
      water: WATER.test(text) ? 'present' : 'unknown',
      elevation: ELEVATED.test(text) ? 'high' : 'unknown',
      civilization: SETTLEMENT.test(text) ? 'settled' : 'unknown',
      route: ROUTE.test(text),
    },
    signals,
  }
}

function mergeTraits(base, title, lore) {
  const text = `${title} ${lore}`
  return {
    ...base,
    water: WATER.test(text) ? 'present' : (base.water ?? 'unknown'),
    elevation: ELEVATED.test(text) ? 'high' : (base.elevation ?? 'unknown'),
    civilization: SETTLEMENT.test(text) && base.civilization === 'wilderness' ? 'mixed' : (base.civilization ?? 'unknown'),
    route: ROUTE.test(text),
  }
}

export function analyzeScene(place) {
  const title = textOf(place?.title ?? place?.place)
  const lore = textOf(place?.lore)
  const text = `${title} ${lore}`

  if (SPORTS.test(text)) {
    return { category: null, confidence: 1, traits: { environment: 'special', subtype: 'sports' }, signals: ['excluded:sports'] }
  }

  const scored = CATEGORY_RULES.map((rule) => {
    const signals = []
    let score = 0
    if (rule.title.test(title)) {
      score += 5
      signals.push(`title:${rule.category}`)
    }
    if (rule.lore.test(lore)) {
      score += 2
      signals.push(`lore:${rule.category}`)
    }
    return { ...rule, score, signals }
  }).filter((rule) => rule.score > 0)

  scored.sort((a, b) => b.score - a.score || CATEGORY_RULES.indexOf(a) - CATEGORY_RULES.indexOf(b))
  const best = scored[0]
  if (!best) return unknownAnalysis(text)

  // Lore is useful evidence, but a single lore keyword is too weak to choose art for
  // an entire multi-room place. Automatic basket assignment therefore requires a
  // category signal in the place title. Low-confidence lore still survives in the
  // audit report so it can guide later curation without showing the player bad art.
  if (best.score < AUTO_ASSIGN_SCORE) {
    return unknownAnalysis(text, best.signals, Math.min(1, best.score / 7))
  }

  // A title that is explicitly forest-like plus a route signal is visually different
  // enough to use the forest-path basket. Do not promote lore-only forests to paths.
  if (best.category === 'deep-forest' && ROUTE.test(text)) {
    return {
      category: 'forest-path',
      confidence: Math.min(1, best.score / 7),
      traits: mergeTraits({ ...best.traits, subtype: 'route' }, title, lore),
      signals: [...best.signals, 'route:forest-path'],
    }
  }

  return {
    category: best.category,
    confidence: Math.min(1, best.score / 7),
    traits: mergeTraits(best.traits, title, lore),
    signals: best.signals,
  }
}

export function semanticPromptContext(analysis) {
  const traits = analysis?.traits ?? {}
  const parts = []
  if (traits.civilization === 'wilderness') parts.push('natural wilderness, no settlement architecture unless described')
  if (traits.civilization === 'urban') parts.push('inhabited fantasy settlement')
  if (traits.environment === 'underground') parts.push('subterranean space, light sources only where the room description supports them')
  if (traits.water === 'present') parts.push('water is a visible environmental feature')
  if (traits.elevation === 'high') parts.push('strong vertical relief and elevated terrain')
  if (traits.route) parts.push('preserve a readable traversable route through the scene')
  return parts.join(', ')
}
