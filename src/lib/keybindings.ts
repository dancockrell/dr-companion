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
 * "this key does this unless a foreground interaction owns it" — lives in
 * the pure half. The installer determines ownership from the live DOM.
 */

import { normalizeModifiers, type MacroRule } from './playerConfig.ts'
import { scriptRefusalFor, scriptRefusalWhy, type EnableRefusalOptions } from './aliases.ts'
import { validateGameActionCommand } from './gameCommand.ts'

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
  'Escape — stop all when no foreground panel is open',
  'Ctrl+Shift+Escape — emergency stop while a foreground panel is open',
]

export const SHORTCUT_SCOPE_SELECTOR = '[data-gameplay-shortcuts="suspend"]'

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

/** Controls and foreground surfaces own keystrokes before live-game bindings. */
export function isInteractionTarget(target: EventTarget | null): boolean {
  if (isTypingTarget(target)) return true
  if (target == null || typeof target !== 'object') return false
  const t = target as { closest?: (selector: string) => unknown }
  return typeof t.closest === 'function' && !!t.closest(
    `${SHORTCUT_SCOPE_SELECTOR},button,select,[role="dialog"],[role="menu"],[role="listbox"]`
  )
}

export type KeyResolution =
  | { kind: 'game'; command: string }
  | { kind: 'macro'; id: string; commands: string[] }
  | { kind: 'stop' }
  | { kind: 'quickswitch'; slot: number }
  | null

/**
 * The chord a keydown names, in Genie's own vocabulary, or null for a key no
 * macro could be bound to.
 *
 * One translation, shared by the resolver below and by the Macros tab's "press
 * a key" capture, so the editor cannot store a chord under a name the resolver
 * will never produce. That is not hypothetical tidiness: two spellings of one
 * physical key is a binding that saves, displays correctly and never fires.
 */
export function chordOf(e: {
  code: string
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}): { key: string; modifiers: Array<'Shift' | 'Control' | 'Alt'> } | null {
  const key = codeToGenieKey(e.code)
  if (key === null) return null
  const mods: string[] = []
  if (e.shiftKey === true) mods.push('Shift')
  if (e.ctrlKey === true) mods.push('Control')
  if (e.altKey === true) mods.push('Alt')
  return { key, modifiers: normalizeModifiers(mods) }
}

/** One chord as one string, for display and for comparing two bindings. */
export function chordLabel(
  key: string,
  modifiers: readonly string[] = []
): string {
  return [...normalizeModifiers(modifiers), key].join('+')
}

/**
 * What this app does with the chord when the player has bound nothing to it.
 *
 * Exported so the Macros tab can say "NumPad8 already walks north" beside a
 * new binding instead of letting a player discover the collision by pressing
 * it. The player's binding still wins - see `resolveKeybinding` - and this is
 * what they are choosing to override, named.
 *
 * Only the unmodified chord can collide: every built-in is a bare key.
 */
export function builtinForChord(
  key: string,
  modifiers: readonly string[] = []
): string | null {
  if (normalizeModifiers(modifiers).length > 0) return null
  for (const [code, command] of Object.entries(GAME_KEYS)) {
    if (codeToGenieKey(code) === key) return command
  }
  for (const [code, slot] of Object.entries(QUICK_SWITCH_KEYS)) {
    if (codeToGenieKey(code) === key) return `Quick Switch slot ${slot + 1}`
  }
  return null
}

/**
 * Why this macro may not be switched on, or null when it may.
 *
 * The same answer as `aliasEnableRefusal`, asked of the other domain and
 * against the same predicate. 25 of the 95 macros in the real config measured
 * for Q1 carry Genie script and import switched off.
 *
 * Judged against the **expanded** commands since #485. `macroEnableRefusal({
 * key: 'F6', commands: ['go $s'] })` returned null, `$s = "#queue clear"` was
 * substituted afterwards by `expandAlias` at fire time, and `go #queue clear`
 * reached DragonRealms as literal text - the exact outcome
 * `aliasEnableRefusal`'s own comment says the guard exists to prevent. A guard
 * on the stored text is a guard on something other than what gets sent.
 *
 * This is the enable-time half only. `runMacroCommands` asks the same question
 * again at fire time, because a variable can be edited after the macro was
 * switched on and nothing re-runs this when it is.
 */
export function macroEnableRefusal(
  rule: Pick<MacroRule, 'key' | 'commands'>,
  opts: EnableRefusalOptions = {}
): string | null {
  for (const command of rule.commands) {
    const { expanded, why } = scriptRefusalFor(command, opts)
    if (!why) continue
    const named = expanded === command ? command : `${command}, which sends ${expanded}`
    return (
      `${rule.key} contains Genie script (${named}: ${why}). This app has no script ` +
      'engine, so it cannot be switched on.'
    )
  }
  return null
}

/**
 * Why one fully expanded command may not go out, or null when it may.
 *
 * Everything standing between a planned command and the game, in one
 * predicate, asked at both call sites in `runMacroCommands`: the dry run, so
 * the plan shown is the plan the lane would accept, and the real fire, so a
 * variable edited after the macro was switched on cannot smuggle script past
 * the enable guard. Two implementations of "would this be refused" would put
 * the dry run back to showing a second opinion of what the real fire does,
 * which is the thing `runMacroCommands` exists as one function to avoid.
 *
 * `validateGameActionCommand` is the outbound lane's own gate - the same
 * function `requestGameAction` calls - rather than a copy of its rules, so
 * this cannot fall behind it. It throws, and the throw is the reason in words
 * a player can read.
 */
export function plannedCommandRefusal(
  planned: string,
  opts: EnableRefusalOptions & {
    /**
     * The command as stored, before expansion. Given, a variable whose value
     * is a directive is named as the reason - which is the difference between
     * "this cannot be sent" and "edit `$s`".
     */
    source?: string
  } = {}
): string | null {
  const why = scriptRefusalWhy(opts.source ?? planned, planned, opts.variables)
  if (why) {
    return (
      `“${planned}” is Genie script (${why}). ` +
      'This app has no script engine, so it cannot be sent.'
    )
  }
  try {
    validateGameActionCommand(planned)
    return null
  } catch (e) {
    return `“${planned}” would be refused: ${e instanceof Error ? e.message : String(e)}`
  }
}

/**
 * The player's binding for this chord, or null.
 *
 * A disabled rule, and one carrying script, are both skipped here rather than
 * filtered by the caller: the resolver is what actually decides, so a rule that
 * must not run must be unreachable from this function rather than from a list
 * somebody remembered to clean.
 *
 * The script check here is against the stored text: a keydown resolver has no
 * variable table and giving it one would make this pure function depend on the
 * store. The expanded text is judged where it exists, by
 * `plannedCommandRefusal` inside `runMacroCommands`, which is the last thing
 * between a command and the lane and runs on every fire. Both are needed:
 * this one keeps a scripted rule from resolving at all, and that one catches
 * a variable edited after the rule was switched on.
 */
function macroForEvent(
  e: { code: string; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean },
  macros: readonly MacroRule[]
): MacroRule | null {
  const chord = chordOf(e)
  if (!chord) return null
  const want = chordLabel(chord.key, chord.modifiers)
  for (const macro of macros) {
    if (!macro.enabled) continue
    if (macroEnableRefusal(macro)) continue
    if (chordLabel(macro.key, macro.modifiers) === want) return macro
  }
  return null
}

/**
 * Pure decision: what should this keydown do, if anything.
 *
 * A blocked foreground scope owns every ordinary key, including bare Escape.
 * Ctrl+Shift+Escape is deliberately distinct and remains available as the
 * emergency stop without turning "close this panel" into a gameplay action.
 */
export function resolveKeybinding(
  e: { key: string; code: string; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean },
  blocked: boolean,
  macros: readonly MacroRule[] = []
): KeyResolution {
  if (blocked) {
    return e.key === 'Escape' && e.ctrlKey === true && e.shiftKey === true
      ? { kind: 'stop' }
      : null
  }
  if (e.key === 'Escape') return { kind: 'stop' }
  // The player's own binding beats the shipped default on the same chord, and
  // the default stays for every chord they have not bound. Otherwise a player
  // who binds NumPad8 gets `n` and no error, which is the failure this lane
  // exists to remove. Escape is deliberately above this: an emergency stop a
  // config can take away is not one.
  const macro = macroForEvent(e, macros)
  if (macro) return { kind: 'macro', id: macro.id, commands: [...macro.commands] }
  const command = GAME_KEYS[e.code]
  if (command) return { kind: 'game', command }
  const slot = QUICK_SWITCH_KEYS[e.code]
  return slot !== undefined ? { kind: 'quickswitch', slot } : null
}

export interface MacroRunOptions {
  /**
   * Sends one command. Production passes
   * `requestGameAction(command, label, 'macro')` — the outbound lane, whose
   * `macro` source and pacing already exist. A second send path with its own
   * gate would be a fork of the thing that makes Stop work.
   */
  send: (command: string) => void
  /**
   * Claims the shared in-flight slot, returning why not or null when it may
   * run. Production passes `claimMacroSend` from `macroFlight.ts` — the gate
   * the action bars already use, so a double press cannot queue a second macro
   * behind the first whichever surface fired it.
   */
  claim?: () => string | null
  /**
   * Show, do not send. Nothing is claimed and nothing goes out; the plan comes
   * back so the editor can display exactly what the lane would receive, in
   * order. The dry run is the only way to check a macro against a character
   * standing in a bank, and a dry run that sent anything would be worse than
   * having none.
   */
  dryRun?: boolean
  /**
   * Expand one command before it is planned. Production passes
   * `expandAlias(c, aliases, { variables })`, so a macro and a typed line go
   * through the *same* resolver: a macro that wrote `$shop` and a command line
   * that wrote `$shop` producing different text would be two alias engines,
   * and the dry run below would be showing the player the wrong one's answer.
   */
  expand?: (command: string) => string
  /**
   * The variable table `expand` will substitute from.
   *
   * Handed over as well as being closed into `expand`, because the refusal
   * has a question `expand`'s output alone cannot answer: `go $s` and a
   * literal `go #queue clear` produce the same text, and only one of them is
   * a directive somebody's variable smuggled in. Optional: without it the
   * refusal still catches everything `isGenieScript` calls script in the
   * planned text, and the lane's own validation still runs.
   */
  variables?: ReadonlyMap<string, string>
}

export interface MacroRunResult {
  /** What would be sent, in order. Always populated, dry run or not. */
  plan: string[]
  /**
   * Why each planned command would be refused, or null, index for index with
   * `plan` - `plannedCommandRefusal` asked of every entry.
   *
   * Parallel to `plan` rather than folded into it so the editor can show the
   * reason beside the command it belongs to. Populated on a dry run too:
   * before #485 the dry run's whole failure was that it showed a plan the
   * lane would throw away, and the dry run is the only way to check a macro
   * against a character standing in a bank.
   */
  planRefusals: Array<string | null>
  /** What actually went out. Empty on a dry run and on a refusal. */
  sent: string[]
  /** Why nothing was sent, in words for the player, or null. */
  refused: string | null
  dryRun: boolean
}

/**
 * Run one macro's commands, or say what running it would do.
 *
 * One function for both, on purpose: a dry run that walked a different code
 * path from the real fire would be showing the player a second implementation's
 * opinion of what the first would do.
 *
 * That was true of the code path and not of the answer until #485, because the
 * real fire had one step this did not - `requestGameAction` →
 * `validateGameActionCommand`, which refuses `;` and control characters. So a
 * plan expanded from `$shop = "bank;withdraw 5000 coins"` was shown to the
 * player and thrown away by the lane. `plannedCommandRefusal` is that step,
 * asked here, of the expanded text, for both.
 *
 * It runs on the real fire as well, and that is the other half of #485: a
 * macro switched on when `$s` was harmless fires after `$s` is edited to
 * `#queue clear`, and nothing re-runs `macroEnableRefusal` in between. One
 * predicate, two call sites - the enable guard and this - so a variable
 * changed after enabling cannot smuggle script through.
 */
export function runMacroCommands(
  commands: readonly string[],
  opts: MacroRunOptions
): MacroRunResult {
  // Kept in pairs, so a refusal can name the variable in the command as the
  // player wrote it rather than only the text it turned into.
  const planned = commands
    .map((source) => ({ source, text: (opts.expand ? opts.expand(source) : source).trim() }))
    .filter((p) => p.text.length > 0)
  const plan = planned.map((p) => p.text)
  const planRefusals = planned.map((p) =>
    plannedCommandRefusal(p.text, { source: p.source, variables: opts.variables })
  )
  if (opts.dryRun === true) return { plan, planRefusals, sent: [], refused: null, dryRun: true }
  // Before the claim, not after: a macro that cannot go out must not take the
  // shared in-flight slot away from one that can. Nothing partial goes either
  // - one refused command refuses the macro, because half a movement sequence
  // arriving at a live character is worse than none of it.
  const blocked = planRefusals.findIndex((why) => why !== null)
  if (blocked >= 0) {
    return { plan, planRefusals, sent: [], refused: planRefusals[blocked], dryRun: false }
  }
  const refused = opts.claim ? opts.claim() : null
  if (refused) return { plan, planRefusals, sent: [], refused, dryRun: false }
  const sent: string[] = []
  for (const command of plan) {
    opts.send(command)
    sent.push(command)
  }
  return { plan, planRefusals, sent, refused: null, dryRun: false }
}

export interface KeybindingHooks {
  /** Send a raw game command — the same path the command line uses. */
  sendGame: (command: string) => void
  /** Stop everything — both halves, same as the footer's own button. */
  stopAll: () => void
  /** Switch to (or, if already running, stop) the Nth pinned Quick Switch slot. */
  quickSwitch: (slot: number) => void
  /**
   * Fire a player macro. Required rather than optional: a build that forgot to
   * wire it would resolve the chord, swallow the key and send nothing, which
   * looks exactly like a binding that does not work.
   */
  runMacro: (macro: { id: string; commands: string[] }) => void
  /**
   * The player's bindings, read at keydown rather than captured at install.
   * The store is cached, so this is a map lookup, and reading it live means a
   * macro saved in the panel works on the next press instead of after a
   * reload.
   */
  macros?: () => readonly MacroRule[]
}

/** Installs the one global listener. Returns the cleanup. */
export function installKeybindings(hooks: KeybindingHooks): () => void {
  function onKeyDown(e: KeyboardEvent) {
    const foregroundOpen = !!document.querySelector(SHORTCUT_SCOPE_SELECTOR)
    const controlOwnsKey = e.key !== 'Escape' && isInteractionTarget(e.target)
    const action = resolveKeybinding(e, foregroundOpen || controlOwnsKey, hooks.macros?.() ?? [])
    if (!action) return
    e.preventDefault()
    if (action.kind === 'stop') hooks.stopAll()
    else if (action.kind === 'quickswitch') hooks.quickSwitch(action.slot)
    else if (action.kind === 'macro') hooks.runMacro({ id: action.id, commands: action.commands })
    else hooks.sendGame(action.command)
  }
  window.addEventListener('keydown', onKeyDown)
  return () => window.removeEventListener('keydown', onKeyDown)
}
