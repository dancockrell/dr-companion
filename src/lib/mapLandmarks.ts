import type { MapZoneRoom } from '../bridge/types'
import type { PinColor, PinIcon } from './mapPins'

export type LandmarkKind =
  | 'bank'
  | 'healer'
  | 'guild'
  | 'shop'
  | 'inn'
  | 'temple'
  | 'travel'
  | 'craft'
  | 'library'
  | 'hunt'
  | 'trainer'
  | 'weapon'
  | 'armor'
  | 'alchemy'
  | 'magic'
  | 'dock'
  | 'portal'
  | 'office'
  | 'justice'
  | 'post'

export interface MapLandmark {
  kind: LandmarkKind
  label: string
  icon: PinIcon
  color: PinColor
}

/**
 * The mapper writes room titles as "venue, street or district". Only the
 * first half says what the room is. Reading the whole title turned Bank
 * Street into a bank, Market Road into a shop, and Temple Hill Lane into a
 * temple — useful words, attached to the wrong kind of thing.
 *
 * Titles without a comma are already the venue name and stay untouched.
 */
function subjectOf(title: string): string {
  const comma = title.indexOf(',')
  if (comma < 0) return title

  const subject = title.slice(0, comma).trim()
  const context = title.slice(comma + 1).trim()
  // "Temple Hill, Temple Hill Lane" names the district twice; its first
  // half is still geography, not a temple. A real venue such as "Paladins'
  // Guild, Sentinel's Way" does not repeat into its street context.
  return context.toLocaleLowerCase().startsWith(subject.toLocaleLowerCase()) ? '' : subject
}

const RULES: Array<{
  kind: LandmarkKind
  label: string
  icon: PinIcon
  color: PinColor
  pattern: RegExp
  excludePattern?: RegExp
}> = [
  { kind: 'healer', label: 'Healer', icon: 'hospital', color: 'green', pattern: /\b(healer|empath|hospital|triage|infirmary|herbal remed)/i },
  { kind: 'justice', label: 'Court, jail, or constabulary', icon: 'scale', color: 'red', pattern: /\b(court|courthouse|justice|constab\w*|magistrate|jail|gaol|prison|guard office)\b/i, excludePattern: /\bfood\s+court\b/i },
  { kind: 'post', label: 'Post, records, or registry', icon: 'scroll-text', color: 'blue', pattern: /\b(post office|registry|registrar|records office|clerk'?s office|licensing)/i },
  { kind: 'office', label: 'Public office', icon: 'building', color: 'slate', pattern: /\b(office|bureau|administration|administrative|reception|secretary)/i },
  { kind: 'bank', label: 'Bank or vault', icon: 'landmark', color: 'blue', pattern: /\b(bank|teller|vault|exchange|depository|carousel)\b/i },
  { kind: 'trainer', label: 'Trainer', icon: 'dumbbell', color: 'gold', pattern: /\b(trainer|training (room|yard|field)|practice (room|yard)|recruitment office)\b/i },
  { kind: 'weapon', label: 'Weapons', icon: 'bow-arrow', color: 'red', pattern: /\b(weapons?|swords?|blades?|bowyer|fletcher|archery|arms dealer)\b/i },
  { kind: 'armor', label: 'Armor', icon: 'shield', color: 'blue', pattern: /\b(armor|armour|armory|shield|chainmail|plate)\b/i },
  { kind: 'alchemy', label: 'Alchemy', icon: 'flask-conical', color: 'green', pattern: /\b(alchem\w*|apothecar\w*|potions?|herb shop|laboratory)\b/i },
  { kind: 'magic', label: 'Magic', icon: 'wand-sparkles', color: 'purple', pattern: /\b(mages?|magic|magical|enchant|arcane|spell|talisman|wand|grimoire)\b/i },
  { kind: 'portal', label: 'Portal', icon: 'orbit', color: 'purple', pattern: /\b(portal|teleport|moongate|rift)\b/i },
  { kind: 'dock', label: 'Boat travel', icon: 'anchor', color: 'blue', pattern: /\b(dock|pier|ferry|barge|gondola|harbor|harbour|shipyard|wharf)\b/i },
  { kind: 'guild', label: 'Guild or trainer', icon: 'graduation-cap', color: 'purple', pattern: /\b(guild|trainer|training (room|yard|field)|academy|headquarters|recruitment office)\b/i },
  { kind: 'travel', label: 'Travel connection', icon: 'route', color: 'blue', pattern: /\b(gate|dock|pier|ferry|barge|portal|tram|gondola|caravan|travel start|waystation|bridge)\b/i },
  { kind: 'temple', label: 'Temple or shrine', icon: 'church', color: 'purple', pattern: /\b(temple|shrine|altar|chapel|depart)\b/i },
  { kind: 'craft', label: 'Crafting', icon: 'hammer', color: 'gold', pattern: /\b(forge|smithy|workshop|workroom|crafting|alchemy|enchanting|engineering|outfitting|weaving|tannery|repair tools?)\b/i },
  { kind: 'library', label: 'Library or study', icon: 'book-open', color: 'slate', pattern: /\b(library|reading room|archive|scholarship|grimoire)\b/i },
  { kind: 'inn', label: 'Inn or tavern', icon: 'beer', color: 'gold', pattern: /\b(inn|tavern|taproom|pub|bar|alehouse|rest)\b/i },
  { kind: 'shop', label: 'Shop or market', icon: 'shopping-basket', color: 'gold', pattern: /\b(shop|store|market|emporium|armory|weapons?|armor|outfitter|supplies|boutique|wares|cobblery)\b/i },
  { kind: 'hunt', label: 'Hunting or danger', icon: 'crosshair', color: 'red', pattern: /\b(hunting|target range|goblins?|boars?|rats?|ogres?|wyverns?|vipers?|zombies?|undead|spirits?|bloodvines?|moths?|gryphons?|deer|cougars?|wolves|vermin)\b/i },
]

/**
 * Turn cartographer-authored labels and live Lich tags into visible landmarks.
 * Tags are preferred because they are deliberate annotations. Room titles are
 * included as a fallback for live map payloads whose useful noun is carried
 * only in the title. The first rule wins, so a hospital shop reads as a healer
 * before it reads as retail.
 */
export function landmarksFor(room: MapZoneRoom): MapLandmark[] {
  const authored = (room.tags ?? []).filter(Boolean).join(' · ')
  const title = room.title ?? ''
  const subject = subjectOf(title)
  const travel = [room.gateway?.name, room.gateway?.zone, ...(room.leaves ?? [])].filter(Boolean).join(' · ')
  if (!authored && !title && !travel) return []
  // Tags are deliberate cartographer annotations, titles provide human
  // context, and gateway/leaving metadata confirms that a travel-sounding
  // room really crosses zones. Highest score wins; rule order only breaks a
  // tie in favour of the more specific service above the broad category.
  const hits = RULES.map((rule) => ({
    rule,
    score:
      (rule.pattern.test(authored) && !rule.excludePattern?.test(authored) ? (rule.kind === 'shop' || rule.kind === 'craft' ? 2 : 6) : 0) +
      (rule.pattern.test(subject) && !rule.excludePattern?.test(subject) ? (rule.kind === 'shop' || rule.kind === 'craft' ? 1 : 3) : 0) +
      (rule.pattern.test(travel) && !rule.excludePattern?.test(travel) ? 7 : 0) +
      ((room.gateway && ['travel', 'dock', 'portal'].includes(rule.kind)) ? 2 : 0),
  }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)

  // Preserve multiple real dimensions on one room (a guild trainer inside a
  // weapons academy, a shop at a ferry dock) instead of letting one regex
  // erase all the others. Broad categories lose only when a more specific
  // hit explains the same words.
  const specificKinds = new Set(hits.map(({ rule }) => rule.kind))
  const meaningful = hits
    .filter(({ rule }) => {
      if (rule.kind === 'shop' && (specificKinds.has('weapon') || specificKinds.has('armor') || specificKinds.has('alchemy'))) return false
      if (rule.kind === 'craft' && (specificKinds.has('alchemy') || specificKinds.has('magic'))) return false
      if (rule.kind === 'travel' && (specificKinds.has('dock') || specificKinds.has('portal'))) return false
      if (rule.kind === 'guild' && specificKinds.has('trainer')) return false
      return true
    })
    .map(({ rule }) => ({ kind: rule.kind, label: authored || room.title || rule.label, icon: rule.icon, color: rule.color }))

  // One room gets one map badge. A room can have several searchable facts,
  // but three overlapping symbols are not three times as informative. The
  // strongest, most specific identity wins; the room hover card retains the
  // title and authored tags that explain the rest.
  return meaningful.slice(0, 1)
}

/** Compatibility for consumers that only have room for one badge. */
export function landmarkFor(room: MapZoneRoom): MapLandmark | null {
  return landmarksFor(room)[0] ?? null
}

export const LANDMARK_LEGEND: Array<Pick<MapLandmark, 'kind' | 'label' | 'icon' | 'color'>> = RULES.map(
  ({ kind, label, icon, color }) => ({ kind, label, icon, color })
)
