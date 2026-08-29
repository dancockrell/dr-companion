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
import { invokeTauri, isTauri } from './tauri'
import { saveGenieConfig } from './genieConfigWrite'
import {
  loadAllPins,
  replaceAllPins,
  PIN_COLORS,
  PIN_ICONS,
  type MapPin,
  type PinStore,
  type PinColor,
  type PinIcon,
} from './mapPins'

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
 * Parse pins YAML back into a store. Defensive the same way `loadStore` in
 * mapPins.ts is: a malformed file, a wrong shape, or a single bad entry
 * degrades that one entry rather than throwing away everything else in the
 * file - one guildmate's typo in a shared config must not cost every pin
 * in it.
 */
export function yamlToPins(text: string): { store: PinStore; skipped: number } {
  let parsed: unknown
  try {
    parsed = parseYaml(text)
  } catch {
    return { store: {}, skipped: 0 }
  }
  if (typeof parsed !== 'object' || parsed === null) return { store: {}, skipped: 0 }

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
  return { store, skipped }
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
 * Read the shared config file and merge it into localStorage: an imported
 * character's pins replace that character's own list (the file is the
 * thing the player just chose to bring in), but a character present in
 * localStorage and absent from the file keeps what it already had - an
 * empty or partial shared file must not erase pins the file's author never
 * touched.
 */
export async function importPinsFromFile(): Promise<{ imported: number; skipped: number; note: string }> {
  if (!isTauri()) return { imported: 0, skipped: 0, note: 'No Genie install to read from outside the desktop app.' }
  const file = (await invokeTauri('read_genie_config', { leaf: PINS_LEAF })) as {
    found: boolean
    text: string
    note: string
  }
  if (!file.found) return { imported: 0, skipped: 0, note: file.note || `No ${PINS_LEAF} found.` }

  const { store: fromFile, skipped } = yamlToPins(file.text)
  const current = loadAllPins()
  const merged: PinStore = { ...current }
  let imported = 0
  for (const [key, pins] of Object.entries(fromFile)) {
    // A character's existing system pin (corpse marker) survives an import -
    // the file never carries one (see pinsToYaml), so without this an
    // import would silently erase a live corpse marker along with replacing
    // the hand-made pins.
    const keptSystem = (current[key] ?? []).filter((p) => p.system)
    merged[key] = [...pins, ...keptSystem]
    imported += pins.length
  }
  replaceAllPins(merged)
  return { imported, skipped, note: '' }
}
