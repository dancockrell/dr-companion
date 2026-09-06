import { LichLauncher } from './LichLauncher.tsx'
import { SignIn } from './SignIn.tsx'
import { useAppStore } from '../../store/useAppStore.ts'
import { bridgeCommand } from '../../lib/frontends.ts'

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
 * It says what it is waiting for and offers the two ways forward, because
 * "complete setup first" is not useful advice to someone who already did.
 */
export function WaitingForCharacter() {
  const bridgeConnected = useAppStore((s) => s.bridgeConnected)
  const setBridgeMode = useAppStore((s) => s.setBridgeMode)
  const connectBridge = useAppStore((s) => s.connectBridge)

  /*
   * The two ways forward, kept together and placed near the top of the panel.
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
   */
  const actions = (
    <div className="mt-3 flex flex-wrap gap-2">
      {/*
       * Asking for the demo is now an act, not the absence of one.
       *
       * This used to call `simulateConnect()`, which was `connectBridge()`
       * under another name (the alias is now deleted) and worked only
       * because mock was already the mode on every fresh install. With
       * `live` the default (issue #382) that would have attached the real
       * bridge and left the button apparently doing nothing. The pair below
       * is the same pair Settings uses for its Mock button: set the mode,
       * then connect.
       */}
      <button
        type="button"
        onClick={() => {
          setBridgeMode('mock')
          connectBridge()
        }}
        className="rounded border border-accent/40 bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/25"
      >
        Start the demo
      </button>
      <button
        type="button"
        onClick={() => useAppStore.getState().openSetup()}
        className="rounded border border-border px-3 py-1.5 text-xs text-ink-muted hover:text-ink"
        title="The full connect guide, including Platinum, Fallen and Test"
      >
        Connection help
      </button>
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
    <div className="flex h-full min-w-0 flex-col items-start overflow-y-auto p-6">
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
         * The heading names the two ways forward, and it is the largest type
         * on the screen because this is now the first thing a new install
         * shows - the app no longer opens on an invented character (issue
         * #382). "Waiting for a character" was accurate and answered a
         * question nobody had asked yet: somebody who has just finished setup
         * does not know whether they are supposed to do something.
         *
         * It is inside the branch rather than above it because the two states
         * are different situations, not one situation with more detail.
         * Nothing is attached, versus the bridge is up and the character has
         * not reported in - a single heading would be wrong in one of them.
         */}
        {bridgeConnected ? (
          <>
            <p className="text-base font-semibold text-ink">Waiting for a character.</p>
            <p className="mt-1 text-sm text-ink-muted">
              The bridge is up but no character has reported in yet. Log in, or run{' '}
              {/* `null` = no frontend in the path, which is this app's own
                * route: Lich runs headless and the command character is `;`.
                * See `prefixFor`. This line hardcoded a comma until N6. */}
              <code className="text-ink">{bridgeCommand(null)}</code> in the game.
            </p>
            {actions}
          </>
        ) : (
          <>
            <p className="text-base font-semibold text-ink">Nothing is connected yet.</p>
            <p className="mt-1 text-sm text-ink-muted">
              Attach to Lich to see your own character, or start the demo to
              look around an invented one.
            </p>
            {actions}
            {/*
             * What used to be here: four config lines and a connect command,
             * telling the player to go and set another program up so that it
             * would start Lich. That was the app admitting it could not sign
             * anybody in, plus a warning that the route it recommended left the
             * channel tabs empty.
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
