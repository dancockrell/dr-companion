/**
 * Start Lich from here, rather than telling somebody to go and do it.
 *
 * This panel exists because the honest state of the app for most of its life
 * was: everything works, once a person goes elsewhere, remembers four
 * arguments, and gets them right. That is not a working app, it is a working
 * app with a manual step in front of it, and the manual step is where everyone
 * stopped.
 *
 * # The password is not ours
 *
 * Lich will accept an account and password as command-line arguments. This app
 * does not use them and will not. A password on a command line is readable by
 * every other process on the machine and ends up in crash dumps and logs.
 *
 * So the first launch opens **Lich's own login window** and stops there. The
 * player types their details into the program that is supposed to have them,
 * Lich saves the entry itself, and from then on this app starts it by
 * character name with no secret involved anywhere.
 *
 * That is a deliberate ceiling on what this button does. It could be one click
 * instead of two, and it would have to hold a password to get there.
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
   * machine whose only frontend is Genie - Lich's GUI can only offer Wrayth,
   * Wizard, Avalon and Saga, and refuses with "No supported frontend is
   * available." otherwise. See `gui_login_usable` in lich.rs.
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
          <code className="text-ink">,companion_bridge</code> in the game.
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
                  title={`Start Lich for ${c}, connect DragonRealms for Genie, and start the bridge`}
                >
                  <Play className="h-3 w-3" />
                  {c}
                </button>
              ))}
            </div>
          )}

          {/* Offered only when Lich's own window can actually complete.
            *
            * Otherwise it is a dead end, and the app was walking people into
            * it: Lich's GUI login can only offer Wrayth, Wizard, Avalon and
            * Saga, so on a Genie-only machine every tab refuses with "No
            * supported frontend is available." A saved character makes the
            * question moot - that path never touches the GUI - which is why
            * this stays available once one exists. */}
          {status.guiLoginUsable ? (
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
          ) : (
            <div className="min-w-0 space-y-1 rounded border border-warn/40 bg-warn/5 p-2">
              <p className="text-xs font-medium text-warn">
                Lich&apos;s own login window cannot sign in on this machine.
              </p>
              <p className="text-xs leading-snug text-ink-muted">
                It only offers Wrayth, Wizard, Avalon and Saga, and none of those
                are installed here. Genie is not one it can offer, so every tab
                in that window refuses with &ldquo;No supported frontend is
                available.&rdquo;
              </p>
              {/* This used to print a `--account/--password/--save` command
                * to run in a terminal. It was wrong and it was worse than
                * useless, so the retraction is recorded here rather than
                * quietly deleted.
                *
                * Those flags parse, which is what made them look like a
                * supported path. They are not one. Lich dispatches on
                * `if ARGV.include?('--login')` with exactly one `elsif` for
                * the GUI (`main.rb:112`/`:195`); a command with credentials
                * and no `--login` matches neither. `argv_options[:save]` is
                * assigned at `argv_options.rb:103` and read nowhere in the
                * tree, and `[:account]` is read only under `--login NEW`,
                * the character generator.
                *
                * Run for real with junk credentials, it did not fail
                * cleanly: it fell into a proxy mode, printed "pretending to
                * be dr.simutronics.net", bound port 11024 - the exact port a
                * real Lich needs - and hung until killed, creating no entry
                * file. Anyone following that instruction would have ended up
                * in the state this panel exists to explain.
                *
                * The honest answer is that there is no CLI route to a saved
                * entry, so the way forward is a frontend that can actually
                * launch Lich. Genie is already installed and already
                * configured to do it. */}
              <p className="text-xs leading-snug text-ink-muted">
                There is no command-line way to save a character either - Lich
                only creates entries through that window. What does work is
                launching <span className="text-ink">Genie</span>, which starts
                Lich itself using the settings it already has:
              </p>
              {/* whitespace-pre-wrap/break-all used to be here, which is what
                * a Windows path deserves least: it wrapped `c:\ruby4lich5\...`
                * mid-token onto two lines rather than scrolling it, the exact
                * shape ConnectGuide.tsx's Line component already solved.
                * Scrolling is right for a line meant to be copied verbatim -
                * wrapping it invites someone to retype what they see, split
                * exactly where the browser happened to break it. */}
              <pre className="overflow-x-auto whitespace-pre rounded bg-surface p-1.5 text-xs leading-relaxed text-ink-faint">
{`#config {lichpath} {c:\\ruby4lich5\\lich5\\lich.rbw}
#config {licharguments} {--genie --dragonrealms}
#config {lichport} {11024}`}
              </pre>
              <p className="text-xs leading-snug text-ink-muted">
                Sign in through Genie as usual. It brings Lich up with those
                arguments, and the bridge connects on its own.
              </p>
              <p className="text-xs leading-snug text-ink-faint">
                One trade-off, so it is not a surprise later: that route uses{' '}
                <code>--genie</code>, which Lich does not give the streams
                capability, so the channel tabs stay empty. Everything else
                works.
              </p>
            </div>
          )}

          {!status.charactersKnown && (
            <p className="text-xs text-warn">
              Whether Lich has a saved character could not be read, so this is
              unknown rather than none. Opening Lich will show you.
            </p>
          )}

          {/* Two different true statements, and saying the wrong one is worse
            * than saying nothing: promising "Lich's own window" on a machine
            * where that window cannot sign in points at a door that is
            * bricked up. The constant across both is the part that actually
            * matters - this app never handles the password. */}
          <p className="text-xs leading-snug text-ink-faint">
            {status.guiLoginUsable
              ? "Your password is typed into Lich's own window and stays there. This app never sees it, and starting a saved character needs only the name."
              : 'This app never sees your password either way. It is typed into Genie, which is where it already lives, and never passes through here.'}
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
