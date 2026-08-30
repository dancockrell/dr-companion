import { LichLauncher } from './LichLauncher'
import { useAppStore } from '../../store/useAppStore'

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

  return (
    <div className="flex h-full min-w-0 flex-col items-start justify-center gap-3 p-6">
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
      <div className="w-full max-w-lg">
        <p className="text-sm text-ink">Waiting for a character.</p>

        {bridgeConnected ? (
          <p className="mt-1 text-xs text-ink-muted">
            The bridge is up but no character has reported in yet. Log in, or run{' '}
            <code className="text-ink">,companion_bridge</code> in the game.
          </p>
        ) : (
          <>
            {/*
             * The likeliest state here is not "not started yet". It is
             * playing already, through Genie, with Lich not in the loop at
             * all — because Genie connects straight to the game and Lich is
             * a separate thing you have to point it at.
             */}
            <p className="mt-1 text-xs text-ink-muted">
              If you are already playing, this is the usual reason: Genie connects
              straight to the game, and Lich is a separate step. Nothing is broken,
              the companion just has nothing to read yet.
            </p>
            <p className="mt-2 text-xs text-ink-muted">In Genie, once per profile:</p>
            <pre className="mt-1 overflow-x-auto rounded border border-border bg-surface p-2 text-xs leading-relaxed text-ink-muted">
{`#config lichpath C:\\Ruby4Lich5\\Lich5\\lich.rbw
#config lichport 11024
#config licharguments --genie --dragonrealms
#lichconnect YourCharacterDR`}
            </pre>
            <p className="mt-2 text-xs text-ink-muted">
              Then <code className="text-ink">,companion_bridge</code> in the game.
              This panel fills in on its own.
            </p>
            {/*
             * `--genie` and the channel tabs are mutually exclusive: Lich
             * gates every pushStream tag behind a capability the real Genie
             * plugin never asked for.
             */}
            <p className="mt-2 text-xs text-warn">
              This keeps Genie as your window, and it means the channel tabs
              below stay empty - Lich only sends the game's channel labels to
              a frontend that asks for them, and Genie's own config does not.
              Use "Open Lich to sign in" instead if you want those.
            </p>

            <LichLauncher />
          </>
        )}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => useAppStore.getState().simulateConnect()}
          className="rounded border border-accent/40 bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/25"
        >
          Open the demo dashboard
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
    </div>
  )
}
