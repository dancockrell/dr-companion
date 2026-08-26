/**
 * Stop, pause, resume, and what is running. The only place any of them live.
 *
 * There were three places. This bar, a Stop and a Pause in the Actions panel
 * under the dashboard, and a third Stop tucked into the right-hand end of the
 * combat banner. All of them sent the same two intents, so "where is stop" had
 * three answers and which one you reached for depended on what happened to be
 * on screen. The other two are gone rather than hidden.
 *
 * Stop is never gated on `character.connected`. That flag is set by the game
 * side, and a stale false disabled the button at exactly the moment someone was
 * hammering it. The store sends stop, pause, resume and escape whenever the
 * transport is up, and this bar adds no gate of its own.
 *
 * The readout to the right used to be one word, Active or Idle, decided by
 * testing the reported activity against a list of four values known to mean
 * idle. Anything the list had not heard of read as Active for the rest of the
 * session. It now carries what the bridge actually said: whether the bridge is
 * there at all, roundtime, the activity, and the running scripts by name.
 * Those are what you read before deciding whether to press Stop, and reading
 * them used to mean looking somewhere else.
 */
import { Square, Pause, Play } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { cn } from '../../lib/cn'

export function SafetyFooter() {
  const requestIntent = useAppStore((s) => s.requestIntent)
  const runningScripts = useAppStore((s) => s.runningScripts)
  const scriptStates = useAppStore((s) => s.scriptStates)
  const activeFlow = useAppStore((s) => s.activeFlow)
  const character = useAppStore((s) => s.character)
  const bridgeConnected = useAppStore((s) => s.bridgeConnected)

  // A script list the bridge sent is a fact. Matching activity strings against
  // a whitelist was a guess, and it guessed wrong in the direction that says
  // something is running when nothing is.
  /*
   * Paused is not busy.
   *
   * The bridge reports each script's status and the store keeps it, but this
   * counted scripts by name and a paused script has a name like any other. So
   * pausing everything left the bar reading Active, which is the one reading
   * you check before walking away from the keyboard.
   */
  const busy = scriptStates.some((x) => x.status !== 'paused') || activeFlow !== null
  const scripts = runningScripts.join(', ')
  const activity = character?.activity?.trim()
  // Rounded up, because the bridge sends it to a tenth and "RT 0s" while you
  // still cannot act is worse than saying one.
  const rt = Math.ceil(character?.roundtime ?? 0)

  return (
    <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-surface-raised/90 px-3 py-2">
      <button
        type="button"
        className="flex min-w-[7.5rem] flex-1 items-center justify-center gap-1.5 rounded-lg bg-danger/90 px-3 py-2 text-sm font-semibold text-white hover:bg-danger"
        title="Stop every script the Companion started"
        onClick={() => requestIntent('stop_all')}
      >
        <Square className="h-3.5 w-3.5 fill-current" />
        Stop all
      </button>
      <button
        type="button"
        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-ink-muted hover:bg-surface-overlay hover:text-ink"
        title="Hold automation where it is"
        onClick={() => requestIntent('pause')}
      >
        <Pause className="h-4 w-4" />
        Pause
      </button>
      <button
        type="button"
        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-ink-muted hover:bg-surface-overlay hover:text-ink"
        title="Carry on from where it paused"
        onClick={() => requestIntent('resume')}
      >
        <Play className="h-4 w-4" />
        Resume
      </button>

      {/* Its own basis so it drops to a second line in a narrow window rather
          than squeezing the three buttons it sits beside. */}
      <div className="flex min-w-0 flex-1 basis-40 items-center justify-end gap-2 text-xs">
        {/* First, because a bar full of controls that cannot reach Lich is the
            one state where pressing Stop achieves nothing at all. */}
        {!bridgeConnected && (
          <span
            className="shrink-0 rounded border border-danger/40 bg-danger/15 px-1.5 py-0.5 font-semibold text-danger"
            title="Nothing reaches Lich while the bridge is down. Stop scripts in Lich itself."
          >
            Bridge down
          </span>
        )}

        {rt > 0 && (
          <span
            className="shrink-0 tabular-nums text-warn"
            title="Roundtime left. Anything sent now waits behind it."
          >
            RT {rt}s
          </span>
        )}

        <span
          className={cn(
            'shrink-0 font-medium',
            busy ? 'animate-pulse-soft text-accent' : 'text-ink-faint'
          )}
        >
          {busy ? 'Active' : 'Idle'}
        </span>

        {/* The flow, in the accent, ahead of the game's own activity string.
         *
         * A running flow is this app's own doing and the more specific answer:
         * "Looting (2 of 4), pass 3" says what is happening and how far in,
         * where the game's activity says at most that something is. */}
        {activeFlow && (
          <span className="max-w-[14rem] shrink truncate text-accent" title={activeFlow}>
            {activeFlow}
          </span>
        )}

        {activity && (
          <span className="max-w-[11rem] shrink truncate text-ink-muted" title={activity}>
            {activity}
          </span>
        )}

        {/* Names, not a count. "2 scripts" says something is on; "combat-loop,
            uber-heal" says what Stop is about to kill. */}
        {busy && (
          <span className="min-w-0 truncate text-ink-faint" title={scripts}>
            {scripts}
          </span>
        )}
      </div>
    </footer>
  )
}
