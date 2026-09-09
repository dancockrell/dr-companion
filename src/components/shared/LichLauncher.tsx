/**
 * Start Lich from here, rather than telling somebody to go and do it.
 *
 * This panel exists because the honest state of the app for most of its life
 * was: everything works, once a person goes elsewhere, remembers four
 * arguments, and gets them right. That is not a working app, it is a working
 * app with a manual step in front of it, and the manual step is where everyone
 * stopped.
 *
 * # This panel does not sign anybody in
 *
 * Signing in is `SignIn.tsx`'s job, and it is the only route: account,
 * password, pick a character, done. This panel used to offer a second one - a
 * button per character Lich had saved - and that route was deleted from Rust
 * on 6 September 2026 when the third-party client that created those saved
 * entries was retired. `launch_lich(Some(name))` refused every press with a
 * sentence naming two Tauri commands, which is a developer's note in a
 * player's window, and the button above it offered to do the thing the note
 * said could not be done. Both are gone: a second start control beside the
 * real one is a fork (`CLAUDE.md` section 0), and the fork's other half no
 * longer exists.
 *
 * What is left here is the honest state of Lich itself - installed or not,
 * running or not, boots or not - and one line pointing at the sign-in form
 * above.
 *
 * # The password never goes on a command line
 *
 * Lich will accept an account and password as command-line arguments. This app
 * does not use them and will not. A password on a command line is readable by
 * every other process on the machine and ends up in crash dumps and logs. That
 * part has not changed and will not.
 *
 * What has changed is the sentence that used to stand here: that this app never
 * holds a password at all. Lich's own login window cannot complete a sign-in on
 * this machine, the third-party client that filled that gap was retired on
 * 6 September 2026, and Lane N of `docs/PLAN_TO_1_0.md` therefore makes this app
 * perform the eaccess handshake itself. The password is typed here, sent to
 * Simutronics and nowhere else, held in memory for one sign-in in
 * `src-tauri/src/credentials.rs`'s `Secret` - which overwrites its own bytes on
 * drop - and not stored unless the player later asks for it. `docs/PRIVACY.md`
 * and `docs/LICH_NATIVE_LOGIN.md` §5 are the authorities on that.
 *
 * # Three states, not two
 *
 * `runningKnown` is separate from `running` because "Lich is not running" and
 * "the process list could not be read" are different answers, and rendering
 * them the same tells somebody a thing nobody checked. `lich_status` carries
 * the `*Known` flag for exactly that.
 */
import { useEffect, useState } from 'react'
import { RefreshCw, ExternalLink } from 'lucide-react'
import { isTauri, invokeTauri } from '../../lib/tauri.ts'
import { notifyLichStarted } from '../../lib/lichStarted.ts'
import { bridgeCommand } from '../../lib/frontends.ts'

interface LichStatus {
  installDir: string | null
  launcher: string | null
  ruby: string | null
  dataDir: string | null
  running: boolean
  runningKnown: boolean
  /**
   * Whether Lich's own login window can actually complete here. False on a
   * machine whose only installed frontend is one Lich's GUI cannot offer: it
   * lists Wrayth, Wizard, Avalon and Saga only, and refuses with "No supported
   * frontend is available." otherwise. See `gui_login_usable` in lich.rs.
   */
  guiLoginUsable: boolean
  note: string
}

/**
 * Whether Lich can actually start, found out by starting it.
 *
 * Distinct from `LichStatus`, which only says whether the pieces are present.
 * On this machine every piece was present - Ruby, `lich.rbw`, every gem in
 * the Gemfile named as a requirement - and Lich still would not boot, for two
 * unrelated reasons: none of its gems were installed, and 24 of its own
 * source files were missing from the tree. A presence check is silent about
 * both; running `--version` and reading what it actually says is not.
 */
interface LichHealth {
  boots: boolean | null
  version: string | null
  problem: string | null
  diagnosis: string | null
  remedy: string | null
  note: string
}

export function LichLauncher() {
  const [status, setStatus] = useState<LichStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const [health, setHealth] = useState<LichHealth | null>(null)
  const [checkingHealth, setCheckingHealth] = useState(false)

  const refresh = async () => {
    if (!isTauri()) return
    try {
      setStatus((await invokeTauri('lich_status')) as LichStatus)
    } catch (e) {
      setFailed(String(e))
    }
  }

  /**
   * Actually try to start it, rather than inferring from the pieces being
   * present. Slower than reading `status` - it runs a real Ruby process - so
   * this is called deliberately (after a launch that did not take, or on
   * request) rather than on every mount.
   */
  const checkHealth = async () => {
    setCheckingHealth(true)
    try {
      setHealth((await invokeTauri('lich_health')) as LichHealth)
    } catch (e) {
      setHealth({
        boots: null,
        version: null,
        problem: null,
        diagnosis: null,
        remedy: null,
        note: `Not checked: ${String(e)}`,
      })
    } finally {
      setCheckingHealth(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  // Nothing to offer in a browser: there is no process to start from a web
  // page, and a button that cannot work is worse than no button.
  if (!isTauri()) return null
  if (!status) return null

  // Lich is not here. Setup is the screen that installs it, and repeating that
  // job badly in a corner of this panel would be the worse of two answers.
  if (!status.launcher || !status.ruby) {
    return (
      <p className="mt-3 text-xs text-ink-faint">
        {status.note} Connection help below walks through installing it.
      </p>
    )
  }

  const start = async () => {
    setBusy(true)
    setSaid(null)
    setFailed(null)
    setHealth(null)
    try {
      setSaid((await invokeTauri('launch_lich')) as string)
      // The other route to a running Lich, and it announces on the same
      // channel as sign-in so the bridge has one thing to listen to rather
      // than two (#532). No port: this command does not return one, and
      // inventing 11024 here is what `lichAttachOffer` exists to have stopped.
      notifyLichStarted({ port: null, via: 'launcher' })
    } catch (e) {
      setFailed(String(e))
    } finally {
      setBusy(false)
      // Re-read rather than assume. Spawning succeeded means a process was
      // created, which is not the same as Lich being up - it can exit a second
      // later on a bad argument and this panel would still be congratulating
      // itself.
      setTimeout(async () => {
        await refresh()
        // A process that spawned and then was not found running a moment
        // later did not fail loudly - it fell over during boot. That is
        // exactly the shape the character-name login window cannot explain,
        // because it never got that far. Worth the cost of actually starting
        // Lich a second time to find out why.
        const now = (await invokeTauri('lich_status')) as LichStatus
        if (!now.running) void checkHealth()
      }, 1200)
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-border bg-surface-raised p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wider text-ink-faint">Lich</h3>
        <button
          type="button"
          onClick={() => void refresh()}
          title="Check again" aria-label="Check again"
          className="rounded p-1 text-ink-faint hover:text-ink"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>

      <p className="mt-1 text-xs text-ink-muted">{status.note}</p>

      {status.running ? (
        <p className="mt-2 text-xs text-ink-faint">
          Nothing to do here. If the companion is still empty, run{' '}
          {/* `null` = no frontend in the path. This panel only renders when
            * Lich is up, and on this app's route that Lich is headless, so
            * the command character is `;`. See `prefixFor`. */}
          <code className="text-ink">{bridgeCommand(null)}</code> in the game.
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          {/* The one thing a player can do from this card, said as a thing to
            * do rather than as a status. The sign-in form is directly above
            * this panel in both places that render it (`Dashboard.tsx` and
            * `WaitingForCharacter.tsx`), so "above" is literal. */}
          <p className="text-xs text-ink-muted">
            Sign in above to start Lich for a character.
          </p>

          {/* Lich's own launcher window, offered only where it can actually
            * complete. It is not a sign-in route in this app - it opens Lich
            * and stops, which is what somebody wants when they need Lich's own
            * settings - so it says that and nothing more. `launch_lich` takes
            * no character and never did anything else here. */}
          {status.guiLoginUsable && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void start()}
              className="flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-xs text-ink-muted hover:text-ink disabled:opacity-50"
            >
              <ExternalLink className="h-3 w-3" />
              Open Lich's own window
            </button>
          )}

          {/* The sentence docs/PRIVACY.md states, word for word so the two
            * cannot drift; tools/doc-claims-test.mjs checks it against what is
            * actually persisted. It used to have a second variant for the days
            * when another program held the password. There is no other program
            * now, so there is one sentence. */}
          <p className="text-xs leading-snug text-ink-faint">
            Your password is typed into this app, used once to sign in to
            Simutronics, and kept in Windows Credential Manager unless you
            untick the box.
          </p>

          {/* Always offered, not only after a failed launch. A character
            * whose entry has quietly gone stale, or a Lich install with a
            * missing gem, will otherwise sit here forever looking identical
            * to "not attached yet". */}
          <button
            type="button"
            disabled={checkingHealth}
            onClick={() => void checkHealth()}
            className="text-xs text-ink-faint underline decoration-dotted hover:text-ink disabled:opacity-50"
          >
            {checkingHealth ? 'Starting Lich to check…' : "Why won't it start?"}
          </button>
        </div>
      )}

      {health && (
        <div
          className={`mt-2 rounded border p-2 text-xs leading-snug ${
            health.boots === true
              ? 'border-good/40 bg-good/10 text-good'
              : health.boots === false
                ? 'border-danger/40 bg-danger/10 text-danger'
                : 'border-border text-ink-faint'
          }`}
        >
          <p>{health.note}</p>
          {health.diagnosis && <p className="mt-1 text-ink-muted">{health.diagnosis}</p>}
          {health.remedy && <p className="mt-1 text-ink-muted">{health.remedy}</p>}
          {/* The raw line, always, when there is one - even once diagnosed.
            * A diagnosis can be wrong; the line Lich actually printed cannot
            * be, and it is what to paste into a bug report or a search. */}
          {health.problem && (
            <p className="mt-1 break-all font-mono text-xs text-ink-faint">{health.problem}</p>
          )}
        </div>
      )}

      {said && <p className="mt-2 text-xs text-good">{said}</p>}
      {failed && <p className="mt-2 text-xs text-danger">{failed}</p>}
    </div>
  )
}
