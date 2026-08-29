import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SetupWizard } from './components/first-run/SetupWizard'
import { Dashboard } from './components/dashboard/Dashboard'
import { BattleColumn } from './components/room/BattleColumn'
import { GameChatColumn } from './components/room/GameChatColumn'
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
import { useMapDock } from './lib/mapDock'
import { fitColumns, pickReset } from './lib/columns'
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
const BATTLE_KEY = 'drc.battle-width.v1'
const MAP_HEIGHT_KEY = 'drc.map-height.v1'

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
   * So a width is what is stored. The dashboard and the battle pane keep the
   * pixels they were given, and the left column — the zone map stacked over
   * the game text and channels — takes whatever is left, which makes it the
   * one that absorbs a resize. That is the right one to give the slack to: it
   * holds a description and a chat log, both of which are text and reflow
   * happily, while the other two hold a picture and a set of boards that have
   * a size at which they are readable and no other.
   *
   * The battle pane's width used to belong to the zone map — they swapped
   * which side of the window they sit on, and which of them gets a fixed,
   * player-set width rather than the flexible remainder. See the `<main>`
   * JSX below for why: the map moved in beside the game text it was always
   * conceptually paired with (both watched, not read), and the battle
   * picture — the thing worth a deliberate width now that the radar draws on
   * it — took the fixed slot instead.
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

  const [battleW, setBattleWState] = useState<number>(() => {
    const saved = Number(localStorage.getItem(BATTLE_KEY))
    // 600, not columns.ts's DEFAULT_MAP_W (300) that "Reset widths" falls
    // back to for this same slot — that constant is shared with a tested
    // fallback path for a genuine overshoot recovery, and 300 is still a
    // perfectly usable width there, just a plainer one. First launch gets
    // the better number: measured against RoomScene's own 68vh ceiling
    // (BattleColumn), the picture is still width-bound, not height-bound,
    // all the way out to about 640px, so anything short of that is leaving
    // real legibility on the table for no reason on a first run.
    return Number.isFinite(saved) && saved >= MIN_PX ? saved : 600
  })

  const setBattleW = (px: number) => {
    const next = Math.max(MIN_PX, Math.round(px))
    setBattleWState(next)
    try {
      localStorage.setItem(BATTLE_KEY, String(next))
    } catch {
      // Private mode. Losing a divider position is not worth an error.
    }
  }

  /**
   * How tall the map gets at the top of its shared column, in pixels -
   * player-set, the same way the dashboard and battle widths are. It was a
   * flat `h-72` (288px) with no way to change it, which is a decision made
   * on the player's behalf every session: someone who wants to watch a
   * dense zone deserves more of it than someone glancing at Crossing.
   */
  const MIN_MAP_H = 120
  const [mapH, setMapHState] = useState<number>(() => {
    const saved = Number(localStorage.getItem(MAP_HEIGHT_KEY))
    return Number.isFinite(saved) && saved >= MIN_MAP_H ? saved : 288
  })
  const setMapH = (px: number) => {
    const next = Math.max(MIN_MAP_H, Math.round(px))
    setMapHState(next)
    try {
      localStorage.setItem(MAP_HEIGHT_KEY, String(next))
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
  // Same measurement, for the map/game-chat column's own vertical split -
  // that column is `<main>`'s full height, so no second ref is needed.
  const [hostH, setHostH] = useState(0)
  useLayoutEffect(() => {
    const el = hostRef.current
    if (!el) return
    const box = el.getBoundingClientRect()
    setHostW(box.width)
    setHostH(box.height)
    const ro = new ResizeObserver(([entry]) => {
      setHostW(entry.contentRect.width)
      setHostH(entry.contentRect.height)
    })
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
  // of showing. A stored width is a real preference and stays stored.
  const character = useAppStore((s) => s.character)
  const dashEmpty = !character

  /*
   * `fitColumns`/`pickReset` (lib/columns.ts) still speak of "map" and
   * "room" — they were written for the arrangement before the swap, and
   * renaming their parameters is a bigger, riskier edit than this layout
   * change needs: that module is small, carefully tuned against real
   * overshoot bugs, and has its own test suite asserting those exact names.
   * Their shapes still fit perfectly, because nothing in the arithmetic
   * actually depends on which physical column is which — `mapWant` is just
   * "the first fixed-width ask", `room` is just "whatever guarantees a
   * floor and takes the leftover". Battle plays the part `mapWant`/`map`
   * used to play (a fixed, player-set width); the left column (zone map
   * over game text) plays the part `room` used to play (the flexible one,
   * with the floor that used to protect the game pane specifically now
   * protecting the same game pane, just relocated). Only the call site
   * needs to know that; the module itself never has to change or care.
   */
  const fit = fitColumns({
    hostW,
    mapWant: battleW,
    dashWant: dashW,
    mapDocked: true, // The battle pane isn't poppable — always in the row.
    splitW: SPLIT_W,
    dashEmpty,
  })
  const battleWFit = fit.map
  const leftWFit = fit.room

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
    // The decision (what to reset, and why only the offender) lives in
    // pickReset (lib/columns.ts) - a pure function, so issue #63's scenario
    // (a stored map of 1728.8px and a dashboard of 510px, only one of which
    // overshoots) has a real test rather than only this call site. Same
    // "map" ↔ battle relabeling as fitColumns above.
    const plan = pickReset({ hostW, mapDocked: true, mapWant: battleW, dashWant: dashW, splitW: SPLIT_W })
    if (plan.map !== null) setBattleW(plan.map)
    if (plan.dash !== null) setDashW(plan.dash)
  }

  /** Small enough to keep a column grabbable, and no opinion beyond that. */
  const atLeastVisible = (px: number) => Math.max(MIN_PX, px)

  /**
   * A divider sits at an absolute x, and moving it sets the width of exactly
   * one neighbour — the fixed-width one, never the room column, which has no
   * width of its own to set and simply keeps whatever the fixed columns
   * leave it.
   *
   * The room column sits first now (see `<main>` below — it swapped places
   * with the map), so the two dividers no longer both measure from the left
   * edge the way they did when map, dashboard and room ran in that order.
   * The room/dashboard divider still does: room has no explicit width, so
   * moving it to some absolute x just says "the dashboard should start
   * here", i.e. dashW = the remaining distance from that x out to wherever
   * the map begins (or the window edge, if the map is not docked). The
   * dashboard/map divider is the one that flipped — with the map now last,
   * its width is the distance from the divider to the *right* edge of the
   * window, not to the left, so this one measures from `hostW` inward
   * instead of from 0 outward. Get this backwards and dragging the map
   * divider right would shrink the map while it visibly grows, which is
   * exactly the kind of bug that only shows up by looking at the dragged
   * result rather than at the arithmetic.
   *
   * A column can be dragged down to a sliver. It cannot be dragged over the
   * top of the rest of the app - that used to be allowed on the reasoning that
   * the content would scroll, and it does not.
   */
  const moveDashEdge = (share: number) =>
    setDashW(atLeastVisible(hostW * (1 - share) - battleWFit - SPLIT_W))
  const moveBattleEdge = (share: number) =>
    setBattleW(atLeastVisible(hostW * (1 - share)))

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
            {/* The column that absorbs a window resize, first now: the zone
              * map stacked over the game text and channels, rather than the
              * battle picture. Both halves of this column are things you
              * watch or half-read continuously — the map for which rooms
              * break a script, the chat for what is being said — which is
              * exactly the "text and a chart reflow happily" reasoning that
              * used to justify giving this slot to the room column. See
              * columns.ts's ROOM_MIN for the floor this column has always
              * had regardless of what is actually inside it: it exists to
              * keep the game header, the input and the channel tabs usable,
              * and that content lives here now, not in the battle pane.
              *
              * Hidden in freeform along with the map's own box and both
              * splitters: a canvas you can arrange freely inside one third of
              * the window is still a column, which is the thing freeform is
              * for escaping. */}
            {!freeform && (
              <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                {/* The map, above the chat rather than sharing width with
                 * anything — it used to be its own column, full height, a
                 * width the player set; now it is paired with the chat below
                 * it the way Dan's own Genie layout pairs the AutoMapper with
                 * the game window. Its height is player-set the same way,
                 * through the horizontal splitter below it, rather than the
                 * flat 288px it used to be stuck at — someone watching a
                 * dense zone wants more of it than someone glancing at
                 * Crossing. Popped out, this box is simply absent and the
                 * chat column below takes the full height, same "gone, not
                 * narrowed" reasoning the old column had. */}
                {dock.docked && (
                  <>
                    <div
                      className="shrink-0 overflow-hidden"
                      style={{ height: hostH > 0 ? Math.min(mapH, hostH - MIN_PX) : mapH }}
                    >
                      <PanelBoundary label="Map">
                        <MapColumn />
                      </PanelBoundary>
                    </div>
                    <Splitter
                      orientation="horizontal"
                      value={hostH > 0 ? mapH / hostH : 288 / 800}
                      onChange={(share) => setMapH(hostH * share)}
                      min={MIN_MAP_H / Math.max(hostH, 1)}
                      max={0.8}
                    />
                  </>
                )}
                <div className="min-h-0 flex-1 overflow-auto">
                  <PanelBoundary label="Game and chat">
                    <GameChatColumn />
                  </PanelBoundary>
                </div>
              </div>
            )}
            {!freeform && (
              <Splitter
                value={hostW > 0 ? leftWFit / hostW : 0.34}
                onChange={moveDashEdge}
                min={0}
                max={1}
              />
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
            {/* The battle pane, last — against the window's right edge, a
             * fixed width the player sets, the same slot the zone map used
             * to occupy on the left. This is the picture worth a deliberate
             * width now that the radar draws on it: legible portraits and
             * name tags need real pixels, the way the interactive map always
             * did, and it should not be left with whatever the map and
             * dashboard happen to leave over. Not poppable (no `dock`-style
             * toggle) — unlike the map, there is no separate OS window for
             * it yet. */}
            {!freeform && (
              <>
                <Splitter
                  value={hostW > 0 ? 1 - battleWFit / hostW : 0.67}
                  onChange={moveBattleEdge}
                  min={0}
                  max={1}
                />
                <div
                  className="min-w-0 shrink-0 overflow-hidden border-l border-border"
                  style={{ width: battleWFit }}
                >
                  <PanelBoundary label="Battle">
                    <BattleColumn />
                  </PanelBoundary>
                </div>
              </>
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
