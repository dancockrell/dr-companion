import { useSyncExternalStore } from 'react'
import { LichLauncher } from './LichLauncher.tsx'
import { SignIn } from './SignIn.tsx'
import { useAppStore } from '../../store/useAppStore.ts'
import { bridgeCommand } from '../../lib/frontends.ts'
import { gameState, linkPhase, subscribeGame } from '../../lib/gameLink.ts'
import {
  workspaceScreen,
  workspaceState,
  type WorkspaceAction,
} from '../../lib/sessionSource.ts'

/**
 * No character yet, which happens more often than it sounds: setup is
 * remembered across restarts, so anyone who has run this before lands here
 * every time they open the app before Lich is up.
 *
 * Extracted from Dashboard.tsx when the middle dashboard column was removed
 * from the main layout entirely (Dan's call: kill the middle, give the map,
 * chat, functions and battle the screen). This screen used to be what
 * `<Dashboard>` rendered in place of its usual panels; now that there is no
 * `<Dashboard>` in the normal flow, App.tsx shows this directly in place of
 * the whole three-column layout, since none of map/chat/battle/experience
 * have anything real to show without a character either.
 *
 * # It renders a state, it does not decide one (issue #523)
 *
 * The words and the list of things that can be pressed come from
 * `workspaceScreen()` in `src/lib/sessionSource.ts`. This file maps each
 * action id to a control and writes no prose of its own beyond the two
 * explanatory paragraphs at the bottom.
 *
 * That split is the fix rather than tidying. This screen used to branch on
 * `bridgeConnected` alone, so an open **game socket** was invisible to it -
 * the bridge and the game are different connections to different ports - and
 * it printed "Nothing is connected yet" while the app held a live connection
 * with real text arriving on it. Measured on the clean VM on 9 September 2026,
 * from outside the app: two established connections to port 11124 at that
 * exact moment. A state the screen could not see is a state it could not have
 * a screen for, and `tools/attach-states-test.mjs` now asserts every state has
 * one and that every screen has at least one thing to press.
 */
export function WaitingForCharacter() {
  const setupComplete = useAppStore((s) => s.setupComplete)
  const bridgeConnected = useAppStore((s) => s.bridgeConnected)
  const bridgeMode = useAppStore((s) => s.bridgeMode)
  const hasCharacter = useAppStore((s) => Boolean(s.character))
  const startDemo = useAppStore((s) => s.startDemo)
  // Subscribed, not read once: the socket opens while this screen is on
  // screen, and that is the whole event it needs to notice.
  const link = useSyncExternalStore(subscribeGame, gameState, gameState)

  const state = workspaceState({
    setupComplete,
    bridgeMode,
    gameSocketOpen: linkPhase(link) !== 'idle',
    bridgeConnected,
    hasCharacter,
  })
  const screen = workspaceScreen(state)
  const can = (a: WorkspaceAction) => screen.actions.includes(a)

  /*
   * The ways forward, kept together and placed near the top of the panel.
   *
   * They used to be the last thing in the column, under six paragraphs, a
   * command block and the whole Lich launcher - roughly 900px of panel in the
   * real app. The app's own default window is 1180x820 and its declared
   * minimum is 720x480 (`REQUESTED` and `MIN` in `src-tauri/src/lib.rs`), so
   * on a fresh install "Start the demo" was below the bottom edge and could
   * not be reached by any means (issue #418). The demo was the only route in
   * for somebody with no Lich yet, and it was off screen.
   *
   * Nothing was cut to make room. The explanation is the same length; it is
   * now below the buttons instead of in front of them, which is also the
   * better order to read it in - you are told what you can do, and then why
   * you are here.
   *
   * Which buttons appear is `screen.actions` and not a judgement made here, so
   * a state cannot end up with none. `attach` has no button in this column on
   * purpose: the Attach control has exactly one home, `GameConnectionBar` in
   * the game pane, which App.tsx now renders in every state (#523). A second
   * one here would be the fork `tools/game-connection-owner-test.mjs` exists
   * to refuse, so the action is honoured by a sentence pointing at it.
   */
  const actions = (
    <div className="mt-3 flex flex-wrap gap-2">
      {can('start-demo') && (
        /*
         * Asking for the demo is an act, not the absence of one.
         *
         * This used to call `simulateConnect()`, which was `connectBridge()`
         * under another name, and worked only because mock was already the
         * mode on every fresh install. With `live` the default (issue #382)
         * that would have attached the real bridge and left the button
         * apparently doing nothing. `startDemo` is the one action now, and it
         * closes a game connection first if there is one (#525).
         */
        <button
          type="button"
          onClick={() => void startDemo()}
          className="rounded border border-accent/40 bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/25"
        >
          Start the demo
        </button>
      )}
      {can('leave-demo') && (
        <button
          type="button"
          onClick={() => {
            const s = useAppStore.getState()
            s.setBridgeMode('live')
            s.connectBridge()
          }}
          className="rounded border border-border px-3 py-1.5 text-xs text-ink-muted hover:text-ink"
        >
          Leave the demo
        </button>
      )}
      {can('connection-help') && (
        <button
          type="button"
          onClick={() => useAppStore.getState().openSetup()}
          className="rounded border border-border px-3 py-1.5 text-xs text-ink-muted hover:text-ink"
          title="The full connect guide, including Platinum, Fallen and Test"
        >
          Connection help
        </button>
      )}
    </div>
  )

  return (
    /*
     * `overflow-y-auto` is the half of the #418 fix that does not depend on
     * anybody keeping the panel short. Reordering makes it fit today; this
     * makes it reachable whatever it grows into, and whatever size the window
     * is dragged to.
     *
     * `justify-center` is gone on purpose, and it was not merely redundant:
     * a flex column that centres content taller than itself pushes the
     * overflow off *both* ends, and the part above the start edge cannot be
     * scrolled to in any browser. That is why the heading was missing off the
     * top of the clean-VM screenshots as well as the buttons off the bottom.
     * `my-auto` on the child below centres the same way when there is room
     * and does not clip when there is not.
     */
    <div className="flex h-full min-w-0 flex-col items-start overflow-y-auto p-6" data-workspace-state={state}>
      {/* `w-full` matters as much as the cap beside it.
       *
       * `items-start` makes a flex child shrink-to-fit, so this box sized to
       * its own content rather than to the column - and its content includes
       * a `pre` holding a Windows path that cannot wrap. That set a hard
       * 315px floor the column could not go below, the `overflow-x-auto` on
       * the `pre` never got a chance to engage, and the surrounding prose was
       * cut off mid-word with a scrollbar under it instead.
       *
       * `w-full` lets it take the column's width; `max-w-lg` still stops it
       * running to a silly measure on a wide one.
       */}
      <div className="my-auto w-full max-w-lg">
        {/*
         * The heading is the largest type on the screen because this is the
         * first thing a new install shows - the app no longer opens on an
         * invented character (issue #382).
         *
         * One heading per state, and the states are separate because they are
         * different situations rather than one situation with more detail:
         * nothing attached, a game socket open with nobody logged in, and the
         * bridge up with no character reported. A single heading would be
         * wrong in two of the three, and it was.
         */}
        <p className="text-base font-semibold text-ink">{screen.heading}</p>
        <p className="mt-1 text-sm text-ink-muted">{screen.sentence}</p>

        {can('bridge-command') && (
          /*
           * Keyed on the action, not on the state name. Listing the states
           * here would be a second opinion about which of them want this
           * sentence, and `tools/attach-states-test.mjs` caught exactly that:
           * the action existed in the enumeration and nothing rendered it, so
           * a state could have declared it and still shown nothing.
           */
          <p className="mt-2 text-sm text-ink-muted">
            {state === 'live-waiting' && (
              <>
                The connection is on{' '}
                <code className="text-ink">
                  {link.host}:{link.port}
                </code>
                .{' '}
              </>
            )}
            To fill in the vitals, the map and the rest, run{' '}
            {/* `null` = no frontend in the path, which is this app's own
              * route: Lich runs headless and the command character is `;`.
              * See `prefixFor`. This line hardcoded a comma until N6. */}
            <code className="text-ink">{bridgeCommand(null)}</code> in the game
            so Lich starts the companion bridge.
          </p>
        )}

        {actions}

        {can('attach') && (
          /*
           * The one sentence that closes #523's dead end. The control it names
           * is on screen: App.tsx renders the console row - and therefore the
           * game pane and its connection bar - whether or not there is a
           * character, so "use Attach below" is an instruction that can be
           * followed rather than a description of a button that unmounted.
           */
          <p className="mt-2 text-xs text-ink-muted">
            To reach a Lich that is already running, set the port and press
            Attach in the game pane below.
          </p>
        )}

        {can('sign-in') && (
          <>
            {/*
             * What used to be here: four config lines and a connect command,
             * telling the player to go and set another program up so that it
             * would start Lich. That was the app admitting it could not sign
             * anybody in, plus a warning that the route it recommended left
             * the channel tabs empty.
             *
             * It can sign somebody in now. `SignIn` performs the account login
             * itself and starts Lich with the result, so the instructions are
             * deleted rather than kept beside it as a second route - there is
             * no second, legacy sign-in route anywhere in this app.
             */}
            <p className="mt-1 text-xs text-ink-muted">
              Sign in below and the app starts Lich for you. There is nothing
              else to open and nothing to set up first.
            </p>

            <SignIn />
            <LichLauncher />
          </>
        )}
      </div>
    </div>
  )
}
