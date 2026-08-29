/**
 * A player's own choice of icon for a task or script, overriding the
 * built-in map (pythonTasks.ts's ICONS) or the guess (scriptIcons.ts's
 * `inferScriptIcon`).
 *
 * Global, not per-character - unlike mapPins.ts's saved places, a script's
 * icon is a property of the script, and two characters run from the same
 * machine should see the same tile for `flow.hunt` rather than each having
 * to set it again. One localStorage entry, not one per profile.
 */
import { readJSON, writeJSON } from './storage'
import type { ScriptIconKey } from './scriptIcons'
import { SCRIPT_ICON_KEYS } from './scriptIcons'

const STORAGE_KEY = 'drc.script-icons.v1'
type OverrideStore = Record<string, ScriptIconKey>

function loadStore(): OverrideStore {
  const parsed = readJSON<unknown>(STORAGE_KEY, {})
  if (typeof parsed !== 'object' || parsed === null) return {}
  // Validated on read, not trusted on faith: a key written by a future
  // version of this file with an icon key this version has never heard of
  // must not crash the lookup table it feeds - see SCRIPT_ICON_COMPONENT,
  // which is a `Record` with no `undefined` in its type and would otherwise
  // hand a caller a broken component to render.
  const out: OverrideStore = {}
  for (const [id, icon] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof icon === 'string' && (SCRIPT_ICON_KEYS as readonly string[]).includes(icon)) {
      out[id] = icon as ScriptIconKey
    }
  }
  return out
}

/** The player's chosen icon for this entry, if they ever set one. */
export function iconOverrideFor(id: string): ScriptIconKey | undefined {
  return loadStore()[id]
}

export function setIconOverride(id: string, icon: ScriptIconKey): void {
  const store = loadStore()
  store[id] = icon
  writeJSON(STORAGE_KEY, store)
}

/** Back to whatever the built-in map or the guesser would have said. */
export function clearIconOverride(id: string): void {
  const store = loadStore()
  delete store[id]
  writeJSON(STORAGE_KEY, store)
}
