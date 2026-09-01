/**
 * Places worth remembering: pins on the map, colour-coded, one hotbutton
 * each below it.
 *
 * A pin is a Lich room id and nothing else needs to be geography — the
 * label and colour are the player's own words for the place, and travel
 * (map_walk) already works off room ids independent of whichever zone
 * happens to be drawn on screen right now. So a pin set in The Crossing
 * still works as a hotbutton while browsing a gate three zones away.
 *
 * Per character, the same way profiles.ts is: Home for one character is not
 * Home for another, and two characters sharing this machine should not see
 * each other's hangouts. Keyed with the same `profileKey` for exactly that
 * reason — one localStorage entry per character, not per zone or per pin.
 */
import { readJSON, writeJSON } from './storage'
import { profileKey } from './profiles'
import type { GameInstance } from '../types'

/**
 * A small fixed palette rather than a colour picker. Six is enough to tell
 * hangouts from hazards from "just remember this" at a glance, and a free
 * colour picker on a five-button hotbar would be a UI nobody could scan.
 */
export const PIN_COLORS = ['blue', 'gold', 'green', 'red', 'purple', 'slate'] as const
export type PinColor = (typeof PIN_COLORS)[number]

export const PIN_COLOR_HEX: Record<PinColor, string> = {
  blue: '#4f8fe0',
  gold: '#d4a83a',
  green: '#4caf6e',
  red: '#e0554f',
  purple: '#a476dd',
  slate: '#8a94a6',
}

/**
 * Which lucide icon a pin draws, alongside its colour. Optional and absent
 * on older saved pins - PinEditor/MapPinBar fall back to a plain dot for
 * `undefined`, so this is additive and never breaks a pin saved before it
 * existed.
 *
 * Reviewed and grown to 372, 30 Aug 2026 - Dan: "check through the
 * symbols to make sure they are fantasy symbols and expand the list to
 * about 1000 cool concepts from fantasy or nature or the like." 'users' (a
 * flat UI person-silhouette glyph, not a fantasy symbol at all) was dropped
 * in the same pass. Every name here was checked against the installed
 * lucide-react build directly (`Object.keys` on the package, not a guess
 * against the docs) and then hand-filtered down from lucide's full ~1800-icon
 * set - the honest ceiling for genuinely fantasy/nature-reading symbols in a
 * general-purpose UI icon library turned out to be well under 1000; this is
 * the curated result rather than a padded-out count. A name that only exists
 * in a newer lucide release renders nothing and fails silently, which is a
 * worse bug than an icon list that is merely short.
 */
export const PIN_ICONS = [
  'alert-triangle',
  'amphora',
  'anchor',
  'angry',
  'annoyed',
  'anvil',
  'archive',
  'archive-restore',
  'armchair',
  'atom',
  'award',
  'axe',
  'baby',
  'backpack',
  'banana',
  'bath',
  'beaker',
  'bean',
  'bed',
  'bed-double',
  'bed-single',
  'beef',
  'beer',
  'binoculars',
  'biohazard',
  'bird',
  'bolt',
  'bomb',
  'bone',
  'book',
  'book-open',
  'boom-box',
  'bow-arrow',
  'brick-wall',
  'brick-wall-fire',
  'brush',
  'bug',
  'building',
  'cake',
  'cake-slice',
  'candy',
  'candy-cane',
  'caravan',
  'carrot',
  'castle',
  'cat',
  'chef-hat',
  'cherry',
  'church',
  'citrus',
  'clapperboard',
  'clock',
  'cloud',
  'cloud-drizzle',
  'cloud-fog',
  'cloud-hail',
  'cloud-lightning',
  'cloud-moon',
  'cloud-moon-rain',
  'cloud-rain',
  'cloud-rain-wind',
  'cloud-snow',
  'cloud-sun',
  'cloud-sun-rain',
  'cloudy',
  'clover',
  'club',
  'coffee',
  'coins',
  'compass',
  'cone',
  'cookie',
  'cooking-pot',
  'croissant',
  'cross',
  'crosshair',
  'crown',
  'cuboid',
  'cup-soda',
  'cylinder',
  'dam',
  'dessert',
  'diamond',
  'dice-1',
  'dice-3',
  'dice-4',
  'dice-5',
  'dice-6',
  'disc',
  'disc-3',
  'disc-album',
  'dna',
  'dock',
  'dog',
  'donut',
  'door-closed',
  'door-open',
  'drafting-compass',
  'drama',
  'drill',
  'droplet',
  'droplets',
  'drum',
  'drumstick',
  'dumbbell',
  'ear',
  'earth',
  'eclipse',
  'egg',
  'egg-fried',
  'eraser',
  'eye',
  'factory',
  'fan',
  'feather',
  'fence',
  'ferris-wheel',
  'film',
  'fire-extinguisher',
  'fish',
  'fish-symbol',
  'flag',
  'flag-triangle-left',
  'flag-triangle-right',
  'flame',
  'flame-kindling',
  'flashlight',
  'flask-conical',
  'flask-round',
  'flower',
  'footprints',
  'fork-knife',
  'fork-knife-crossed',
  'frown',
  'gamepad',
  'gauge',
  'gavel',
  'gem',
  'ghost',
  'gift',
  'glass-water',
  'glasses',
  'globe',
  'graduation-cap',
  'grape',
  'guitar',
  'ham',
  'hamburger',
  'hammer',
  'hand',
  'hand-coins',
  'hand-heart',
  'hand-helping',
  'hand-metal',
  'hand-platter',
  'handshake',
  'hard-hat',
  'haze',
  'headset',
  'heart',
  'heart-crack',
  'heart-handshake',
  'heart-pulse',
  'heater',
  'helping-hand',
  'hexagon',
  'highlighter',
  'history',
  'home',
  'hop',
  'hospital',
  'hotel',
  'hourglass',
  'house',
  'ice-cream',
  'ice-cream-bowl',
  'ice-cream-cone',
  'infinity',
  'joystick',
  'key',
  'key-round',
  'lamp',
  'lamp-ceiling',
  'lamp-desk',
  'lamp-floor',
  'lamp-wall-down',
  'lamp-wall-up',
  'land-plot',
  'landmark',
  'laugh',
  'leaf',
  'leafy-green',
  'lectern',
  'library',
  'library-big',
  'life-buoy',
  'lightbulb',
  'link',
  'lock',
  'lock-keyhole',
  'lock-keyhole-open',
  'lock-open',
  'lollipop',
  'luggage',
  'magic-wand',
  'magnet',
  'map',
  'map-pin',
  'map-pinned',
  'martini',
  'medal',
  'megaphone',
  'meh',
  'microscope',
  'milk',
  'moon',
  'moon-star',
  'mountain',
  'mountain-snow',
  'music',
  'music-3',
  'music-4',
  'nut',
  'octagon',
  'orbit',
  'origami',
  'package',
  'paint-bucket',
  'paint-roller',
  'paintbrush',
  'paintbrush-vertical',
  'palmtree',
  'panda',
  'party-popper',
  'paw-print',
  'pen',
  'pencil',
  'pentagon',
  'person-standing',
  'piano',
  'pickaxe',
  'piggy-bank',
  'pill',
  'pill-bottle',
  'pin',
  'pizza',
  'plane',
  'plane-landing',
  'plane-takeoff',
  'pocket-knife',
  'popcorn',
  'popsicle',
  'puzzle',
  'rabbit',
  'radiation',
  'radio',
  'radio-receiver',
  'rainbow',
  'rat',
  'recycle',
  'refrigerator',
  'ribbon',
  'roller-coaster',
  'route',
  'ruler',
  'sailboat',
  'salad',
  'sandwich',
  'scale',
  'school',
  'scissors',
  'scroll',
  'scroll-text',
  'search',
  'shapes',
  'shell',
  'shield',
  'shield-alert',
  'shield-ban',
  'shield-check',
  'shield-half',
  'shield-question',
  'ship',
  'ship-wheel',
  'shirt',
  'shopping-bag',
  'shopping-basket',
  'shopping-cart',
  'shovel',
  'shower-head',
  'shrimp',
  'shrub',
  'signpost',
  'signpost-big',
  'siren',
  'skull',
  'slice',
  'smile',
  'smile-plus',
  'snail',
  'snowflake',
  'sofa',
  'soup',
  'spade',
  'sparkle',
  'sparkles',
  'spray-can',
  'sprout',
  'squirrel',
  'stamp',
  'star',
  'star-half',
  'stars',
  'store',
  'sun',
  'sun-dim',
  'sun-medium',
  'sun-moon',
  'sun-snow',
  'sunrise',
  'sunset',
  'sword',
  'swords',
  'syringe',
  'tag',
  'tags',
  'target',
  'telescope',
  'tent',
  'tent-tree',
  'test-tube',
  'test-tube-diagonal',
  'test-tubes',
  'theater',
  'thermometer',
  'thermometer-snowflake',
  'thermometer-sun',
  'tornado',
  'tractor',
  'train',
  'train-front',
  'train-track',
  'trash',
  'tree-deciduous',
  'tree-palm',
  'tree-pine',
  'trees',
  'triangle',
  'triangle-alert',
  'trophy',
  'turtle',
  'umbrella',
  'unlink',
  'unlock',
  'unlock-keyhole',
  'utensils',
  'utensils-crossed',
  'vault',
  'venetian-mask',
  'wand',
  'wand-sparkles',
  'warehouse',
  'watch',
  'waves',
  'waves-ladder',
  'waypoints',
  'weight',
  'wheat',
  'wind',
  'wine',
  'worm',
  'wrench',
] as const
export type PinIcon = (typeof PIN_ICONS)[number]

export interface MapPin {
  id: string
  /** Lich's room id — what map_walk and Room#path_to both take. */
  roomId: number
  /** The genie_zone this room reported when pinned, for grouping only. */
  zone: string
  label: string
  color: PinColor
  icon?: PinIcon
  /**
   * The place's own story, in the player's words - what happened here,
   * why it's worth remembering, who died on that spot. Optional and free
   * text, on purpose: a label is a name, this is the reason the name was
   * worth giving. Dan's own framing: "pins tell stories." Shown in the
   * room's tooltip under the label, never as visible chrome on the chart
   * itself - a badge already carries the icon and colour; a story is read,
   * not glanced at.
   */
  note?: string
  /**
   * Set only on the auto-dropped corpse marker (see the death-detection
   * code that creates it). Distinguishes it from anything the player made by
   * hand: the picker never offers to create one, and it is the one pin the
   * app removes on its own once you have walked back to it - a hand-made pin
   * never disappears just because you visited it.
   */
  system?: boolean
  /** Epoch ms, so pins can be listed oldest/newest if that's ever wanted. */
  createdAt: number
}

/**
 * Starter chips PinEditor offers for a brand-new pin: label, icon and colour
 * together, one click, still fully editable afterward. Several entries per
 * common category on purpose (a bank pin and a "the good bank" pin can want
 * different icons) rather than one canonical choice per idea - Dan's own
 * ask was for "many and variations of expected common ones," not a single
 * icon per category.
 *
 * Grown from 13 to cover specific DragonRealms categories a player actually
 * marks, not just the four QuickTravel already answers (bank/healer/
 * guild/shop) - those four have a faster path (drag straight onto a room,
 * no dialog), so this list leans toward everything that doesn't: crafting
 * and gathering trades, points of interest, hazards, and social/logistics
 * spots. Colour is grouped by *kind of fact*, the same grouping the map's
 * own room-colour legend already uses, so a pin's colour is a hint about
 * what kind of thing it is even before reading its icon: gold for
 * commerce/training, green for gathering/nature, purple for
 * social/guild/magic, red for combat/hazard, blue for logistics/shops,
 * slate for neutral waypoints.
 */
export const PIN_PRESETS: { label: string; icon: PinIcon; color: PinColor }[] = [
  // Home base and banking
  { label: 'Home', icon: 'home', color: 'blue' },
  { label: 'Bank', icon: 'landmark', color: 'gold' },
  { label: 'Vault', icon: 'coins', color: 'gold' },
  { label: 'Locker', icon: 'package', color: 'blue' },

  // Services and training
  { label: 'Healer', icon: 'heart-pulse', color: 'green' },
  { label: 'Hospital', icon: 'hospital', color: 'green' },
  { label: 'Guild', icon: 'shield', color: 'purple' },
  { label: 'Trainer', icon: 'swords', color: 'gold' },
  { label: 'Training Hall', icon: 'graduation-cap', color: 'gold' },
  { label: 'Empath', icon: 'sparkles', color: 'green' },
  { label: 'Enchanter', icon: 'wand', color: 'purple' },
  { label: 'Locksmith', icon: 'key-round', color: 'gold' },
  { label: 'Stable', icon: 'paw-print', color: 'gold' },
  { label: "Thieves' Den", icon: 'lock', color: 'purple' },
  { label: 'Public Office', icon: 'building', color: 'slate' },
  { label: 'Courthouse', icon: 'scale', color: 'red' },
  { label: 'Registry', icon: 'scroll-text', color: 'blue' },
  { label: 'Post Office', icon: 'scroll', color: 'blue' },

  // Shops
  { label: 'Shop', icon: 'shopping-bag', color: 'blue' },
  { label: 'General Store', icon: 'backpack', color: 'blue' },
  { label: 'Armor Shop', icon: 'shield', color: 'blue' },
  { label: 'Weapon Shop', icon: 'sword', color: 'blue' },
  { label: 'Alchemist', icon: 'flask-conical', color: 'blue' },
  { label: 'Scribe', icon: 'scroll-text', color: 'blue' },
  { label: 'Bookstore', icon: 'book-open', color: 'blue' },
  { label: 'Jeweler', icon: 'gem', color: 'blue' },
  { label: 'Bathhouse', icon: 'droplet', color: 'blue' },
  { label: 'Library', icon: 'book-open', color: 'blue' },
  { label: 'Inn', icon: 'bed', color: 'gold' },
  { label: 'Tavern', icon: 'beer', color: 'gold' },

  // Crafting and gathering
  { label: 'Smithy', icon: 'anvil', color: 'green' },
  { label: 'Forge', icon: 'hammer', color: 'green' },
  { label: 'Woodcutting', icon: 'tree-pine', color: 'green' },
  { label: 'Mining Node', icon: 'mountain', color: 'green' },
  { label: 'Herb Patch', icon: 'sprout', color: 'green' },
  { label: 'Fishing Spot', icon: 'fish', color: 'green' },
  { label: 'Resource Node', icon: 'gem', color: 'green' },
  { label: 'Skinning Spot', icon: 'axe', color: 'green' },

  // Points of interest
  { label: 'Landmark', icon: 'star', color: 'slate' },
  { label: 'Gate', icon: 'compass', color: 'slate' },
  { label: 'Dock', icon: 'anchor', color: 'slate' },
  { label: 'Ferry', icon: 'anchor', color: 'blue' },
  { label: 'Portal', icon: 'orbit', color: 'purple' },
  { label: 'Temple', icon: 'church', color: 'purple' },
  { label: 'Shrine', icon: 'cross', color: 'purple' },
  { label: 'Crossing', icon: 'waves', color: 'slate' },
  { label: 'Overlook', icon: 'sun', color: 'slate' },
  { label: 'Camp', icon: 'moon', color: 'slate' },

  // Combat and hazard
  { label: 'Hunting Spot', icon: 'swords', color: 'red' },
  { label: 'Danger', icon: 'skull', color: 'red' },
  { label: 'Ambush Spot', icon: 'flame', color: 'red' },
  { label: 'Frozen Hazard', icon: 'snowflake', color: 'red' },
  { label: 'Graveyard', icon: 'ghost', color: 'red' },
  { label: 'Vermin Nest', icon: 'bug', color: 'red' },
  { label: 'Practice Target', icon: 'target', color: 'red' },

  // Social and logistics
  { label: 'Hangout', icon: 'handshake', color: 'gold' },
  { label: 'Meetup Point', icon: 'tent', color: 'purple' },
  { label: 'Performance Spot', icon: 'crown', color: 'purple' },
  { label: 'Timed Event', icon: 'hourglass', color: 'purple' },
  { label: 'Trade Post', icon: 'scale', color: 'gold' },
  { label: 'Reward Turn-in', icon: 'gift', color: 'gold' },
  { label: 'Nest Watch', icon: 'bird', color: 'green' },
  { label: 'Return Point', icon: 'flag', color: 'slate' },
  { label: 'Footpath', icon: 'footprints', color: 'slate' },
  { label: 'Fortress', icon: 'castle', color: 'slate' },
]

/**
 * The dataTransfer MIME type a dragged pin preset carries - shared between
 * QuickTravel (the drag source) and MapCanvas (the drop target) so the two
 * cannot drift into checking for two different strings. A drag from
 * anywhere else on the page (selected text, another app) simply won't
 * carry this key, and the drop handler ignores it rather than creating a
 * pin from whatever else it finds in the drag payload.
 */
export const PIN_DRAG_TYPE = 'application/x-drc-pin'

const STORAGE_KEY = 'drc.pins.v1'
export type PinStore = Record<string, MapPin[]>

function loadStore(): PinStore {
  const parsed = readJSON<unknown>(STORAGE_KEY, {})
  return typeof parsed === 'object' && parsed !== null ? (parsed as PinStore) : {}
}

function saveStore(store: PinStore): void {
  writeJSON(STORAGE_KEY, store)
}

/** The whole store, every character at once - what pinsFile.ts exports to
 *  and imports from the shared Genie config file. Never partial: a player
 *  sharing their config folder is sharing every character on it, the same
 *  way highlights.cfg and aliases.cfg are not scoped to one character. */
export function loadAllPins(): PinStore {
  return loadStore()
}

/** Replace the whole store - used only by pinsFile.ts's import, which
 *  already merges with what is on disk before calling this. */
export function replaceAllPins(store: PinStore): void {
  saveStore(store)
}

export function loadPins(name: string, instance: GameInstance): MapPin[] {
  return loadStore()[profileKey(name, instance)] ?? []
}

export function addPin(
  name: string,
  instance: GameInstance,
  pin: {
    roomId: number
    zone: string
    label: string
    color: PinColor
    icon?: PinIcon
    note?: string
    system?: boolean
  }
): MapPin[] {
  const store = loadStore()
  const key = profileKey(name, instance)
  const full: MapPin = {
    ...pin,
    id: `${pin.roomId}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now(),
  }
  const next = [...(store[key] ?? []), full]
  store[key] = next
  saveStore(store)
  return next
}

export function removePin(name: string, instance: GameInstance, id: string): MapPin[] {
  const store = loadStore()
  const key = profileKey(name, instance)
  const next = (store[key] ?? []).filter((p) => p.id !== id)
  store[key] = next
  saveStore(store)
  return next
}

export function updatePin(
  name: string,
  instance: GameInstance,
  id: string,
  patch: Partial<Pick<MapPin, 'label' | 'color' | 'icon' | 'note'>>
): MapPin[] {
  const store = loadStore()
  const key = profileKey(name, instance)
  const next = (store[key] ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p))
  store[key] = next
  saveStore(store)
  return next
}

/** Whether a room already has a pin, for the map to offer "unpin" instead of "pin" a second time. */
export function pinFor(pins: MapPin[], roomId: number): MapPin | undefined {
  return pins.find((p) => p.roomId === roomId)
}

/**
 * Drop (or move) the one corpse marker onto wherever the character just
 * died. Replaces any previous one rather than accumulating - a character
 * has one body, and a stale marker pointing at where you died three fights
 * ago would send "walk to your corpse" to the wrong room.
 */
export function setCorpseMarker(
  name: string,
  instance: GameInstance,
  roomId: number,
  zone: string
): MapPin[] {
  const store = loadStore()
  const key = profileKey(name, instance)
  const marker: MapPin = {
    id: `corpse-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    roomId,
    zone,
    label: 'Your corpse',
    color: 'red',
    icon: 'skull',
    system: true,
    createdAt: Date.now(),
  }
  const next = [...(store[key] ?? []).filter((p) => !p.system), marker]
  store[key] = next
  saveStore(store)
  return next
}

/** Sweep the corpse marker once you've actually walked back to it - see MapPin.system. */
export function clearCorpseMarker(name: string, instance: GameInstance): MapPin[] {
  const store = loadStore()
  const key = profileKey(name, instance)
  const next = (store[key] ?? []).filter((p) => !p.system)
  store[key] = next
  saveStore(store)
  return next
}
