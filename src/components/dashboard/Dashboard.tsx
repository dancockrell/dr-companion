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
import { useEffect, useRef } from 'react'
import { LichLauncher } from '../shared/LichLauncher.tsx'
import { SignIn } from '../shared/SignIn.tsx'
import { useAppStore } from '../../store/useAppStore.ts'
import { useLayout } from '../../lib/useLayout.ts'
import type { PanelId } from '../../lib/layout'
import { DashboardLayout } from './DashboardLayout.tsx'
import { cn } from '../../lib/cn.ts'
import { PANEL_CONTENT, PANEL_TITLES } from './panels.tsx'
import { FreeCanvas } from './FreeCanvas.tsx'
import { useHiddenMiddlePanels, type MiddlePanelId } from '../../lib/panelVisibility.ts'
import { closePanelWindow, openPanelWindow, usePanelWindows } from '../../lib/panelWindows.ts'

/**
 * The ids that exist in both `PanelId` (freeform/pop-out/dock) and
 * `MiddlePanelId` (Settings' "Dashboard panels" list) - see
 * `panelVisibility.ts`'s own header for why there even are two id spaces for
 * what looks like one panel set. Without this bridge, freeform quietly
 * ignored Settings: unchecking Training there, then pressing "Arrange
 * freely," brought Training right back with no way to tell why from where
 * the player made the change - the "one setting has two effects, no visible
 * link" trap. Not every `MiddlePanelId` has a `PanelId` twin (Objects, Quick
 * Queue and You never did), so this only covers the overlap; freeform never
 * draws those separately in the first place, so there is nothing to bridge
 * for them.
 */
const SHARED_PANEL_IDS: Partial<Record<PanelId, MiddlePanelId>> = {
  training: 'training',
  inventory: 'inventory',
  risk: 'risk',
  scripts: 'scripts',
}

function isHiddenViaSettings(id: PanelId, hidden: Set<MiddlePanelId>): boolean {
  const twin = SHARED_PANEL_IDS[id]
  return twin !== undefined && hidden.has(twin)
}

export function Dashboard() {
  const character = useAppStore((s) => s.character)
  const bridgeConnected = useAppStore((s) => s.bridgeConnected)
  const uiMode = useAppStore((s) => s.uiMode)
  const { layout, cycleDeck, place, unplace, enterFreeArrange } = useLayout(uiMode)
  const hiddenMiddlePanels = useHiddenMiddlePanels()

  // Which panel is in the hand, and where it would land. Held here rather than
  // in each Panel so the insertion line can be drawn on a different panel from
  // the one being dragged.

  // Which panels are in windows of their own. Asked rather than remembered:
  // each is a separate webview, and the player can close one by hand without
  // this window hearing about it.
  const windows = usePanelWindows()
  const out = windows.open
  const popOut = (id: PanelId) => void openPanelWindow(id, PANEL_TITLES[id])
  const popBack = (id: PanelId) => void closePanelWindow(id)
  const windowErrors = Object.entries(windows.errors) as Array<[PanelId, string | undefined]>

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
               * What used to be here: four config lines to type into another
               * program, a connect command, and a warning that the route they
               * described left this app's channel tabs empty. All of it existed
               * because the app could not sign anybody in and had to describe
               * how to get a logged-in Lich by other means.
               *
               * It signs people in now. `SignIn` performs the account login and
               * starts Lich with the result, and `LichLauncher` below starts a
               * character Lich has already saved. Two routes to the same place,
               * both inside the app; no third one written out as prose.
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
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              // Set the mode, then connect - the demo is asked for, never
              // the default. Same pair as Settings and WaitingForCharacter;
              // see issue #382.
              useAppStore.getState().setBridgeMode('mock')
              useAppStore.getState().connectBridge()
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
      !out.includes(id) &&
      !isHiddenViaSettings(id, hiddenMiddlePanels)
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
        {windows.registryError && (
          <p role="status" className="mr-auto text-xs text-warn">{windows.registryError} Keeping the last known layout.</p>
        )}
        {windowErrors.map(([id, error]) => error && (
          <button
            key={id}
            type="button"
            className="mr-auto rounded border border-warn/50 bg-warn/10 px-2 py-0.5 text-left text-xs text-warn"
            onClick={() => out.includes(id) ? popBack(id) : popOut(id)}
          >
            {PANEL_TITLES[id] ?? id}: {error} Retry.
          </button>
        ))}
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
              <span key={id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => popBack(id)}
                  disabled={windows.pending[id] === 'closing'}
                  title="Bring it back in here" aria-label="Bring it back in here"
                  className="rounded border border-border px-1.5 py-0.5 text-ink-faint hover:text-ink disabled:opacity-50"
                >
                  {windows.pending[id] === 'closing' ? 'Closing…' : (PANEL_TITLES[id] ?? id)}
                </button>
              </span>
            ))}
          </div>
        )}
        <DashboardLayout dense={dense} onPopOut={popOut} />
        </>
      )}
    </div>
  )
}
