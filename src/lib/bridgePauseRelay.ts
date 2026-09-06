/**
 * One sender for the bridge half of Pause.
 *
 * Pause is two acts: flip the Rust lane (`flowStop.requestPauseAll`) and tell
 * the bridge, which owns the half of automation the lane cannot see - `go2`
 * running inside Lich, started by a `map_walk` intent that never enters
 * `command_gate` (issue #462).
 *
 * Both call sites used to do both by hand: `SafetyFooter` and `CommandPalette`
 * each called `requestIntent('pause')` and then `requestPauseAll()`. That is
 * two owners of one act, and a third caller - a keybinding, a panel, an
 * automation that pauses on low health - would have had to remember the pair.
 * A Pause that reaches the lane and not the bridge is exactly the bug #462
 * describes, arriving by omission instead of by design.
 *
 * So the dependency runs the way `tools/kill-switch-test.mjs` already argues
 * for with Stop: `flowStop.ts` publishes a signal and stays free of optional
 * imports, and this file subscribes and sends. Callers call `requestPauseAll`
 * alone; the bridge intent follows from the signal.
 *
 * Installed once per window from `main.tsx`, for the reason
 * `subscribePresentationIntents` gives: every window shares the Tauri event bus
 * but not this module instance, and a duplicate send here is harmless anyway
 * (`pause` is idempotent on both sides), while a missing one is not.
 */
import { onPauseAll, onResumeAll } from './flowStop.ts'
import { bridge } from '../bridge/index.ts'

let installed: (() => void) | null = null

/**
 * Subscribe the bridge to this window's Pause and Resume. Returns the
 * unsubscribe function; calling it twice does not subscribe twice.
 */
export function installBridgePauseRelay(): () => void {
  if (installed) return installed

  const offPause = onPauseAll(() => {
    bridge.requestIntent('pause')
  })
  const offResume = onResumeAll(() => {
    bridge.requestIntent('resume')
  })

  installed = () => {
    offPause()
    offResume()
    installed = null
  }
  return installed
}
