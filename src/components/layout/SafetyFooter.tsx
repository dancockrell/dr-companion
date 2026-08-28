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
 * hammering it. The store sends stop, pause and resume whenever the transport
 * is up, and this bar adds no gate of its own.
 *
 * `escape` is declared alongside these three as a SAFETY_INTENT in the store
 * (never gated, same as stop/pause/resume), but nothing in this bar - or
 * anywhere else in src/ - actually sends it. This comment used to claim it
 * did; that was false, not aspirational. See issue tracking the intent's own
 * unreachability before adding an Escape control here.
 *
 * The readout to the right used to be one word, Active or Idle, decided by
 * testing the reported activity against a list of four values known to mean
 * idle. Anything the list had not heard of read as Active for the rest of the
 * session. It now carries what the bridge actually said: whether the bridge is
 * there at all, roundtime, the activity, and the running scripts by name.
 * Those are what you read before deciding whether to press Stop, and reading
 * them used to mean looking somewhere else.
 */
import { Square, Pause, Play, Heart, Navigation } from 'lucide-react'
import { useAppStore, isIntentImplemented } from '../../store/useAppStore'
import { requestStopAll, requestPauseAll, requestResumeAll } from '../../lib/flowStop'
import { SoundControls } from '../game/SoundControls'
import { cn } from '../../lib/cn'

export function SafetyFooter() {
  const requestIntent = useAppStore((s) => s.requestIntent)
  const runningScripts = useAppStore((s) => s.runningScripts)
  const scriptStates = useAppStore((s) => s.scriptStates)
  const activeFlow = useAppStore((s) => s.activeFlow)
  const character = useAppStore((s) => s.character)
  const bridgeConnected = useAppStore((s) => s.bridgeConnected)
  const bridgeAuth = useAppStore((s) => s.bridgeAuth)
  const bridgeAuthNote = useAppStore((s) => s.bridgeAuthNote)
  const bridgeIntents = useAppStore((s) => s.bridgeIntents)

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

  /**
   * Start lives here too, because Start and Stop are one decision.
   *
   * The primary action was in the Actions panel inside the dashboard while
   * Stop was down here in the window frame, so beginning a thing and ending it
   * sat in different containers, at different weights, with unrelated controls
   * between them. Nobody looks in two places for the on and the off of one
   * switch.
   *
   * The panel is also inside a scrolling column, so the button that starts
   * everything could be scrolled off screen while the button that stops it
   * never could. This bar is part of the window, which is the promise the app
   * was built on and the reason Stop is here at all.
   */
  const lowHealth =
    character != null && character.vitals.health / character.vitals.healthMax < 0.35
  const inCombat = character?.situation.includes('in_combat') ?? false
  const primaryLabel = lowHealth ? 'Healer' : inCombat ? 'Assist' : 'Start Training'
  const primaryIntent = lowHealth ? 'go_healer' : 'start_training'
  // See isIntentImplemented: null bridgeIntents (unknown bridge) never
  // disables anything, so this button stays live against every bridge that
  // predates the field.
  const primaryAvailable = isIntentImplemented(bridgeIntents, primaryIntent)
  const townRunAvailable = isIntentImplemented(bridgeIntents, 'town_run')
  const NOT_IMPLEMENTED_NOTE = 'Not yet implemented in the connected bridge.'

  return (
    <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-surface-raised/90 px-3 py-2">
      {character && (
        <button
          type="button"
          disabled={!primaryAvailable}
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40',
            lowHealth
              ? 'bg-danger/90 text-white hover:bg-danger'
              : 'bg-accent text-surface hover:bg-accent-soft'
          )}
          title={
            !primaryAvailable
              ? NOT_IMPLEMENTED_NOTE
              : lowHealth
                ? 'Health is low. Walk to a healer.'
                : inCombat
                  ? 'Help with the fight in progress'
                  : 'Begin the training loop'
          }
          onClick={() => requestIntent(primaryIntent)}
        >
          {lowHealth ? (
            <Heart className="h-4 w-4" />
          ) : (
            <Play className="h-3.5 w-3.5 fill-current" />
          )}
          {primaryLabel}
        </button>
      )}

      {character && (
        <button
          type="button"
          disabled={!townRunAvailable}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-ink-muted hover:bg-surface-overlay hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          title={townRunAvailable ? 'Bank, repair, restock' : NOT_IMPLEMENTED_NOTE}
          onClick={() => requestIntent('town_run')}
        >
          <Navigation className="h-4 w-4" />
          Town Run
        </button>
      )}

      <button
        type="button"
        className="flex min-w-[7.5rem] flex-1 items-center justify-center gap-1.5 rounded-lg bg-danger/90 px-3 py-2 text-sm font-semibold text-white hover:bg-danger"
        title="Stop every script the Companion started (or press Escape, anywhere)"
        onClick={() => {
          requestIntent('stop_all')
          // The bridge half stops scripts; this half stops a client-side
          // Task Flow, which has its own timer the bridge cannot see or
          // cancel. Without it, Stop all aborted the in-flight step while
          // the flow's own schedule kept firing the next one.
          requestStopAll()
        }}
      >
        <Square className="h-3.5 w-3.5 fill-current" />
        Stop all
      </button>
      <button
        type="button"
        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-ink-muted hover:bg-surface-overlay hover:text-ink"
        title="Hold automation where it is"
        onClick={() => {
          requestIntent('pause')
          // Same gap as Stop all had: the bridge pauses its own scripts, but
          // a client-side Task Flow's timer never heard "pause" at all.
          requestPauseAll()
        }}
      >
        <Pause className="h-4 w-4" />
        Pause
      </button>
      <button
        type="button"
        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-ink-muted hover:bg-surface-overlay hover:text-ink"
        title="Carry on from where it paused"
        onClick={() => {
          requestIntent('resume')
          requestResumeAll()
        }}
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

        {/* The bridge's own account of which gates it has up.
          *
          * Shown only when it is not both, because a badge that is always
          * there is furniture and gets skimmed on the day it changes.
          *
          * This is the third place this signal has lived. It started in
          * Lich's log, which the app never reads. Then it moved to a field on
          * the hello frame, which the app also never read - the type did not
          * mention it, the store did not lift it out, and a grep for it across
          * the whole TypeScript tree returned nothing. The signal had moved
          * from one place nobody looks to another.
          *
          * A field nobody reads is not an improvement on a log nobody reads.
          * It is the same absence with more steps. */}
        {bridgeConnected && bridgeAuth !== 'token' && (
          <span
            className="shrink-0 rounded border border-warn/40 bg-warn/15 px-1.5 py-0.5 font-semibold text-warn"
            title={
              bridgeAuth === 'origin-only'
                ? `The bridge is running without a connection token${
                    bridgeAuthNote ? ` (${bridgeAuthNote})` : ''
                  }. Web pages are still blocked. Other programs on this machine are not.`
                : 'This bridge is too old to say whether it requires a token. Update it from Setup to be sure.'
            }
          >
            {bridgeAuth === 'origin-only' ? 'No token' : 'Auth unknown'}
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
            busy ? 'text-accent' : 'text-ink-faint'
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

        {/* Sound moved here from GamePane's own header, same reasoning as
            Stop/Pause/Resume above: a control that only exists inside one
            scrollable panel is a control you lose the moment that panel
            scrolls off, and this bar is the one place that's always part of
            the window. */}
        <SoundControls />
      </div>
    </footer>
  )
}
