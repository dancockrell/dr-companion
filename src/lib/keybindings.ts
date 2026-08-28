/**
 * Global keyboard input — the single biggest gap against Genie.
 *
 * Read from Dan's own `C:\Genie4\Config\macros.cfg`: NumPad for movement,
 * Escape to abort everything, F-keys for the commands he reaches for most.
 * Right now this client cannot walk a character across a room without a
 * mouse. That is the gap this closes.
 *
 * One global `keydown` listener, one owner, disposed on unmount — same
 * discipline as flowStop.ts, and for the same reason: a second listener
 * installed by a second component is how a key ends up doing two things at
 * once, or one thing twice.
 *
 * Split into a pure resolver (`resolveKeybinding`, no DOM, no side effects,
 * trivially unit-testable) and a thin installer that wires it to the real
 * `window` and the real send functions. The property that matters —
 * "this key does this, unless the player is typing, except Escape" — lives
 * entirely in the pure half.
 */

/** NumPad movement, read directly off Dan's Genie config. */
const MOVEMENT: Record<string, string> = {
  Numpad8: 'n',
  Numpad2: 's',
  Numpad4: 'w',
  Numpad6: 'e',
  Numpad7: 'nw',
  Numpad9: 'ne',
  Numpad1: 'sw',
  Numpad3: 'se',
  NumpadDecimal: 'up',
  Numpad0: 'down',
  Numpad5: 'out',
}

/** F-keys for the commands worth a single press, same source. */
const F_KEYS: Record<string, string> = {
  F1: 'look @',
  F2: 'health',
  F4: 'skills',
}

const GAME_KEYS: Record<string, string> = { ...MOVEMENT, ...F_KEYS }

/**
 * Digit1..Digit9 (the top-row number keys, not NumPad, which movement
 * already owns) switch to the Nth pinned Quick Switch slot. `code` rather
 * than `key` for the same reason movement uses it: layout-independent, and
 * unaffected by Shift.
 */
const QUICK_SWITCH_KEYS: Record<string, number> = {
  Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4,
  Digit6: 5, Digit7: 6, Digit8: 7, Digit9: 8,
}

/**
 * A short, human-readable list for wherever the bindings need to be shown —
 * the command palette entry and the Escape hint both read from this rather
 * than restating it, so the two can never drift apart.
 */
export const KEYBINDING_HELP: string[] = [
  'NumPad 8/2/4/6 — walk north/south/west/east',
  'NumPad 7/9/1/3 — walk northwest/northeast/southwest/southeast',
  'NumPad . / 0 — up / down',
  'NumPad 5 — out',
  'F1 — look at what you\u2019re facing, F2 — health, F4 — skills',
  '1-9 — switch to that Quick Switch slot (pin a task or script to fill one)',
  'Escape — stop all, even while typing in a text field',
]

/**
 * Whether the event's target is somewhere text goes — an input, a textarea,
 * or anything contenteditable (the command line, the flow editor's step
 * boxes, a search field). If so, a bare "n" is a player typing the word
 * "north" into a sentence, not a request to walk, and letting the movement
 * binding fire would make every text field in the app unusable the moment
 * it contained the letter of a bound key.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  // Duck-typed rather than `instanceof HTMLElement` on purpose: identical
  // behavior against a real DOM element (which has both properties), and
  // testable in plain Node with a plain object, where no HTMLElement class
  // exists to be an instance of.
  if (target == null || typeof target !== 'object') return false
  const t = target as { tagName?: unknown; isContentEditable?: unknown }
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable === true
}

export type KeyResolution =
  | { kind: 'game'; command: string }
  | { kind: 'stop' }
  | { kind: 'quickswitch'; slot: number }
  | null

/**
 * Pure decision: what should this keydown do, if anything.
 *
 * Escape is checked before the typing guard on purpose — it is the one
 * binding that must reach the player mid-sentence, because that is exactly
 * when a hunt has gone wrong and they are still typing the command that
 * would not have saved them.
 */
export function resolveKeybinding(
  e: { key: string; code: string },
  typing: boolean
): KeyResolution {
  if (e.key === 'Escape') return { kind: 'stop' }
  if (typing) return null
  const command = GAME_KEYS[e.code]
  if (command) return { kind: 'game', command }
  const slot = QUICK_SWITCH_KEYS[e.code]
  return slot !== undefined ? { kind: 'quickswitch', slot } : null
}

export interface KeybindingHooks {
  /** Send a raw game command — the same path the command line uses. */
  sendGame: (command: string) => void
  /** Stop everything — both halves, same as the footer's own button. */
  stopAll: () => void
  /** Switch to (or, if already running, stop) the Nth pinned Quick Switch slot. */
  quickSwitch: (slot: number) => void
}

/** Installs the one global listener. Returns the cleanup. */
export function installKeybindings(hooks: KeybindingHooks): () => void {
  function onKeyDown(e: KeyboardEvent) {
    const action = resolveKeybinding(e, isTypingTarget(e.target))
    if (!action) return
    e.preventDefault()
    if (action.kind === 'stop') hooks.stopAll()
    else if (action.kind === 'quickswitch') hooks.quickSwitch(action.slot)
    else hooks.sendGame(action.command)
  }
  window.addEventListener('keydown', onKeyDown)
  return () => window.removeEventListener('keydown', onKeyDown)
}
