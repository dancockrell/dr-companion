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
 * Fifty rather than the original sixteen - Dan's ask was for enough variety
 * that a player (or a script - see mapPins.ts's addPin, which takes any of
 * these) never has to reuse "shield" for three unrelated things. Every name
 * here was checked against the installed lucide-react build directly
 * (`Object.keys` on the package, not a guess against the docs) before being
 * added - a name that only exists in a newer lucide release renders nothing
 * and fails silently, which is a worse bug than an icon list that is merely
 * short.
 */
export const PIN_ICONS = [
  'home',
  'landmark',
  'coins',
  'heart-pulse',
  'shield',
  'shopping-bag',
  'backpack',
  'sword',
  'swords',
  'users',
  'tent',
  'flag',
  'skull',
  'ghost',
  'sprout',
  'map-pin',
  'castle',
  'anvil',
  'hammer',
  'axe',
  'flask-conical',
  'gem',
  'key-round',
  'lock',
  'star',
  'compass',
  'footprints',
  'flame',
  'droplet',
  'snowflake',
  'mountain',
  'tree-pine',
  'bird',
  'fish',
  'bug',
  'crown',
  'hourglass',
  'scroll-text',
  'book-open',
  'package',
  'gift',
  'paw-print',
  'wand',
  'scale',
  'target',
  'anchor',
  'waves',
  'sun',
  'moon',
  'sparkles',
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
 */
export const PIN_PRESETS: { label: string; icon: PinIcon; color: PinColor }[] = [
  { label: 'Home', icon: 'home', color: 'blue' },
  { label: 'Bank', icon: 'landmark', color: 'gold' },
  { label: 'Vault', icon: 'coins', color: 'gold' },
  { label: 'Healer', icon: 'heart-pulse', color: 'green' },
  { label: 'Guild', icon: 'shield', color: 'purple' },
  { label: 'Shop', icon: 'shopping-bag', color: 'blue' },
  { label: 'General Store', icon: 'backpack', color: 'blue' },
  { label: 'Hunting Spot', icon: 'swords', color: 'red' },
  { label: 'Danger', icon: 'skull', color: 'red' },
  { label: 'Hangout', icon: 'users', color: 'gold' },
  { label: 'Meetup Point', icon: 'tent', color: 'purple' },
  { label: 'Resource Node', icon: 'sprout', color: 'green' },
  { label: 'Return Point', icon: 'flag', color: 'slate' },
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
type PinStore = Record<string, MapPin[]>

function loadStore(): PinStore {
  const parsed = readJSON<unknown>(STORAGE_KEY, {})
  return typeof parsed === 'object' && parsed !== null ? (parsed as PinStore) : {}
}

function saveStore(store: PinStore): void {
  writeJSON(STORAGE_KEY, store)
}

export function loadPins(name: string, instance: GameInstance): MapPin[] {
  return loadStore()[profileKey(name, instance)] ?? []
}

export function addPin(
  name: string,
  instance: GameInstance,
  pin: { roomId: number; zone: string; label: string; color: PinColor; icon?: PinIcon; system?: boolean }
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
  patch: Partial<Pick<MapPin, 'label' | 'color' | 'icon'>>
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
