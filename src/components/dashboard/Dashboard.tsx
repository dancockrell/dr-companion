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
import { useAppStore } from '../../store/useAppStore'
import { useLayout } from '../../lib/useLayout'
import type { PanelId } from '../../lib/layout'
import { isTauri, invokeTauri } from '../../lib/tauri'
import { DashboardLayout } from './DashboardLayout'
import { PANEL_CONTENT, PANEL_TITLES } from './panels'
import { FreeCanvas } from './FreeCanvas'

export function Dashboard() {
  const character = useAppStore((s) => s.character)
  const bridgeConnected = useAppStore((s) => s.bridgeConnected)
  const uiMode = useAppStore((s) => s.uiMode)
  const { layout, cycleDeck, place, unplace } = useLayout(uiMode)

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
      <div className="flex h-full flex-col items-start justify-center gap-3 p-6">
        <div>
          <p className="text-sm text-ink">Waiting for a character.</p>
          <p className="mt-1 text-xs text-ink-muted">
            {bridgeConnected
              ? 'The bridge is up but no character has reported in yet. Log in, or run the companion bridge script in Lich.'
              : 'Start Lich, then run the companion bridge script. This panel fills in on its own once it does.'}
          </p>
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
          >
            Setup
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
  const docked = layout.order.filter(
    (id) => id !== 'vitals' && id !== 'map' && !out.includes(id)
  )

  return (
    <div ref={hostRef} className="flex h-full min-h-0 flex-col">

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
                title="Bring it back in here"
                className="rounded border border-border px-1.5 py-0.5 text-ink-faint hover:text-ink"
              >
                {PANEL_TITLES[id] ?? id}
              </button>
            ))}
          </div>
        )}
        <DashboardLayout
          dense={dense}
          deckPrefs={layout.decks}
          onCycleDeck={cycleDeck}
          onPopOut={popOut}
        />
        </>
      )}
    </div>
  )
}
