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
import { onPauseAll, onResumeAll, isAutomationPaused, requestPauseAll } from './flowStop.ts'
import { bridge } from '../bridge/index.ts'

let installed: (() => void) | null = null

/**
 * Adopt the bridge's latch into this app, on connect and on every status.
 *
 * The relay used to run one way only - the app decided and told the bridge -
 * and issue #487 is what that costs. The bridge's latch is a module ivar in a
 * process that outlives the app: press Pause, relaunch, and the bridge is
 * still refusing travel while this window's `flowStop` flag starts at its
 * default `false`. The chip read "Running" and the player got a bare refusal
 * sentence with nothing on screen to explain it.
 *
 * The bridge is the owner (see `pauseStatus.ts`), so the fix is not a second
 * flag to reconcile: it is that the app *reads its state from the owner*. The
 * `hello` frame deliberately does not carry the field - a full status follows
 * it on the same socket - so `status` is the one place this has to watch, and
 * watching every status rather than only the first also covers a pause another
 * window pressed.
 *
 * # Why this adopts a pause and never adopts a resume
 *
 * Deliberately asymmetric, and the asymmetry is the safety argument rather
 * than an oversight. Adopting a pause holds more than was held a moment ago,
 * which is never the dangerous direction. Adopting a *resume* would release
 * this app's whole command lane - every held command, at a live character -
 * because something in Lich unpaused a script, which is a decision the player
 * made about one script and not about this app's automation. So a latch that
 * drops leaves `flowStop` paused and the chip goes from "Paused, bridge
 * confirmed" to the warn-coloured "Paused, bridge did not confirm". The player
 * presses Resume. That transition is the visible signal #487 asks for, and it
 * is one the player can act on, which a silent auto-resume is not.
 */
function adoptBridgeLatch(latched: boolean) {
  if (!latched) return
  if (isAutomationPaused()) return
  // `requestPauseAll` and not a private flag: the whole point of this module
  // is that Pause has one sender and one path. Going through it flips the Rust
  // lane and fires the signal the footer and the flow driver subscribe to, and
  // the `pause` intent it sends straight back to the bridge is idempotent
  // there - the latch is already up, which is why we are here.
  requestPauseAll()
}

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

  // The other direction. See adoptBridgeLatch above for why this exists and
  // why it only ever adds a hold.
  const offMessage = bridge.onMessage((msg) => {
    if (msg.type !== 'status') return
    adoptBridgeLatch(msg.payload?.pauseLatched === true)
  })

  installed = () => {
    offPause()
    offResume()
    offMessage()
    installed = null
  }
  return installed
}
