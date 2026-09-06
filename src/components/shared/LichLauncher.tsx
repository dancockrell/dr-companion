/**
 * Start Lich from here, rather than telling somebody to go and do it.
 *
 * This panel exists because the honest state of the app for most of its life
 * was: everything works, once a person goes elsewhere, remembers four
 * arguments, and gets them right. That is not a working app, it is a working
 * app with a manual step in front of it, and the manual step is where everyone
 * stopped.
 *
 * # This panel is for a character Lich already knows
 *
 * Signing in is `SignIn.tsx`'s job now, and it is the route a new player takes:
 * account, password, pick a character, done. This panel starts a character out
 * of Lich's own saved entries, which is faster when one exists and needs no
 * password at all.
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
 * "No saved characters" and "we could not read the saved characters" are
 * different, and rendering them the same would send someone who has already
 * set Lich up back through first-time setup. The status carries
 * `charactersKnown` for exactly that, and this panel says "could not tell"
 * rather than guessing.
 */
import { useEffect, useState } from 'react'
import { Play, RefreshCw, ExternalLink } from 'lucide-react'
import { isTauri, invokeTauri } from '../../lib/tauri.ts'
import { bridgeCommand } from '../../lib/frontends.ts'

interface LichStatus {
  installDir: string | null
  launcher: string | null
  ruby: string | null
  dataDir: string | null
  characters: string[]
  charactersKnown: boolean
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

  const start = async (character?: string) => {
    setBusy(true)
    setSaid(null)
    setFailed(null)
    setHealth(null)
    try {
      setSaid((await invokeTauri('launch_lich', { character: character ?? null })) as string)
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
          {status.charactersKnown && status.characters.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {status.characters.map((c) => (
                <button
                  key={c}
                  type="button"
                  disabled={busy}
                  onClick={() => void start(c)}
                  className="flex items-center gap-1.5 rounded border border-accent/40 bg-accent/15 px-2.5 py-1.5 text-xs font-semibold text-accent hover:bg-accent/25 disabled:opacity-50"
                  title={`Start Lich for ${c} and start the bridge`}
                >
                  <Play className="h-3 w-3" />
                  {c}
                </button>
              ))}
            </div>
          )}

          {/* Offered only when Lich's own window can actually complete,
            * and it is now the secondary route rather than the only one.
            *
            * What used to be in the other arm of this branch: a warning
            * panel saying Lich's login window cannot sign in on this
            * machine, followed by three `#config` lines telling the player to
            * set up another program and sign in through that instead. Both are
            * gone. The app signs in itself now (`SignIn.tsx`), so there is
            * nothing to warn about and nowhere else to send anybody - and
            * an else-arm here would be a second sign-in route beside the
            * real one. */}
          {status.guiLoginUsable && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void start()}
              className="flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-xs text-ink-muted hover:text-ink disabled:opacity-50"
            >
              <ExternalLink className="h-3 w-3" />
              {status.charactersKnown && status.characters.length > 0
                ? 'Open Lich to add another character'
                : 'Open Lich to sign in'}
            </button>
          )}

          {!status.charactersKnown && (
            <p className="text-xs text-warn">
              Whether Lich has a saved character could not be read, so this is
              unknown rather than none. Opening Lich will show you.
            </p>
          )}

          {/* Both branches used to end on a promise that the app never
            * handles the password at all.
            * One of them still can, because when Lich's own window works the
            * password really does stay there. The other cannot: there is no
            * longer any other program in that path, so the app signs the
            * player in itself. The sentence below is the one docs/PRIVACY.md
            * states, kept word for word so the two cannot drift, and
            * tools/doc-claims-test.mjs checks it against what is persisted.
            * N5 replaces this panel with the sign-in screen and keeps it. */}
          <p className="text-xs leading-snug text-ink-faint">
            {status.guiLoginUsable
              ? "Your password is typed into Lich's own window and stays there. This app never sees it, and starting a saved character needs only the name."
              : 'Your password is typed into this app, used once to sign in to Simutronics, held only in memory, and not stored unless you later ask for it.'}
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
