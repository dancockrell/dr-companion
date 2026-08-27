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
import { isTauri, invokeTauri } from '../../lib/tauri'

interface LichStatus {
  installDir: string | null
  launcher: string | null
  ruby: string | null
  dataDir: string | null
  characters: string[]
  charactersKnown: boolean
  running: boolean
  runningKnown: boolean
  note: string
}

export function LichLauncher() {
  const [status, setStatus] = useState<LichStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const refresh = async () => {
    if (!isTauri()) return
    try {
      setStatus((await invokeTauri('lich_status')) as LichStatus)
    } catch (e) {
      setFailed(String(e))
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
      setTimeout(() => void refresh(), 1200)
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-border bg-surface-raised p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wider text-ink-faint">Lich</h3>
        <button
          type="button"
          onClick={() => void refresh()}
          title="Check again"
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

          {/* Always available, not only on first run.
            *
            * It is how you add a second character, and it is the way out when
            * the saved entry is stale or the character list could not be read.
            * Hiding it once one character exists would make those states
            * dead ends. */}
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

          {!status.charactersKnown && (
            <p className="text-xs text-warn">
              Whether Lich has a saved character could not be read, so this is
              unknown rather than none. Opening Lich will show you.
            </p>
          )}

          <p className="text-xs leading-snug text-ink-faint">
            Your password is typed into Lich's own window and stays there. This
            app never sees it, and starting a saved character needs only the
            name.
          </p>
        </div>
      )}

      {said && <p className="mt-2 text-xs text-good">{said}</p>}
      {failed && <p className="mt-2 text-xs text-danger">{failed}</p>}
    </div>
  )
}
