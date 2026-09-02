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
 *
 * Also here (29 Aug 2026): a real music transport, not just the Sound
 * button. Stop all used to be `flex-1`, so it - the single most dangerous
 * button in the app - grew or shrank based on how much else happened to be
 * in the bar that render, for no reason connected to what it does. Sized to
 * its content now; the slack that freed up went to MusicTransport instead
 * of sitting empty, since this bar is the one place guaranteed to always be
 * on screen, which is exactly the argument Stop/Pause/Resume/Sound already
 * made for living here rather than in a scrollable panel.
 */
import { Square, Pause, Play, Heart, Navigation } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { useAppStore, isIntentImplemented } from '../../store/useAppStore'
import { requestStopAll, requestPauseAll, requestResumeAll } from '../../lib/flowStop'
import { MusicTransport } from '../game/MusicTransport'
import { isLowHealth } from '../../lib/vitals'
import { requestOpenSoundPanel } from '../../lib/soundPanelOpen'
import { cn } from '../../lib/cn'

const SoundControls = lazy(() => import('../game/SoundControls').then((module) => ({ default: module.SoundControls })))

// Same material language as the shared Button component: a hairline top
// highlight and bottom shadow so a filled button reads as struck metal
// rather than a flat colour swatch. These buttons predate that component and
// carry their own safety-specific behaviour (never disabled, sized to
// content, etc.), so the classes are copied in rather than routed through it.
const BUTTON_BEVEL =
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.12),inset_0_-1px_0_rgba(0,0,0,0.28)]'
const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

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
  const lowHealth = isLowHealth(character)
  const inCombat = character?.situation.includes('in_combat') ?? false
  const primaryLabel = lowHealth ? 'Healer' : inCombat ? 'Assist' : 'Start Training'
  const primaryIntent = lowHealth ? 'go_healer' : 'start_training'
  // See isIntentImplemented: null bridgeIntents (unknown bridge) never
  // disables anything, so this button stays live against every bridge that
  // predates the field.
  const primaryAvailable = isIntentImplemented(bridgeIntents, primaryIntent)
  const townRunAvailable = isIntentImplemented(bridgeIntents, 'town_run')

  return (
    <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-surface-raised/90 px-3 py-2">
      {character && primaryAvailable && (
        <button
          type="button"
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
            BUTTON_BEVEL,
            FOCUS_RING,
            lowHealth
              ? 'bg-danger/90 text-white border border-black/20 hover:bg-danger'
              : 'bg-accent text-surface border border-accent-soft/60 hover:bg-accent-soft'
          )}
          title={
            lowHealth
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

      {character && townRunAvailable && (
        <button
          type="button"
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-ink-muted transition-colors hover:border-ink-faint hover:bg-surface-overlay hover:text-ink',
            FOCUS_RING
          )}
          title="Bank, repair, restock"
          onClick={() => requestIntent('town_run')}
        >
          <Navigation className="h-4 w-4" />
          Town Run
        </button>
      )}

      <button
        type="button"
        className={cn(
          'flex min-w-[7.5rem] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-danger/90 px-3 py-2 text-sm font-semibold text-white transition-colors border border-black/20 hover:bg-danger',
          BUTTON_BEVEL,
          FOCUS_RING
        )}
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
        className={cn(
          'flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-ink-muted transition-colors hover:border-ink-faint hover:bg-surface-overlay hover:text-ink',
          FOCUS_RING
        )}
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
        className={cn(
          'flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-ink-muted transition-colors hover:border-ink-faint hover:bg-surface-overlay hover:text-ink',
          FOCUS_RING
        )}
        title="Carry on from where it paused"
        onClick={() => {
          requestIntent('resume')
          requestResumeAll()
        }}
      >
        <Play className="h-4 w-4" />
        Resume
      </button>

      {/* Stop/Pause/Resume used to be flex-1 by way of Stop all alone,
        * which meant the single most dangerous button in the app grew or
        * shrank based on how much else happened to be in the bar - wide
        * open one moment, cramped the next, for no reason connected to
        * what it does. Sized to its content now, and the room that freed
        * up is a real transport instead of empty bar: this app's own
        * music, always visible, not one popover click away. Its own
        * flex-1 so it's the one thing here that actually wants the slack
        * this bar has - a play/pause/skip/title deserves the space more
        * than an empty gap did. */}
      {/* No fixed height any more (30 Aug 2026) - the transport grew a
        * second row (a real, labelled scrubber under the skip buttons
        * instead of a bare unlabelled sliver squeezed into the button row
        * itself - Dan: "make the track scrubber long, clarify what it is").
        * `h-8` clipped that against a single-row assumption; letting the
        * wrapper size to its content is what lets the footer grow to fit. */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 border-l border-border pl-2">
        {/* w-full (30 Aug 2026): without it MusicTransport's column is only
          * as wide as its own button row (skip buttons + title + icons, all
          * `shrink-0` or bounded) - the scrubber's own `w-full` would then
          * be full width *of that*, not of the space this wrapper actually
          * has, so "long" silently capped out at the button row's width. */}
        <MusicTransport
          showVolume
          showProgress
          showTransitions
          showFavorite
          onTitleClick={requestOpenSoundPanel}
          className="w-full"
        />
      </div>

      {/* Its own basis so it drops to a second line in a narrow window rather
          than squeezing the three buttons it sits beside. Not `flex-1` any
          more (30 Aug 2026) - this and the music transport wrapper both
          being flex-1 split every extra pixel of window width 50/50
          regardless of which one actually wanted it, which is how "make the
          track scrubber longer" cashed out: the scrubber was already full
          width of its own wrapper, the wrapper just wasn't getting the
          room. This readout is badges and short status text with no real
          use for a wider box, so it keeps only `shrink` (it can still give
          up width at a narrow window) and drops `grow` - every leftover
          pixel now goes to the transport wrapper instead of being split. */}
      <div className="flex min-w-0 shrink basis-40 items-center justify-end gap-2 text-xs">
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
        <Suspense fallback={<span className="text-xs text-ink-faint" role="status">Loading sound…</span>}>
          <SoundControls />
        </Suspense>
      </div>
    </footer>
  )
}
