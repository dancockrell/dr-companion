/**
 * Pins as a file, not just a browser's own storage - Dan's ask, 30 Aug 2026:
 * "make a pin locations for the backend, with a savable and editable file
 * that people can save and send in their configurations file with the rest
 * of their configurations in the backend and their yamls."
 *
 * `mapPins.ts` is the live database (localStorage, read on every render).
 * This is the portable snapshot: a human-editable YAML file written into
 * the same Genie `Config` directory `highlights.cfg` and `aliases.cfg`
 * already live in (see `genieConfigWrite.ts` and
 * `src-tauri/src/config_import.rs`), so a player who already backs up or
 * shares that folder gets their pins along with everything else in it for
 * free - no separate export step to remember, no separate place to look.
 *
 * One file for every character, the same way highlights.cfg is not scoped
 * to a character - the `Config` directory itself is global to a Genie
 * install (see `setup::genie_roots`), so splitting this per character would
 * mean a filename scheme this module would have to invent and Genie has no
 * convention for.
 *
 * System pins (the corpse marker) are deliberately left out. They are not a
 * player's decision - the app drops and clears them on its own - and a
 * shared config carrying somebody else's stale death marker would be
 * actively wrong for whoever imports it.
 */
import { load as parseYaml, dump as toYaml } from 'js-yaml'
import { invokeTauri, isTauri } from './tauri.ts'
import { saveGenieConfig } from './genieConfigWrite.ts'
import {
  loadAllPins,
  replaceAllPins,
  PIN_COLORS,
  PIN_ICONS,
  type MapPin,
  type PinStore,
  type PinColor,
  type PinIcon,
} from './mapPins.ts'

export const PINS_LEAF = 'dr-companion-pins.yaml'

/** The on-disk shape - short keys a player editing this by hand would
 *  actually choose, not `roomId`/`createdAt`/`id` verbatim from MapPin. */
interface PinRecord {
  label: string
  room: number
  zone?: string
  color: PinColor
  icon?: PinIcon
  /** The story - see MapPin.note's own comment for why this exists. Carried
   *  through export/import same as every other field: a pin shared without
   *  its story is a label with the whole point removed. */
  story?: string
}

function toRecord(pin: MapPin): PinRecord {
  const rec: PinRecord = { label: pin.label, room: pin.roomId, color: pin.color }
  if (pin.zone) rec.zone = pin.zone
  if (pin.icon) rec.icon = pin.icon
  if (pin.note) rec.story = pin.note
  return rec
}

function fromRecord(rec: unknown, id: string): MapPin | null {
  if (typeof rec !== 'object' || rec === null) return null
  const r = rec as Record<string, unknown>
  const label = typeof r.label === 'string' ? r.label.trim() : ''
  const room = typeof r.room === 'number' ? r.room : Number(r.room)
  if (!label || !Number.isFinite(room)) return null
  const color: PinColor = (PIN_COLORS as readonly string[]).includes(String(r.color))
    ? (r.color as PinColor)
    : 'blue'
  const icon: PinIcon | undefined = (PIN_ICONS as readonly string[]).includes(String(r.icon))
    ? (r.icon as PinIcon)
    : undefined
  const note = typeof r.story === 'string' && r.story.trim() ? r.story : undefined
  return {
    id,
    // A pin read out of a shared Genie config was drawn by a person -
    // theirs or somebody else's - and never by this client's worker.
    provenance: 'player' as const,
    roomId: room,
    zone: typeof r.zone === 'string' ? r.zone : '',
    label,
    color,
    note,
    icon,
    createdAt: Date.now(),
  }
}

/**
 * Every hand-made pin, every character, as YAML - `system` pins excluded
 * (see this file's header). A short comment at the top says what the file
 * is and where it lives, for the player who opens it in a text editor
 * having forgotten why it's there.
 */
export function pinsToYaml(store: PinStore = loadAllPins()): string {
  const out: Record<string, PinRecord[]> = {}
  for (const [key, pins] of Object.entries(store)) {
    const kept = pins.filter((p) => !p.system).map(toRecord)
    if (kept.length) out[key] = kept
  }
  const header =
    '# DR Companion pins - one list per character (name:instance).\n' +
    '# Safe to hand-edit: label, room (Lich room id), zone (optional),\n' +
    `# color (${PIN_COLORS.join('/')}), icon (optional, see PIN_ICONS in mapPins.ts),\n` +
    '# story (optional - what happened here, why it matters).\n' +
    '# Share this file alongside highlights.cfg/aliases.cfg - it lives in the\n' +
    '# same Config folder and travels with the rest of your settings.\n'
  return header + toYaml(out, { sortKeys: false, lineWidth: -1 })
}

/**
 * Parse pins YAML without mutating the live store. A bad individual record is
 * counted and skipped, while syntax/root-shape failures remain explicit errors;
 * an invalid file must never masquerade as a valid empty import.
 */
export type PinsParseResult =
  | { ok: true; store: PinStore; skipped: number; empty: boolean }
  | { ok: false; error: string }

export function yamlToPins(text: string): PinsParseResult {
  let parsed: unknown
  try {
    parsed = parseYaml(text)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  if (parsed == null) return { ok: true, store: {}, skipped: 0, empty: true }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'The pins file must contain character names followed by pin lists.' }
  }

  const store: PinStore = {}
  let skipped = 0
  for (const [key, list] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(list)) {
      skipped++
      continue
    }
    const pins: MapPin[] = []
    list.forEach((rec, i) => {
      const pin = fromRecord(rec, `${key}-${i}-${Math.random().toString(36).slice(2, 8)}`)
      if (pin) pins.push(pin)
      else skipped++
    })
    if (pins.length) store[key] = pins
  }
  return { ok: true, store, skipped, empty: Object.keys(store).length === 0 && skipped === 0 }
}

/**
 * Write every character's pins to the shared config file. Merges nothing -
 * this is a full snapshot, the same contract `write_genie_config` already
 * gives highlights/aliases (a save there is the whole file, not a patch).
 */
export async function exportPinsToFile(): Promise<{ path: string }> {
  const text = pinsToYaml()
  const result = await saveGenieConfig(PINS_LEAF, text)
  return { path: result.path }
}

/**
 * Read and compare the shared file without mutating localStorage. The caller
 * must show the returned impact and explicitly apply per-character choices.
 */
export type PinImportChoice = 'merge' | 'replace' | 'skip'
export interface PinImportCharacterPreview {
  key: string
  incoming: number
  local: number
  added: number
  updated: number
  unchanged: number
  removedByReplace: number
}
export interface PinImportPreview {
  incoming: PinStore
  before: PinStore
  skipped: number
  empty: boolean
  characters: PinImportCharacterPreview[]
}
export interface PinImportResult {
  added: number
  updated: number
  unchanged: number
  skipped: number
  removed: number
  affectedCharacters: number
}

function samePin(a: MapPin, b: MapPin): boolean {
  return a.roomId === b.roomId && a.zone === b.zone && a.label === b.label && a.color === b.color &&
    a.icon === b.icon && a.note === b.note
}

export function previewPinsImport(incoming: PinStore, before: PinStore = loadAllPins(), skipped = 0, empty = false): PinImportPreview {
  const characters = Object.entries(incoming).map(([key, pins]) => {
    const local = (before[key] ?? []).filter((pin) => !pin.system)
    const byRoom = new Map(local.map((pin) => [pin.roomId, pin]))
    let added = 0
    let updated = 0
    let unchanged = 0
    for (const pin of pins) {
      const existing = byRoom.get(pin.roomId)
      if (!existing) added++
      else if (samePin(existing, pin)) unchanged++
      else updated++
    }
    const incomingRooms = new Set(pins.map((pin) => pin.roomId))
    return { key, incoming: pins.length, local: local.length, added, updated, unchanged,
      removedByReplace: local.filter((pin) => !incomingRooms.has(pin.roomId)).length }
  })
  return { incoming, before, skipped, empty, characters }
}

export async function readPinsImportPreview(): Promise<{ preview?: PinImportPreview; note?: string; error?: string }> {
  if (!isTauri()) return { note: 'No Genie install to read from outside the desktop app.' }
  const file = (await invokeTauri('read_genie_config', { leaf: PINS_LEAF })) as {
    found: boolean
    text: string
    note: string
  }
  if (!file.found) return { note: file.note || `No ${PINS_LEAF} found.` }
  const parsed = yamlToPins(file.text)
  if (!parsed.ok) return { error: `Could not parse ${PINS_LEAF}: ${parsed.error}` }
  return { preview: previewPinsImport(parsed.store, loadAllPins(), parsed.skipped, parsed.empty) }
}

let undoSnapshot: PinStore | null = null

export function applyPinsImport(preview: PinImportPreview, choices: Record<string, PinImportChoice>): PinImportResult {
  const next: PinStore = structuredClone(preview.before)
  const result: PinImportResult = { added: 0, updated: 0, unchanged: 0, skipped: preview.skipped, removed: 0, affectedCharacters: 0 }
  for (const character of preview.characters) {
    const choice = choices[character.key] ?? 'merge'
    if (choice === 'skip') {
      result.skipped += character.incoming
      continue
    }
    result.affectedCharacters++
    const incoming = preview.incoming[character.key] ?? []
    const allLocal = preview.before[character.key] ?? []
    const system = allLocal.filter((pin) => pin.system)
    const local = allLocal.filter((pin) => !pin.system)
    if (choice === 'replace') {
      next[character.key] = [...incoming, ...system]
      result.added += character.added
      result.updated += character.updated
      result.unchanged += character.unchanged
      result.removed += character.removedByReplace
      continue
    }
    const merged = new Map(local.map((pin) => [pin.roomId, pin]))
    for (const pin of incoming) {
      const existing = merged.get(pin.roomId)
      if (!existing) result.added++
      else if (samePin(existing, pin)) result.unchanged++
      else result.updated++
      merged.set(pin.roomId, pin)
    }
    next[character.key] = [...merged.values(), ...system]
  }
  undoSnapshot = structuredClone(preview.before)
  replaceAllPins(next)
  return result
}

export function undoLastPinsImport(): boolean {
  if (!undoSnapshot) return false
  replaceAllPins(undoSnapshot)
  undoSnapshot = null
  return true
}
