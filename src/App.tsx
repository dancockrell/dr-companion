import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SetupWizard } from './components/first-run/SetupWizard'
import { Dashboard } from './components/dashboard/Dashboard'
import { RoomColumn } from './components/room/RoomColumn'
import { MapColumn } from './components/room/MapColumn'
import { Splitter } from './components/layout/Splitter'
import { AppControls } from './components/layout/AppControls'
import { SafetyFooter } from './components/layout/SafetyFooter'
import { SituationBanner } from './components/layout/SituationBanner'
import { Console } from './components/layout/Console'
import { MapWindow } from './components/MapWindow'
import { PanelWindow } from './components/PanelWindow'
import { PanelBoundary } from './components/shared/PanelBoundary'
import { CommandPalette } from './components/shared/CommandPalette'
import { useMapDock, setMapDock } from './lib/mapDock'
import { fitColumns } from './lib/columns'
import { useFreeform } from './lib/useLayout'
import type { PanelId } from './lib/layout'
import { useAppStore } from './store/useAppStore'
import { installKeybindings } from './lib/keybindings'
import { sendGame } from './lib/gameLink'
import { requestStopAll } from './lib/flowStop'

/**
 * Which window this is.
 *
 * The map pops out into a window of its own, which Tauri opens on
 * `index.html?view=map`. A query parameter rather than a route path, because
 * the bundled app is served from a file, where a path would 404 while working
 * fine under the dev server.
 */
function view(): { kind: 'map' } | { kind: 'panel'; id: PanelId } | { kind: 'app' } {
  if (typeof window === 'undefined') return { kind: 'app' }
  const q = new URLSearchParams(window.location.search)
  if (q.get('view') === 'map') return { kind: 'map' }
  if (q.get('view') === 'panel') {
    const id = q.get('id')
    if (id) return { kind: 'panel', id: id as PanelId }
  }
  return { kind: 'app' }
}

const DASH_KEY = 'drc.dash-width.v1'

/** The divider itself, which sits between the columns and has to be counted. */
const SPLIT_W = 8

/** Enough to keep a column grabbable so it can be dragged back. Nothing more. */
const MIN_PX = 80

export default function App() {
  const setupComplete = useAppStore((s) => s.setupComplete)
  const connectBridge = useAppStore((s) => s.connectBridge)
  const hostRef = useRef<HTMLElement | null>(null)

  /*
   * Connect the bridge when the app opens.
   *
   * Nothing did. `connectBridge()` was reachable only from the settings sheet
   * and from the popped-out map window, so a normal launch never dialled it -
   * the dashboard, the map, the room panel and the channel tabs all stayed
   * empty, and the only hint was a small "Bridge down" badge in the footer.
   *
   * Found against a live DragonRealms session, which is the only way it could
   * have been found: the game pane was full of real text the whole time,
   * because that is a separate TCP link to Lich's detachable client, not the
   * bridge. So the app looked half-alive - genuine game output beside a
   * character panel reading "Waiting for a character" - and the natural
   * reading was that the character panels were broken rather than that
   * nothing had ever asked the bridge for data.
   *
   * The popped-out map window connecting on mount is what makes this
   * definitely a miss rather than a decision: the same call, in the same
   * shape, exists one component away.
   */
  useEffect(() => {
    connectBridge()
  }, [connectBridge])

  const requestIntent = useAppStore((s) => s.requestIntent)

  /**
   * NumPad movement, F-key commands, Escape-to-stop — see keybindings.ts.
   *
   * Installed once at the root, same reasoning as flowStop.ts's signals:
   * one listener, one owner. Escape mirrors SafetyFooter's Stop all button
   * exactly (both the bridge intent and the client-side flow signal) rather
   * than only one half of it, so pressing the key and pressing the button
   * are the same action by construction, not two paths that happen to agree.
   */
  useEffect(() => {
    if (!setupComplete) return
    return installKeybindings({
      sendGame: (command) => void sendGame(command),
      stopAll: () => {
        requestIntent('stop_all')
        requestStopAll()
      },
    })
  }, [setupComplete, requestIntent])

  /**
   * The columns are fixed widths in pixels, not shares of the window.
   *
   * They were shares, and shares are wrong here for a reason that only shows
   * up in use: resize the window and every column moves. Someone sets the
   * dashboard to exactly the width of the Experience board, drags the window
   * a little wider to see the game text beside it, and the board reflows. The
   * setting they made was not a proportion, it was a width.
   *
   * So a width is what is stored. The map and the dashboard keep the pixels
   * they were given, and the room column takes whatever is left, which makes
   * it the one that absorbs a resize. That is the right one to give the slack
   * to: it holds a description and a chat log, both of which are text and
   * reflow happily, while the other two hold charts and boards that have a
   * size at which they are readable and no other.
   */
  const [dashW, setDashWState] = useState<number>(() => {
    const saved = Number(localStorage.getItem(DASH_KEY))
    return Number.isFinite(saved) && saved >= MIN_PX ? saved : 420
  })

  const setDashW = (px: number) => {
    const next = Math.max(MIN_PX, Math.round(px))
    setDashWState(next)
    try {
      localStorage.setItem(DASH_KEY, String(next))
    } catch {
      // Private mode. Losing a divider position is not worth an error.
    }
  }

  const dock = useMapDock()
  // Read through a subscription rather than a second useLayout: that hook
  // holds its state per component, so a copy here would keep saying false
  // after the dashboard turned freeform on, and the columns would never go.
  const uiMode = useAppStore((s) => s.uiMode)
  const freeform = useFreeform(uiMode)

  /**
   * How wide `main` is right now.
   *
   * Needed because the Splitter reports the pointer as a fraction of its
   * parent, and turning that back into pixels needs the parent width. Kept in
   * state rather than read off the ref during a drag, so the divider position,
   * which is derived from it, stays in step with the render.
   */
  const [hostW, setHostW] = useState(0)
  useLayoutEffect(() => {
    const el = hostRef.current
    if (!el) return
    setHostW(el.getBoundingClientRect().width)
    const ro = new ResizeObserver(([entry]) => setHostW(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [setupComplete])

  /*
   * The widths the columns are given, which are not always the ones they asked
   * for.
   *
   * They used to be the same thing, each column bounded below and not above
   * and neither aware of the other, and the app was found unusable because of
   * it: a stored map width of 1201.6px in an 1180px window put every game
   * control several hundred pixels past an edge that does not scroll. See
   * src/lib/columns.ts, which carries the measurements.
   */
  // What each column actually has to show right now, not what it is capable
  // of showing. A stored width is a real preference and stays stored; it is
  // only capped while there is nothing behind it - see MAP_EMPTY_WANT.
  const mapZone = useAppStore((s) => s.mapZone)
  const bridgeConnected = useAppStore((s) => s.bridgeConnected)
  const character = useAppStore((s) => s.character)
  const mapEmpty = !bridgeConnected || mapZone === null
  const dashEmpty = !character

  const fit = fitColumns({
    hostW,
    mapWant: dock.width,
    dashWant: dashW,
    mapDocked: dock.docked,
    splitW: SPLIT_W,
    mapEmpty,
    dashEmpty,
  })
  const mapW = fit.map
  const mapSplit = dock.docked ? SPLIT_W : 0

  /**
   * Put the columns back to the widths the app ships with.
   *
   * The stored widths are a real preference and `fitColumns` never rewrites
   * them - but a width set by a drag that overshot is also stored, and it is
   * indistinguishable from an intentional one. Found live: a stored map width
   * of 861.6px in an 1180px window, 73% of a MUD client given to the chart,
   * which left the dashboard clipped by 97px and the game pane pinned to its
   * 380px floor. Nobody chooses that; a drag produced it and nothing offered a
   * way back except dragging precisely.
   */
  const resetWidths = () => {
    setMapDock({ width: 300 })
    setDashW(420)
  }

  /** Small enough to keep a column grabbable, and no opinion beyond that. */
  const atLeastVisible = (px: number) => Math.max(MIN_PX, px)

  /**
   * A divider sits at an absolute x, and moving it sets the width to its left.
   *
   * Only the column immediately left of the divider changes. Everything to its
   * right is either fixed or flex, so nothing further along the row twitches
   * while a near divider is being adjusted, which is what made the earlier
   * share-based version feel like the layout was arguing back.
   *
   * A column can be dragged down to a sliver. It cannot be dragged over the
   * top of the rest of the app - that used to be allowed on the reasoning that
   * the content would scroll, and it does not.
   */
  const moveMapEdge = (share: number) => setMapDock({ width: atLeastVisible(share * hostW) })
  const moveDashEdge = (share: number) =>
    setDashW(atLeastVisible(share * hostW - mapW - mapSplit))

  // A popped-out panel is the whole window: no header, no console, no setup
  // wizard. The window *is* the panel, and chrome here would be space charged
  // twice.
  const v = view()
  if (v.kind === 'map') return <MapWindow />
  if (v.kind === 'panel') return <PanelWindow id={v.id} />

  // No max-width. The window is only as wide as the player has decided we are
  // worth against the game window next to it, and capping it at 560px would
  // throw away space they deliberately gave us. See docs/DESIGN.md, section
  // 2.115.
  return (
    <div className="h-full w-full bg-surface flex flex-col">
      {/* No title bar. The window has one, the character box carries the
          name, and the map says where you are. What is left is three
          controls, which do not need a band of their own. */}
      <AppControls />
      {setupComplete && <SituationBanner />}

      {/* Said out loud, because the alternative is what it looked like live:
        * a map at 42% of the window, a dashboard clipped by 97px, the game
        * pane pinned to its floor, and nothing anywhere connecting those three
        * facts to a stored width somebody's drag overshot.
        *
        * `fitColumns` has always returned `squeezed` and nothing read it -
        * the layout quietly did the right thing and never mentioned that it
        * was overriding a preference to do it. A silent correct answer and a
        * silent bug look identical from a chair.
        *
        * Only while it is actually squeezing. This is not a warning about the
        * widths being large; it is the app saying it could not honour them. */}
      {setupComplete && fit.squeezed && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-2 py-1 text-xs text-ink-faint">
          <span>
            Not enough width for the stored column sizes — the map and dashboard
            are being scaled down to keep the game pane usable.
          </span>
          <button
            type="button"
            onClick={resetWidths}
            className="shrink-0 rounded border border-border px-1.5 py-0.5 text-ink-muted hover:bg-surface-overlay hover:text-ink"
          >
            Reset widths
          </button>
        </div>
      )}

      <main ref={hostRef} className="flex min-h-0 flex-1 overflow-hidden">
        {setupComplete ? (
          <>
            {/* The map gets a column of its own, when it is docked.
             *
             * It was a cell in the dashboard grid, competing for vertical
             * space with everything else in that column and losing. The map is
             * the one surface that is watched rather than consulted - players
             * keep it in view while doing something else - so it gets full
             * height and a width the player sets.
             *
             * Popped out, the column is not narrowed, it is gone: a strip of
             * chrome saying the map is elsewhere would cost width for nothing.
             * The remembered width survives, and the map comes back at it, so
             * popping out and back is not a move that costs you the layout. */}
            {dock.docked && !freeform && (
              <>
                <div
                  className="min-w-0 shrink-0 overflow-hidden border-r border-border"
                  style={{ width: mapW }}
                >
                  <PanelBoundary label="Map">
                    <MapColumn />
                  </PanelBoundary>
                </div>
                <Splitter
                  value={hostW > 0 ? mapW / hostW : 0.33}
                  onChange={moveMapEdge}
                  min={0}
                  max={1}
                />
              </>
            )}
            {/* In freeform the dashboard IS the window. Giving it a fixed
              * width and parking two columns beside it is the arrangement
              * freeform exists to escape: panels that move freely inside a
              * third of the screen are still panels in a column. */}
            <div
              className={freeform ? 'min-w-0 flex-1 overflow-hidden' : 'min-w-0 shrink-0 overflow-auto'}
              style={freeform ? undefined : { width: fit.dash }}
            >
              <PanelBoundary label="Dashboard">
                <Dashboard />
              </PanelBoundary>
            </div>
            {!freeform && (
              <Splitter
                value={hostW > 0 ? (mapW + mapSplit + fit.dash) / hostW : 0.66}
                onChange={moveDashEdge}
                min={0}
                max={1}
              />
            )}
            {/* The column that absorbs a window resize.
              *
              * Hidden in freeform along with the map column and both
              * splitters: a canvas you can arrange freely inside one third of
              * the window is still a column, which is the thing freeform is
              * for escaping. */}
            {!freeform && (
              <div className="min-w-0 flex-1 overflow-auto">
                <RoomColumn />
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <SetupWizard />
          </div>
        )}
      </main>
      {setupComplete && <Console />}
      {setupComplete && <SafetyFooter />}
      {setupComplete && <CommandPalette />}
    </div>
  )
}
