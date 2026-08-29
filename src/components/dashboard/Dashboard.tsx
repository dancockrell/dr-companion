/**
 * One dashboard: a map plane, and a plane of panels beside it.
 *
 * The map is not a widget you consult, it is a surface you watch — players know
 * which rooms break scripts and keep it in view while doing something else. As
 * a panel in a scrolling column it could never do that, because it was always
 * competing for vertical space with whatever sat above it, and it always lost.
 * So it gets a plane of its own and a divider the player drags.
 *
 * Everything else is arranged by the player. There used to be three
 * hand-written dashboards whose panel order was whatever order the panels had
 * been written in. Two players will not agree on what deserves their pixels — a
 * crafter wants inventory open and the map small, someone hunting wants the map
 * large and watched — so the app ships defaults and gets out of the way.
 *
 * No width is assumed anywhere. The window is only as wide as the player has
 * decided we are worth against the game window next to it. See §2.115.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { LichLauncher } from '../shared/LichLauncher'
import { useAppStore } from '../../store/useAppStore'
import { useLayout } from '../../lib/useLayout'
import type { PanelId } from '../../lib/layout'
import { isTauri, invokeTauri } from '../../lib/tauri'
import { DashboardLayout } from './DashboardLayout'
import { cn } from '../../lib/cn'
import { PANEL_CONTENT, PANEL_TITLES } from './panels'
import { FreeCanvas } from './FreeCanvas'

export function Dashboard() {
  const character = useAppStore((s) => s.character)
  const bridgeConnected = useAppStore((s) => s.bridgeConnected)
  const uiMode = useAppStore((s) => s.uiMode)
  const { layout, cycleDeck, place, unplace, enterFreeArrange } = useLayout(uiMode)

  // Which panel is in the hand, and where it would land. Held here rather than
  // in each Panel so the insertion line can be drawn on a different panel from
  // the one being dragged.

  // Which panels are in windows of their own. Asked rather than remembered:
  // each is a separate webview, and the player can close one by hand without
  // this window hearing about it.
  const [out, setOut] = useState<PanelId[]>([])
  const refreshOut = useCallback(() => {
    if (!isTauri()) return
    void invokeTauri('panel_windows')
      .then((ids) => setOut(Array.isArray(ids) ? (ids as PanelId[]) : []))
      .catch(() => setOut([]))
  }, [])

  useEffect(() => {
    refreshOut()
    // Cheap poll rather than an event, because the interesting change happens
    // in another window and closing one by hand emits nothing here.
    const t = setInterval(refreshOut, 2000)
    return () => clearInterval(t)
  }, [refreshOut])

  const popOut = useCallback(
    (id: PanelId) => {
      void invokeTauri('open_panel_window', { id, title: PANEL_TITLES[id] })
        .then(refreshOut)
        .catch(refreshOut)
    },
    [refreshOut]
  )

  const popBack = useCallback(
    (id: PanelId) => {
      void invokeTauri('close_panel_window', { id })
        .then(refreshOut)
        .catch(refreshOut)
    },
    [refreshOut]
  )

  // Measured, not read off the viewport. This app can be docked beside other
  // things, and a media query would describe the screen rather than the space
  // we were actually handed.
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = hostRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
  }, [])


  if (!character) {
    /*
     * No character yet, which happens more often than it sounds: setup is
     * remembered across restarts, so anyone who has run this before lands here
     * every time they open the app before Lich is up.
     *
     * This used to be one sentence in an otherwise empty pane, and beside the
     * room column it read as a broken app rather than a waiting one. It says
     * what it is waiting for and offers the two ways forward, because "complete
     * setup first" is not useful advice to someone who already did.
     */
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
         * Measured at three window sizes rather than reasoned about: the
         * content wanted 339px at all of them, while the column was given 281
         * at 1180x820 and 221 at 1000x700. At 1522x1610 it fits and looks
         * perfect - which is why this was invisible to everyone developing on a
         * large window, and why it was found by opening the app rather than by
         * reading the layout code.
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
               *
               * This said "Start Lich, then run the companion bridge script",
               * which is not the procedure. Genie launches Lich, not the other
               * way round, and the whole thing is four config lines typed into
               * Genie. Confirmed by connecting a real character and watching
               * this panel stay empty while the game played perfectly well
               * next to it.
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
               * Said plainly rather than left for someone to discover by
               * watching an empty tab row forever. `--genie` and the channel
               * tabs are mutually exclusive: Lich gates every pushStream tag
               * behind a capability the real Genie plugin never asked for,
               * because Genie users build named windows out of highlight
               * patterns instead of receiving the game's own labels. That is
               * true of this exact config block, not a caveat that happens to
               * apply here - same Lich, same flag, same missing capability,
               * whoever launches it.
               *
               * The button below launches Lich directly with --stormfront,
               * which does have it. This block stays for someone who wants to
               * keep the real Genie window open too, and that combination
               * costs the channel tabs specifically - nothing else.
               */}
              <p className="mt-2 text-xs text-warn">
                This keeps Genie as your window, and it means the channel tabs
                below stay empty - Lich only sends the game's channel labels to
                a frontend that asks for them, and Genie's own config does not.
                Use "Open Lich to sign in" instead if you want those.
              </p>

              {/* Or press the button, which is the point.
                *
                * The four config lines above stay, because they are what a
                * player needs when Genie is already open and they would rather
                * not restart it. But telling somebody the procedure is not the
                * same as doing it for them, and for as long as that was all
                * this screen offered, the honest description of this app was
                * "works, once you go and do something else first". */}
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

  const dense = uiMode === 'power'

  // The map is a drawer, not a region. It is the one surface that is watched
  // rather than consulted, and a panel competing for vertical space in a
  // stack loses that argument every time. See DESIGN-BIBLE section 3.
  //
  // It also means the map is drawn exactly once. The previous build had it in
  // a plane and in the dock at the same time, which is a bug and looked like
  // one.
  // `map` is held out of the dashboard because it has a column of its own -
  // drawing it in both is the bug the comment above describes.
  //
  // In freeform there is no map column: App hands the whole window to this
  // canvas. So the map has to come back in, or the one panel most people look
  // at most is the one thing they cannot move.
  const docked = layout.order.filter(
    (id) =>
      id !== 'vitals' &&
      (layout.freeform || (id !== 'map' && id !== 'game')) &&
      !out.includes(id)
  )

  return (
    <div ref={hostRef} className="flex h-full min-h-0 flex-col">

      {/*
       * The only entry point into freeform (issue #32). Freeform's own
       * drag/resize/place machinery has existed for a while — FreeCanvas
       * already falls back to firstFreeSlot for anything with no rect yet —
       * but nothing outside FreeCanvas's own pointer handlers ever set
       * `freeform: true`, so a player could never reach it through the app.
       * One button, always visible, that says which state it would leave and
       * which it would enter.
       */}
      {/* Left-aligned in freeform.
        *
        * Right-aligned it lands in the same band as AppControls, because
        * freeform gives the dashboard the whole window width - the two
        * overlapped, which is only visible by looking at the thing. */}
      <div
        className={cn(
          'flex items-center px-2 pt-1',
          layout.freeform ? 'justify-start' : 'justify-end'
        )}
      >
        <button
          type="button"
          onClick={() => (layout.freeform ? unplace() : enterFreeArrange())}
          title={
            layout.freeform
              ? 'Back to the fixed arrangement'
              : 'Drag any panel anywhere, and resize it'
          }
          className="rounded border border-border px-1.5 py-0.5 text-xs text-ink-faint hover:text-ink"
        >
          {layout.freeform ? 'Fixed layout' : 'Arrange freely'}
        </button>
      </div>

      {layout.freeform ? (
        <FreeCanvas
          items={docked.map((id) => ({
            id,
            rect: layout.rects[id],
            node: PANEL_CONTENT[id]?.(dense, false, {
              deckPrefs: layout.decks,
              onCycleDeck: cycleDeck,
            }),
          }))}
          onPlace={place}
          onReflow={unplace}
        />
      ) : (
        <>
        {out.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 px-2 pt-1 text-xs">
            <span className="text-ink-faint">In their own windows:</span>
            {out.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => popBack(id)}
                title="Bring it back in here" aria-label="Bring it back in here"
                className="rounded border border-border px-1.5 py-0.5 text-ink-faint hover:text-ink"
              >
                {PANEL_TITLES[id] ?? id}
              </button>
            ))}
          </div>
        )}
        <DashboardLayout dense={dense} onPopOut={popOut} />
        </>
      )}
    </div>
  )
}
