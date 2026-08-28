/**
 * Turning a pin into a real, editable Python task.
 *
 * "Flows on those" (Dan's ask) now means a literal file in
 * `python/tasks/user/`, not a hidden abstraction - flows are Python, meant
 * to be user-editable, and a generator that produced something other than
 * the same short, readable file a player would write by hand (see
 * python/tasks/user/README.md) would be the wiring-format mistake that file
 * itself explains why this app doesn't have.
 *
 * The whole task is `walk_to()` (drtask.py) plus `stop()` - see
 * python/tasks/user/README.md's own contract: `main()` returning something
 * with `.run()`. Nothing here needs Flow/Step; a single action isn't a
 * sequence.
 */
import type { MapPin } from './mapPins'

/** `python/tasks/user/<slug>.py` and the task id it becomes (see scriptFiles.ts's taskIdFor). */
export function taskNameForPin(pin: MapPin): string {
  const slug =
    pin.label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'pin'
  return `walk_to_${slug}`
}

/**
 * A name guaranteed not to collide with an existing script.
 *
 * `write_script` (src-tauri/src/scripts.rs) overwrites whatever is already
 * at a path with no existence check of its own - confirmed by reading it,
 * not assumed, after an earlier draft of this generator's docstring claimed
 * the opposite. So the caller has to be the one that refuses to clobber a
 * file the player may have since edited by hand: pass the current Python
 * task names (scriptFiles.ts's listScripts) and this appends `_2`, `_3`, ...
 * until it finds one that doesn't exist, rather than silently overwriting
 * `walk_to_bank.py` a second time.
 */
export function uniqueTaskName(existingNames: string[], pin: MapPin): string {
  const base = taskNameForPin(pin)
  if (!existingNames.includes(base)) return base
  for (let i = 2; ; i++) {
    const candidate = `${base}_${i}`
    if (!existingNames.includes(candidate)) return candidate
  }
}

/** A PascalCase Python class name from the pin's label, always a valid identifier. */
function className(pin: MapPin): string {
  const words = pin.label.split(/[^a-zA-Z0-9]+/).filter(Boolean)
  const pascal = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('') || 'Pin'
  // A label starting with a digit ("221B Baker") would otherwise produce an
  // illegal identifier like `221B` as a class name suffix.
  return /^[0-9]/.test(pascal) ? `Room${pascal}` : pascal
}

export function pinTaskSource(pin: MapPin): string {
  const cls = `WalkTo${className(pin)}`
  return `"""Walk to ${pin.label} (room ${pin.roomId}).

Generated from a map pin. This is your file now - edit it freely.
Regenerating this pin's task later creates a new, separately-numbered file
rather than overwriting this one, so an edit you make here is never
silently lost.
"""

from drtask import Task


class ${cls}(Task):
    def on_start(self) -> None:
        self.walk_to(${pin.roomId})
        self.stop()


def main():
    return ${cls}()
`
}
