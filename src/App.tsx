import { lazy, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { WaitingForCharacter } from './components/shared/WaitingForCharacter'
import { ExperienceStrip } from './components/shared/ExperienceStrip'
import { GameSignals } from './components/shared/GameSignals'
import { GameActionNotice } from './components/game/GameActionNotice'
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
import { AuxiliaryWindowBoundary } from './components/shared/AuxiliaryWindowBoundary'
import { CommandPalette } from './components/shared/CommandPalette'
import { useMapDock } from './lib/mapDock'
import {
  combatBattleWant,
  combatRoomWant,
  fitColumns,
  pickReset,
  DEFAULT_ROOM_W,
  DEFAULT_MAP_W,
  DEFAULT_DASH_W,
  pixelsForSizeShare,
  sizeShareForPixels,
  storedSizeShare,
} from './lib/columns'
import { BATTLE_SCENE_MAX_WIDTH_VH } from './components/room/BattleColumn'
import type { PanelId } from './lib/layout'
import { useAppStore } from './store/useAppStore'
import { installKeybindings } from './lib/keybindings'
import { requestGameAction } from './lib/gameActions'
import { requestStartFlow, requestStopAll } from './lib/flowStop'
import { MACROS } from './data/macros'
import { requestMacro } from './lib/macroFlight'
import { writeText } from './lib/storage'
import { taskPinActiveId, taskPinLanguage } from './lib/quickSwitch'
import { StorageWarning } from './components/shared/StorageWarning'
import { LazySurface } from './components/shared/LazySurface'

const SetupWizard = lazy(() => import('./components/first-run/SetupWizard').then((module) => ({ default: module.SetupWizard })))

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
const ROOM_KEY = 'drc.room-width.v2'
const BATTLE_KEY = 'drc.battle-width.v3'
/** Was `drc.dash-width.v1` - the same stored preference, same fitColumns
 * slot, now spent on the Experience strip instead of the middle dashboard
 * that no longer exists. Renamed rather than reused under its old name so a
 * stale 420px "dashboard" width from before this change reads as exactly
 * what it now is - and because DEFAULT_DASH_W/DASH_EMPTY_WANT in columns.ts
 * were sized for a two-column panel grid, not a single scrolling board; see
 * the width picked below. */
const EXPERIENCE_KEY = 'drc.experience-width.v2'
const MAP_HEIGHT_KEY = 'drc.map-height.v3'
const LEGACY_MAP_HEIGHT_KEY = 'drc.map-height.v1'

/**
 * Stored as a share of the window (0 to 1), not a pixel count.
 *
 * A width chosen at 1920px is a sliver of a 5120px ultrawide and swallows a
 * 1280px laptop whole - a fixed pixel preference is only ever right on the
 * screen it was set on, which is why fitColumns carries an entire "not
 * enough width" rescue path (squeeze-toward-floor, a banner, a Reset
 * widths button) for the moment that preference stops fitting. Storing the
 * *share* instead means the preference is resolution-independent by
 * construction: the same layout comes back on any screen, not a pixel
 * count that happened to fit one. `Splitter.tsx`'s dividers already work
 * this way; this brings the outer three columns and the map's height in
 * line with it instead of carrying two different storage strategies for
 * the same kind of control.
 *
 * Every key bumped its version alongside this change - a share and a pixel
 * count are both just numbers, and reading an old 460 (px) as 460 (a share,
 * i.e. 46000%) would be silent, wrong, and exactly the "old data under a
 * new meaning" trap. A bumped key simply falls back to the default once,
 * the same way `EXPERIENCE_KEY`'s own rename above already handled a prior
 * meaning-change to this exact family of settings.
 *
 * The rescue path in fitColumns still matters and is untouched: a share
 * remains a *request*, and a squeezed/very small window still needs the
 * same floors, ceilings and "Reset widths" banner it always did. This only
 * changes what "the player's request" means from a fixed pixel count to a
 * fraction of whatever window they set it on.
 */
function readShare(key: string, reference: number, fallbackPx: number): number {
  return storedSizeShare(localStorage.getItem(key), reference, fallbackPx)
}
function writeShare(key: string, share: number) {
  if (share > 0 && share < 1) writeText(key, String(share))
}

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
      sendGame: (command) => requestGameAction(command, `Keyboard command “${command}”`),
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
          if (variation) requestMacro(variation.commands)
          return
        }
        if (pin.kind === 'script') {
          startScript(pin.name)
          return
        }
        if (taskPinActiveId(pin) === activeFlow) requestStopAll()
        else requestStartFlow(pin.id, taskPinLanguage(pin))
      },
    })
  }, [setupComplete, requestIntent])

  /**
   * The columns are shares of the window, not fixed pixel widths - see
   * `readShare`/`writeShare` above for why. Three real preferences now
   * (Room, Battle, Experience) - any width nobody asked for still goes to
   * Room by default (see fitColumns), so a wide window opens filled rather
   * than with a blank margin, but Room is no longer *only* ever a leftover.
   *
   * `window.innerWidth` stands in for `hostW` only until the real
   * measurement below lands on the next layout pass - close enough for one
   * frame, and self-correcting the moment `hostW` is real.
   */
  const [roomShare, setRoomShare] = useState<number>(() =>
    readShare(ROOM_KEY, window.innerWidth, DEFAULT_ROOM_W)
  )

  const [battleShare, setBattleShare] = useState<number>(() =>
    readShare(BATTLE_KEY, window.innerWidth, DEFAULT_MAP_W)
  )

  /** Experience, all the way to the right - see ExperienceStrip.tsx. A
   * single fixed column (MindstateBoard no longer reflows into two or three)
   * needs exactly enough width for its longest row and nothing more - 120,
   * measured against the actual rendered text ("Twohanded Edged" plus a
   * two-digit mindstate number, the longest real combination) rather than
   * guessed, with the scrollbar hidden (ExperienceStrip's own `no-scrollbar`)
   * so it never eats into that measurement. */
  const [experienceShare, setExperienceShare] = useState<number>(() =>
    readShare(EXPERIENCE_KEY, window.innerWidth, DEFAULT_DASH_W)
  )

  /**
   * How tall the map gets at the top of its shared column, as a share of the
   * window - player-set, the same way the other columns are.
   *
   * This used to be a fixed 120px, which is smaller than the map panel's own
   * chrome: measured live, the header is 27px and the pin-palette tool rail
   * is 78px, plus padding and gaps of about 28px more - 133px of always-there
   * content before a single pixel of the actual chart can be drawn. At 120
   * the chart got 0px and rendered nothing, silently: no error, no "too
   * short" notice, just an empty box, on an entirely ordinary window size.
   * Floored at 300 instead, so the worst case is a small but real map rather
   * than an invisible one - and `mapCanShareHeight` below (which gates the
   * "map hidden while the window is this short" message on this same
   * constant) now actually fires before the chart disappears, instead of
   * after.
   */
  const MIN_MAP_H = 300
  const [mapHShare, setMapHShare] = useState<number>(() => {
    const shared = Number(localStorage.getItem(MAP_HEIGHT_KEY))
    if (Number.isFinite(shared) && shared > 0 && shared < 1) return shared
    const legacy = Number(localStorage.getItem(LEGACY_MAP_HEIGHT_KEY))
    // Keep a real v1 customization. Only migrate the old shipped 480px
    // default, which is far too shallow on tall and ultrawide displays.
    if (Number.isFinite(legacy) && legacy >= MIN_MAP_H && legacy !== 480) {
      return sizeShareForPixels(legacy, window.innerHeight)
    }
    return DEFAULT_MAP_SHARE
  })

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

  // Shares are the live source of truth, not merely a startup encoding.
  // Re-resolving them against the measured host on every render means a
  // running window keeps the player's proportions while it is resized.
  const widthReference = hostW || window.innerWidth
  const heightReference = hostH || window.innerHeight
  const roomW = pixelsForSizeShare(roomShare, widthReference, MIN_PX)
  const battleW = pixelsForSizeShare(battleShare, widthReference, MIN_PX)
  const experienceW = pixelsForSizeShare(experienceShare, widthReference, MIN_PX)
  const mapH = pixelsForSizeShare(mapHShare, heightReference, MIN_MAP_H)

  const setRoomW = (px: number) => {
    const share = sizeShareForPixels(Math.max(MIN_PX, Math.round(px)), widthReference)
    setRoomShare(share)
    writeShare(ROOM_KEY, share)
  }
  const setBattleW = (px: number) => {
    const share = sizeShareForPixels(Math.max(MIN_PX, Math.round(px)), widthReference)
    setBattleShare(share)
    writeShare(BATTLE_KEY, share)
  }
  const setExperienceW = (px: number) => {
    const share = sizeShareForPixels(Math.max(MIN_PX, Math.round(px)), widthReference)
    setExperienceShare(share)
    writeShare(EXPERIENCE_KEY, share)
  }
  const setMapH = (px: number) => {
    const share = sizeShareForPixels(Math.max(MIN_MAP_H, Math.round(px)), heightReference)
    setMapHShare(share)
    writeShare(MAP_HEIGHT_KEY, share)
  }

  const character = useAppStore((s) => s.character)
  const experienceEmpty = !character
  const battleActive = character?.situation.includes('in_combat') ?? false
  const roomWantVisible = combatRoomWant(roomW, hostW, battleActive)
  const battleWantVisible = combatBattleWant(battleW, hostW, battleActive)
  // When both minimum panes physically cannot fit, preserve the primary game
  // surface and temporarily collapse the supplementary map. This is a view
  // adaptation only: mapH is not rewritten and returns with a taller window.
  const mapCanShareHeight =
    hostH <= 0 || hostH >= MIN_MAP_H + MIN_GAME_CHAT_H + SPLIT_W

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
    roomWant: roomWantVisible,
    mapWant: battleWantVisible,
    dashWant: experienceW,
    mapDocked: true,
    splitW: SPLIT_W,
    dashEmpty: experienceEmpty,
    // The scene is height-limited and landscape (8:5), so its own width cap
    // is a fixed share of `hostH` — `BATTLE_SCENE_MAX_WIDTH_VH`, the same
    // number `RoomScene`'s `min(100%, …vh)` uses to size the DOM (see
    // `BattleColumn`'s export of it). Grow Battle automatically only while
    // that width can become visible scene; explicit divider choices above
    // this remain untouched inside fitColumns.
    //
    // This used to be a second, independently-guessed constant (0.62) that
    // was tighter than the scene's real ceiling (0.832), so Battle plateaued
    // well short of the width `RoomScene` would actually have used — on a
    // wide-but-not-equally-tall window the column stopped growing at ~62% of
    // the window's height no matter how much wider the window got. Sharing
    // the one real number instead of carrying a second approximation of it
    // fixes that class of drift outright rather than re-tuning the guess.
    mapGrowthMax: hostH > 0 ? Math.max(battleW, hostH * (BATTLE_SCENE_MAX_WIDTH_VH / 100)) : undefined,
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
  if (v.kind === 'map') {
    return (
      <AuxiliaryWindowBoundary
        label="Map window"
        onError={(error) => useAppStore.getState().addLog(`Map window crashed: ${error.message}`, 'error')}
      >
        <StorageWarning />
        <MapWindow />
      </AuxiliaryWindowBoundary>
    )
  }
  if (v.kind === 'panel') {
    const label = `${v.id} panel window`
    return (
      <AuxiliaryWindowBoundary
        label={label}
        onError={(error) => useAppStore.getState().addLog(`${label} crashed: ${error.message}`, 'error')}
      >
        <StorageWarning />
        <PanelWindow id={v.id} />
      </AuxiliaryWindowBoundary>
    )
  }

  return (
    <div className="h-full w-full bg-surface flex flex-col">
      <AppControls />
      <StorageWarning />
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
            <LazySurface label="Setup">
              <SetupWizard />
            </LazySurface>
          </div>
        ) : !character ? (
          /* Nothing else here has anything real to show without a
           * character either - map, chat, battle and experience are all
           * readings of a live character, not independent tools. */
          <WaitingForCharacter />
        ) : (
          <>
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              {dock.docked && mapCanShareHeight && (
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
                    label="Resize map and game chat"
                    orientation="horizontal"
                    value={hostH > 0 ? mapH / hostH : DEFAULT_MAP_SHARE}
                    onChange={(share) => setMapH(hostH * share)}
                    min={MIN_MAP_H / Math.max(hostH, 1)}
                    max={hostH > 0 ? 1 - (MIN_GAME_CHAT_H + SPLIT_W) / hostH : 0.8}
                    defaultValue={DEFAULT_MAP_SHARE}
                  />
                </>
              )}
              {dock.docked && !mapCanShareHeight && (
                <div className="flex h-8 shrink-0 items-center border-b border-border bg-surface-raised px-2 text-xs text-ink-faint" role="status">
                  Map hidden while the window is this short. Enlarge it to restore your saved map height.
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-auto">
                <PanelBoundary label="Game and chat">
                  <GameChatColumn />
                </PanelBoundary>
              </div>
            </div>

            <Splitter
              label="Resize room and battle columns"
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
              label="Resize battle and experience columns"
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
      {setupComplete && <GameActionNotice />}
      {setupComplete && <Console />}
      {setupComplete && <QuickSwitchBar />}
      {setupComplete && <SafetyFooter />}
      {setupComplete && <CommandPalette />}
    </div>
  )
}
