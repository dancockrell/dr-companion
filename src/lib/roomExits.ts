/**
 * The room's exits as a list of controls: one word, one command, in order.
 *
 * Dan, 6 September 2026: "remove the route markers. you travel by clicking on
 * another tile or by clicking on the words in the interface or by hotkey."
 * This is the words half. `ExitButtons` renders exactly what this returns, so
 * "every exit the game reported is offered, and each one sends what it says"
 * is a property that can be asserted without a DOM.
 *
 * # Why the command is the word itself
 *
 * A DragonRealms direction is already a complete command: typing `north`,
 * `out`, `up` or `go gate` is the move. So there is nothing to translate, and
 * inventing a translation here would be a second movement vocabulary next to
 * `keybindings.ts`'s numpad table and the viewer's own exit strings. The
 * command is the label, and the type says so rather than leaving a caller to
 * assume it.
 *
 * The two things it does do are the two that would otherwise be done
 * differently in each caller: a blank entry (the compass tag can produce one)
 * is not a control, and a repeated direction is not two controls. Godot's
 * `world_controls.gd::render_exits` drops the same two cases for the same
 * reason; this is that rule on this side of the app.
 */

export interface ExitControl {
  /** The word to show. */
  readonly label: string
  /** What clicking it sends - the same string, and the type is the promise. */
  readonly command: string
}

export function exitControls(exits: readonly string[] | undefined | null): ExitControl[] {
  if (!exits) return []
  const seen = new Set<string>()
  const controls: ExitControl[] = []
  for (const raw of exits) {
    if (typeof raw !== 'string') continue
    const move = raw.trim()
    if (!move || seen.has(move)) continue
    seen.add(move)
    controls.push({ label: move, command: move })
  }
  return controls
}
