import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SetupWizard } from './components/first-run/SetupWizard'
import { WaitingForCharacter } from './components/shared/WaitingForCharacter'
import { ExperienceStrip } from './components/shared/ExperienceStrip'
import { GameSignals } from './components/shared/GameSignals'
import { BattleColumn } from './components/room/BattleColumn'
import { GameChatColumn } from './components/room/GameChatColumn'
import { MapColumn } from './components/room/MapColumn'
import { Splitter } from './components/layout/Splitter'
import { AppControls } from './components/layout/AppControls'
import { SafetyFooter } from './components/layout/SafetyFooter'
import { SituationBanner } from './components/layout/SituationBanner'
import { Console } from './components/layout/Console'
import { QuickSwitchBar } from './components/layout/QuickSwitchBar'
import { MapWindow } from './components/MapWindow'
import { PanelWindow } from './components/PanelWindow'
import { PanelBoundary } from './components/shared/PanelBoundary'
import { CommandPalette } from './components/shared/CommandPalette'
import { useMapDock } from './lib/mapDock'
import { fitColumns, pickReset, DEFAULT_ROOM_W } from './lib/columns'
import type { PanelId } from './lib/layout'
import { useAppStore } from './store/useAppStore'
import { installKeybindings } from './lib/keybindings'
import { sendGame } from './lib/gameLink'
import { requestStartFlow, requestStopAll } from './lib/flowStop'
import { MACROS } from './data/macros'
import { canSendMacro } from './lib/canSendMacro'

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

/** Room - map + chat/functions, stacked - now a real stored preference
 * rather than whatever fitColumns had left over, so it is a genuine third
 * column alongside Battle and Experience. See columns.ts's own doc comment
 * on why an unclaimed leftover still goes here by default. */
const ROOM_KEY = 'drc.room-width.v1'
const BATTLE_KEY = 'drc.battle-width.v2'
/** Was `drc.dash-width.v1` - the same stored preference, same fitColumns
 * slot, now spent on the Experience strip instead of the middle dashboard
 * that no longer exists. Renamed rather than reused under its old name so a
 * stale 420px "dashboard" width from before this change reads as exactly
 * what it now is - and because DEFAULT_DASH_W/DASH_EMPTY_WANT in columns.ts
 * were sized for a two-column panel grid, not a single scrolling board; see
 * the width picked below. */
const EXPERIENCE_KEY = 'drc.experience-width.v1'
const MAP_HEIGHT_KEY = 'drc.map-height.v2'
const LEGACY_MAP_HEIGHT_KEY = 'drc.map-height.v1'

/** The divider itself, which sits between the columns and has to be counted. */
const SPLIT_W = 8

/** Enough to keep a column grabbable so it can be dragged back. Nothing more. */
const MIN_PX = 80

/**
 * The floor GameChatColumn keeps when the map above it grows - not MIN_PX.
 *
 * Found live: at a shorter window, `Math.min(mapH, hostH - MIN_PX)` let the
 * map claim everything down to an 80px sliver for Game+Channels, which is
 * this app's whole reason for existing, not a column somebody parked out of
 * the way. Measured what that produced - a 98px-tall box, room for the
 * header row and nothing else, the command input and every channel tab
 * pushed out with no way to reach them - and it is exactly the "map
 * squeezing the game pane to nothing" bug this app has already been broken
 * by once (see columns.ts's ROOM_MIN, the same floor for the same reason on
 * the horizontal axis). 240px holds the header, a handful of game lines and
 * the input row without feeling cramped.
 */
const MIN_GAME_CHAT_H = 240
/** The map is watched continuously; game/chat remains open below it. */
const DEFAULT_MAP_SHARE = 0.58

export default function App() {
  const setupComplete = useAppStore((s) => s.setupComplete)
  const connectBridge = useAppStore((s) => s.connectBridge)
  const hostRef = useRef<HTMLElement | null>(null)

  /*
   * Connect the bridge when the app opens. See the git history for why this
   * has to be an effect at the root rather than left to a panel that may
   * never mount.
   */
  useEffect(() => {
    connectBridge()
  }, [connectBridge])

  const requestIntent = useAppStore((s) => s.requestIntent)

  /**
   * NumPad movement, F-key commands, Escape-to-stop — see keybindings.ts.
   */
  useEffect(() => {
    if (!setupComplete) return
    return installKeybindings({
      sendGame: (command) => void sendGame(command),
      stopAll: () => {
        requestIntent('stop_all')
        requestStopAll()
      },
      quickSwitch: (slot) => {
        const { quickSwitchPins, activeFlow, startScript } = useAppStore.getState()
        const pin = quickSwitchPins[slot]
        if (!pin) return
        if (pin.kind === 'command') {
          const [macroId, variationId] = pin.actionKey.split(':')
          const variation = MACROS.find((macro) => macro.id === macroId)?.variations.find((item) => item.id === variationId)
          const state = useAppStore.getState()
          if (variation && canSendMacro({ stopLatched: state.character?.stopLatched, inFlight: false, connected: !!state.character }).canSend) {
            state.requestIntent('run_macro', { commands: variation.commands })
          }
          return
        }
        if (pin.kind === 'script') {
          startScript(pin.name)
          return
        }
        if (pin.id === activeFlow) requestStopAll()
        else requestStartFlow(pin.id)
      },
    })
  }, [setupComplete, requestIntent])

  /**
   * The columns are fixed widths in pixels, not shares of the window - see
   * columns.ts for why. Three real preferences now (Room, Battle,
   * Experience) - any width nobody asked for still goes to Room by default
   * (see fitColumns), so a wide window opens filled rather than with a
   * blank margin, but Room is no longer *only* ever a leftover.
   */
  const [roomW, setRoomWState] = useState<number>(() => {
    const saved = Number(localStorage.getItem(ROOM_KEY))
    return Number.isFinite(saved) && saved >= MIN_PX ? saved : DEFAULT_ROOM_W
  })

  const setRoomW = (px: number) => {
    const next = Math.max(MIN_PX, Math.round(px))
    setRoomWState(next)
    try {
      localStorage.setItem(ROOM_KEY, String(next))
    } catch {
      // Private mode. Losing a divider position is not worth an error.
    }
  }

  const [battleW, setBattleWState] = useState<number>(() => {
    const saved = Number(localStorage.getItem(BATTLE_KEY))
    return Number.isFinite(saved) && saved >= MIN_PX ? saved : 760
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

  /** Experience, all the way to the right - see ExperienceStrip.tsx. A
   * single fixed column (MindstateBoard no longer reflows into two or three)
   * needs exactly enough width for its longest row and nothing more - 120,
   * measured against the actual rendered text ("Twohanded Edged" plus a
   * two-digit mindstate number, the longest real combination) rather than
   * guessed, with the scrollbar hidden (ExperienceStrip's own `no-scrollbar`)
   * so it never eats into that measurement. */
  const [experienceW, setExperienceWState] = useState<number>(() => {
    const saved = Number(localStorage.getItem(EXPERIENCE_KEY))
    return Number.isFinite(saved) && saved >= MIN_PX ? saved : 168
  })

  const setExperienceW = (px: number) => {
    const next = Math.max(MIN_PX, Math.round(px))
    setExperienceWState(next)
    try {
      localStorage.setItem(EXPERIENCE_KEY, String(next))
    } catch {
      // Private mode. Losing a divider position is not worth an error.
    }
  }

  /**
   * How tall the map gets at the top of its shared column, in pixels -
   * player-set, the same way the other columns are.
   */
  const MIN_MAP_H = 120
  const [mapH, setMapHState] = useState<number>(() => {
    const saved = Number(localStorage.getItem(MAP_HEIGHT_KEY))
    if (Number.isFinite(saved) && saved >= MIN_MAP_H) return saved
    const legacy = Number(localStorage.getItem(LEGACY_MAP_HEIGHT_KEY))
    // Keep a real v1 customization. Only migrate the old shipped 480px
    // default, which is far too shallow on tall and ultrawide displays.
    if (Number.isFinite(legacy) && legacy >= MIN_MAP_H && legacy !== 480) return legacy
    return Math.max(MIN_MAP_H, Math.round(window.innerHeight * DEFAULT_MAP_SHARE))
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

  /**
   * How wide `main` is right now.
   */
  const [hostW, setHostW] = useState(0)
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

  const character = useAppStore((s) => s.character)
  const experienceEmpty = !character
  const battleActive = character?.situation.includes('in_combat') ?? false

  /*
   * `fitColumns`/`pickReset` (lib/columns.ts) still speak of "map" and
   * "dash" — they were written for the dashboard this app no longer has,
   * but the arithmetic never actually depended on which physical column
   * played which part. Battle plays the part `mapWant`/`map` used to play
   * (a fixed, player-set width, non-poppable); Experience now plays the
   * part `dashWant`/`dash` used to play (a fixed width with an "empty"
   * allowance for when there is nothing to show); Room (`roomWant`/`room`)
   * is the map + chat/functions stack, a real preference now rather than
   * whatever was left. Only the call site needs to know that; the module
   * itself never has to change or care.
   */
  const fit = fitColumns({
    hostW,
    roomWant: roomW,
    mapWant: battleW,
    dashWant: experienceW,
    mapDocked: true,
    splitW: SPLIT_W,
    dashEmpty: experienceEmpty,
    // The scene is height-limited and square. Grow Battle automatically only
    // while that width can become visible scene; explicit divider choices
    // above this remain untouched inside fitColumns.
    mapGrowthMax: hostH > 0 ? Math.max(battleW, hostH * 0.62) : undefined,
    // A single-column skill rail stops gaining information once its labels,
    // numbers and useful bar length fit. In combat, return any width beyond
    // that to the two active play surfaces. This is a display-time ceiling:
    // the player's saved Experience width returns as soon as combat ends.
    dashGrowthMax: battleActive ? 220 : undefined,
  })
  const battleWFit = fit.map
  const experienceWFit = fit.dash
  const leftWFit = fit.room

  const resetWidths = () => {
    const plan = pickReset({
      hostW,
      mapDocked: true,
      roomWant: roomW,
      mapWant: battleW,
      dashWant: experienceW,
      splitW: SPLIT_W,
    })
    if (plan.room !== null) setRoomW(plan.room)
    if (plan.map !== null) setBattleW(plan.map)
    if (plan.dash !== null) setExperienceW(plan.dash)
  }

  /** Small enough to keep a column grabbable, and no opinion beyond that. */
  const atLeastVisible = (px: number) => Math.max(MIN_PX, px)

  /**
   * Two dividers, three real columns - Room, Battle, Experience, each with
   * its own stored width now (see `roomW` above). Each divider sets the
   * width of the column on its *near* side directly, the same "distance
   * from an edge" shape either way: the first measures Room from the left
   * edge, the second measures Experience from the right edge, and Battle -
   * the one column with a divider on both sides - is left to whatever
   * `fitColumns` gives it from its own stored width and the other two's.
   */
  const moveLeftBattleEdge = (share: number) => setRoomW(atLeastVisible(hostW * share))
  const moveBattleExperienceEdge = (share: number) =>
    setExperienceW(atLeastVisible(hostW * (1 - share)))

  const v = view()
  if (v.kind === 'map') return <MapWindow />
  if (v.kind === 'panel') return <PanelWindow id={v.id} />

  return (
    <div className="h-full w-full bg-surface flex flex-col">
      <AppControls />
      {setupComplete && <SituationBanner />}
      {/* Runs regardless of what is on screen - see GameSignals.tsx's own
          header on why this cannot live inside a panel that might not
          mount. */}
      {setupComplete && <GameSignals />}

      {setupComplete && fit.squeezed && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-2 py-1 text-xs text-ink-faint">
          <span>
            Not enough width for the stored column sizes — Battle and Experience
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
        {!setupComplete ? (
          <div className="flex-1 overflow-y-auto">
            <SetupWizard />
          </div>
        ) : !character ? (
          /* Nothing else here has anything real to show without a
           * character either - map, chat, battle and experience are all
           * readings of a live character, not independent tools. */
          <WaitingForCharacter />
        ) : (
          <>
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              {dock.docked && (
                <>
                  <div
                    className="shrink-0 overflow-hidden"
                    style={{
                      height:
                        hostH > 0
                          ? Math.max(0, Math.min(mapH, hostH - MIN_GAME_CHAT_H - SPLIT_W))
                          : mapH,
                    }}
                  >
                    <PanelBoundary label="Map">
                      <MapColumn />
                    </PanelBoundary>
                  </div>
                  <Splitter
                    orientation="horizontal"
                    value={hostH > 0 ? mapH / hostH : DEFAULT_MAP_SHARE}
                    onChange={(share) => setMapH(hostH * share)}
                    min={MIN_MAP_H / Math.max(hostH, 1)}
                    max={hostH > 0 ? 1 - (MIN_GAME_CHAT_H + SPLIT_W) / hostH : 0.8}
                  />
                </>
              )}
              <div className="min-h-0 flex-1 overflow-auto">
                <PanelBoundary label="Game and chat">
                  <GameChatColumn />
                </PanelBoundary>
              </div>
            </div>

            <Splitter
              value={hostW > 0 ? leftWFit / hostW : 0.34}
              onChange={moveLeftBattleEdge}
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

            <Splitter
              value={hostW > 0 ? 1 - experienceWFit / hostW : 0.85}
              onChange={moveBattleExperienceEdge}
              min={0}
              max={1}
            />

            {/* No PanelBoundary border/header here on purpose - see
                ExperienceStrip.tsx: "we don't need borders and padding." A
                crash inside it would still be worth catching, so the
                boundary stays, just without Box's chrome around it. */}
            <div className="min-w-0 shrink-0 overflow-hidden" style={{ width: experienceWFit }}>
              <PanelBoundary label="Experience">
                <ExperienceStrip skills={character?.skills ?? []} />
              </PanelBoundary>
            </div>
          </>
        )}
      </main>
      {setupComplete && <Console />}
      {setupComplete && <QuickSwitchBar />}
      {setupComplete && <SafetyFooter />}
      {setupComplete && <CommandPalette />}
    </div>
  )
}
