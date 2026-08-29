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
 * `KeyboardEvent.code` → the key name Genie itself writes into `macros.cfg`
 * (`System.Windows.Forms.Keys`, not a web key code). Read off every distinct
 * key Dan's real 95-entry file actually uses - F1–F12, NumPad0–9 plus the
 * four numpad operators, the digit row (only ever bound with Control, as
 * `D0`…`D9`), and bare letters. Not attempting the rest of the `Keys` enum:
 * a code this returns `null` for is one no macro in the observed corpus ever
 * bound, so extending the map further would be guessing at a spec rather
 * than reading one. Used by both the live keydown resolver (once macro.cfg
 * bindings are wired up) and MacrosEditor's "press a key" capture, so the
 * two can never name a combo differently.
 */
export function codeToGenieKey(code: string): string | null {
  if (/^F(1[0-2]|[1-9])$/.test(code)) return code
  if (/^Numpad[0-9]$/.test(code)) return `NumPad${code.slice(6)}`
  if (code === 'NumpadDecimal') return 'Decimal'
  if (code === 'NumpadMultiply') return 'Multiply'
  if (code === 'NumpadAdd') return 'Add'
  if (code === 'NumpadSubtract') return 'Subtract'
  if (code === 'NumpadDivide') return 'Divide'
  if (code === 'Escape') return 'Escape'
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return `D${code.slice(5)}`
  return null
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
  return command ? { kind: 'game', command } : null
}

export interface KeybindingHooks {
  /** Send a raw game command — the same path the command line uses. */
  sendGame: (command: string) => void
  /** Stop everything — both halves, same as the footer's own button. */
  stopAll: () => void
}

/** Installs the one global listener. Returns the cleanup. */
export function installKeybindings(hooks: KeybindingHooks): () => void {
  function onKeyDown(e: KeyboardEvent) {
    const action = resolveKeybinding(e, isTypingTarget(e.target))
    if (!action) return
    e.preventDefault()
    if (action.kind === 'stop') hooks.stopAll()
    else hooks.sendGame(action.command)
  }
  window.addEventListener('keydown', onKeyDown)
  return () => window.removeEventListener('keydown', onKeyDown)
}
