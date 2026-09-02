/**
 * Which activities are pinned to the Quick Switch bar, and in what order.
 *
 * Started as Task Flows only, back when a flow was TypeScript composed
 * client-side. The flow engine is gone now (see `pythonTasks.ts`'s header) —
 * a pinned "task" here is a Python or TypeScript task id, started and stopped
 * through the same `requestStartFlow`/`requestStopAll` signals in
 * `flowStop.ts`, which kept their names across that rewrite. The language is
 * part of task identity because both catalogs may legitimately contain the
 * same bare id.
 *
 * Extended to pin raw scripts too — "add gui buttons to do common script and
 * macro actions really easy for the player... build a good deal of them."
 * The Script Library already lists every one of the 200+ scripts Lich can
 * run with a Start button, but that list lives behind a scroll and a search
 * box; a player's actual handful of regulars (their hunting script, their
 * bank run, whatever they start every session) deserve the same
 * one-keypress reach a task already gets. A script has no separate id the
 * way a task does — its name *is* its identity to the bridge — so a pin is
 * a tagged union rather than a bare string, and `kind` is what the bar and
 * the two pin buttons (one in TaskFlowPanel, one in ScriptLibraryPanel)
 * branch on.
 *
 * The cap is 50, not 9. "Think like abilities in an MMORPG" was the
 * direction this took: a raid frame or an action-bar addon holds far more
 * than nine abilities, and what makes fifty of them usable is the icon and
 * the tooltip, not a small count. Only the first nine are reachable by a
 * number key — a keyboard has nine digits, not fifty — but the bar itself
 * scrolls, same as a second and third action bar would.
 *
 * Deliberately just references, not copies. A pinned task's own title and
 * summary are looked up live from its Python or TypeScript catalog,
 * same as a pinned script's catalog entry is looked up live from
 * `scriptCatalog.ts` — never copied in here. Neither can be validated
 * against a known-id set at store init any more: both catalogs are read
 * asynchronously (a Tauri invoke, and the bridge's `list_scripts`), not
 * known synchronously the way the old compile-time flow list was. So both
 * kinds are kept on trust, and a pin that no longer names anything real
 * simply fails to start when pressed — the same honest refusal any other
 * missing script already gets.
 */

import { readJSON, writeJSON } from './storage'

export type QuickSwitchPin =
  | { kind: 'command'; actionKey: string }
  | { kind: 'task'; id: string; lang?: TaskLanguage }
  | { kind: 'script'; name: string }

export type TaskLanguage = 'python' | 'typescript'

const KEY = 'drc.quickswitch.v3'
export const MAX_SLOTS = 50
/** Only this many are reachable by a number key — see the module note. */
export const KEYBOARD_SLOTS = 9

function keyOf(pin: QuickSwitchPin): string {
  if (pin.kind === 'command') return `command:${pin.actionKey}`
  return pin.kind === 'task'
    ? `task:${taskPinLanguage(pin)}:${pin.id}`
    : `script:${pin.name}`
}

/** Old pins omitted the language and therefore mean Python. */
export function taskPinLanguage(pin: Extract<QuickSwitchPin, { kind: 'task' }>): TaskLanguage {
  return pin.lang ?? 'python'
}

/** Store state uses the same namespaced identity as TaskFlowPanel's tiles. */
export function taskActiveId(id: string, lang: TaskLanguage = 'python'): string {
  return lang === 'typescript' ? `ts.${id}` : id
}

export function taskPinActiveId(pin: Extract<QuickSwitchPin, { kind: 'task' }>): string {
  return taskActiveId(pin.id, taskPinLanguage(pin))
}

/**
 * Shape-check and upgrade one persisted pin.
 *
 * An early TypeScript implementation stored the panel-only `ts.` prefix in
 * the task id and no language. Those pins looked valid but were sent to the
 * Python backend. Strip that prefix and make the intended backend explicit.
 */
function normalizePin(x: unknown): QuickSwitchPin | null {
  if (typeof x !== 'object' || x === null) return null
  const o = x as Record<string, unknown>
  if (o.kind === 'command') {
    return typeof o.actionKey === 'string' && o.actionKey.length > 0
      ? { kind: 'command', actionKey: o.actionKey }
      : null
  }
  if (o.kind === 'task') {
    if (typeof o.id !== 'string' || o.id.length === 0) return null
    if (o.lang !== undefined && o.lang !== 'python' && o.lang !== 'typescript') return null
    const wasPrefixedTypeScript = o.id.startsWith('ts.') && o.id.length > 3
    const lang: TaskLanguage = o.lang === 'typescript' || (o.lang === undefined && wasPrefixedTypeScript)
      ? 'typescript'
      : 'python'
    const id = lang === 'typescript' && wasPrefixedTypeScript ? o.id.slice(3) : o.id
    return lang === 'python' && o.lang === undefined
      ? { kind: 'task', id }
      : { kind: 'task', id, lang }
  }
  if (o.kind === 'script') {
    return typeof o.name === 'string' && o.name.length > 0
      ? { kind: 'script', name: o.name }
      : null
  }
  return null
}

function readRaw(): QuickSwitchPin[] {
  const parsed = readJSON<unknown>(KEY, [])
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizePin).filter((pin): pin is QuickSwitchPin => pin !== null)
}

function writeRaw(pins: QuickSwitchPin[]): void {
  writeJSON(KEY, pins.slice(0, MAX_SLOTS))
}

/**
 * The pinned entries, in pinned order.
 *
 * Neither kind is filtered against a known-id set here — see the module
 * note for why both are kept on trust now that both catalogs are read
 * asynchronously. A pin that no longer names anything real fails to start
 * when pressed rather than being silently dropped.
 */
export function loadPins(): QuickSwitchPin[] {
  const pins = readRaw()
  // Persist the normalized shape so a broken legacy `ts.*` pin is repaired
  // once rather than rediscovered on every launch. This also removes malformed
  // entries that were already being ignored in memory.
  writeRaw(pins)
  return pins
}

export function isPinned(pins: QuickSwitchPin[], pin: QuickSwitchPin): boolean {
  const k = keyOf(pin)
  return pins.some((p) => keyOf(p) === k)
}

/** Pin, unpin, or (if already at the cap) refuse — returns the new list either way. */
export function togglePin(
  pins: QuickSwitchPin[],
  pin: QuickSwitchPin
): { pins: QuickSwitchPin[]; refused: boolean } {
  const k = keyOf(pin)
  if (pins.some((p) => keyOf(p) === k)) {
    const next = pins.filter((p) => keyOf(p) !== k)
    writeRaw(next)
    return { pins: next, refused: false }
  }
  if (pins.length >= MAX_SLOTS) return { pins, refused: true }
  const next = [...pins, pin]
  writeRaw(next)
  return { pins: next, refused: false }
}

/** Move a pinned entry to a specific slot index, shifting the rest. */
export function reorderPin(
  pins: QuickSwitchPin[],
  pin: QuickSwitchPin,
  toIndex: number
): QuickSwitchPin[] {
  const k = keyOf(pin)
  const from = pins.findIndex((p) => keyOf(p) === k)
  if (from === -1) return pins
  const next = [...pins]
  next.splice(from, 1)
  next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, pin)
  writeRaw(next)
  return next
}
