/**
 * Which activities are pinned to the Quick Switch bar, and in what order.
 *
 * Started as Task Flows only, back when a flow was TypeScript composed
 * client-side. The flow engine is gone now (see `pythonTasks.ts`'s header) —
 * a pinned "task" here is a Python task id, started and stopped the same way
 * a flow used to be, through the same `requestStartFlow`/`requestStopAll`
 * signals in `flowStop.ts`, which kept their names across that rewrite.
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
 * summary are looked up live from the Python catalog (`pythonStatus()`),
 * same as a pinned script's catalog entry is looked up live from
 * `scriptCatalog.ts` — never copied in here. Neither can be validated
 * against a known-id set at store init any more: both catalogs are read
 * asynchronously (a Tauri invoke, and the bridge's `list_scripts`), not
 * known synchronously the way the old compile-time flow list was. So both
 * kinds are kept on trust, and a pin that no longer names anything real
 * simply fails to start when pressed — the same honest refusal any other
 * missing script already gets.
 */

export type QuickSwitchPin = { kind: 'task'; id: string } | { kind: 'script'; name: string }

const KEY = 'drc.quickswitch.v3'
export const MAX_SLOTS = 50
/** Only this many are reachable by a number key — see the module note. */
export const KEYBOARD_SLOTS = 9

function keyOf(pin: QuickSwitchPin): string {
  return pin.kind === 'task' ? `task:${pin.id}` : `script:${pin.name}`
}

function isPin(x: unknown): x is QuickSwitchPin {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  if (o.kind === 'task') return typeof o.id === 'string' && o.id.length > 0
  if (o.kind === 'script') return typeof o.name === 'string' && o.name.length > 0
  return false
}

function readRaw(): QuickSwitchPin[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isPin)
  } catch {
    return []
  }
}

function writeRaw(pins: QuickSwitchPin[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(pins.slice(0, MAX_SLOTS)))
  } catch {
    // Private mode. Losing the pin order is not worth an error dialog.
  }
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
  return readRaw()
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
