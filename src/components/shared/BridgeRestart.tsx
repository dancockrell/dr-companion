/**
 * One press that stops the bridge script and starts it again (issue #539).
 *
 * # Why this had to exist
 *
 * Reinstalling the bridge replaces a file on disk. Lich goes on running the
 * copy it read when it started, so after a successful reinstall Dan's live
 * session held a current file and a stale bridge at the same time:
 *
 *     versions.actualBridge   0.11.0     <- still the old script, in memory
 *     installed file          0.14.0     <- current
 *
 * and the warning that sent him there said "then start the bridge again" with
 * no route in the app to do it. `;companion_bridge stop` typed into the game
 * bar did nothing (the script has no such argument), **Stop all** is far too
 * broad to offer for a version mismatch, and "Run companion_bridge" cannot
 * restart a script that is already running.
 *
 * # Why it needs nothing from the script
 *
 * `;kill <script>` is Lich's own command, not the bridge's — see
 * `bridgeRestartCommands` in lib/frontends.ts for where that syntax is read
 * off the installed Lich rather than guessed. So this works against a bridge
 * of any version, including the wedged one it exists to repair, and it needed
 * no edit to `lich-scripts/companion_bridge.lic`.
 *
 * # Why it goes out on the game socket
 *
 * The first command is the one that takes the bridge's WebSocket down. A
 * restart sent *through* the bridge would be a request that kills its own
 * transport halfway, and the second half would have nowhere to go. `sendGame`
 * writes to Lich's game socket, which is a different connection and stays up
 * throughout.
 */
import { useState } from 'react'
import { sendGame } from '../../lib/gameLink.ts'
import { bridgeRestartCommands } from '../../lib/frontends.ts'
import { RESTART_CONTROL } from '../../lib/versions.ts'
import { useAppStore } from '../../store/useAppStore.ts'

/**
 * `null` = no frontend in the path, which is this app's own route: it starts
 * Lich headless and the command character is `;`. Same argument every panel
 * describing *this app's* Lich passes — see `prefixFor`.
 */
const OUR_LICH = null

export function BridgeRestart() {
  const addLog = useAppStore((s) => s.addLog)
  const [busy, setBusy] = useState(false)
  const [kill, start] = bridgeRestartCommands(OUR_LICH)

  const restart = async () => {
    setBusy(true)
    try {
      // Sent, then reported by name. A player who has just been told their
      // bridge is stale needs to be able to see what was actually run, not a
      // reassurance that something was.
      await sendGame(kill, 'ui-action')
      addLog(`Sent ${kill} to Lich.`)
      await sendGame(start, 'ui-action')
      addLog(
        `Sent ${start} to Lich. The bridge reconnects on its own; its version is in About.`
      )
    } catch (e) {
      // Named, not swallowed. The commonest reason this fails is that there is
      // no game socket at all, and "nothing happened" is the one answer that
      // sends somebody looking at the bridge instead of at the connection.
      addLog(
        `Could not restart the bridge: ${e instanceof Error ? e.message : String(e)}. ` +
          `This needs a game connection — attach in the game pane first.`,
        'warn'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={busy}
        className="w-full rounded-lg border border-border px-3 py-2 text-ink-muted hover:text-ink disabled:opacity-50"
        onClick={() => void restart()}
      >
        {RESTART_CONTROL}
      </button>
      <p className="text-xs text-ink-faint leading-snug">
        Runs <code className="text-ink">{kill}</code> and then{' '}
        <code className="text-ink">{start}</code>. Reinstalling replaces the
        file; Lich keeps running the copy it already read, so after an update
        this is the step that makes the new one take effect.
      </p>
    </>
  )
}
