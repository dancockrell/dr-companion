import { lazy, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { WaitingForCharacter } from './components/shared/WaitingForCharacter.tsx'
import { ExperienceStrip } from './components/shared/ExperienceStrip.tsx'
import { GameSignals } from './components/shared/GameSignals.tsx'
import { GameActionNotice } from './components/game/GameActionNotice.tsx'
import { BattleColumn } from './components/room/BattleColumn.tsx'
import { GameChatColumn } from './components/room/GameChatColumn.tsx'
import { Splitter } from './components/layout/Splitter.tsx'
import { TopBar } from './components/layout/TopBar.tsx'
import { TaskFlowPanel } from './components/dashboard/TaskFlowPanel.tsx'
import { StatsPanel } from './components/shared/StatsPanel.tsx'
import { RiskBar } from './components/shared/RiskBar.tsx'
import { ActionsPanel } from './components/shared/ActionsPanel.tsx'
import { AiWorkerPanel } from './components/shared/AiWorkerPanel.tsx'
import { AppControls } from './components/layout/AppControls.tsx'
import { SafetyFooter } from './components/layout/SafetyFooter.tsx'
import { SituationBanner } from './components/layout/SituationBanner.tsx'
import { WindowShell } from './components/layout/WindowShell.tsx'
import { Console } from './components/layout/Console.tsx'
import { QuickSwitchBar } from './components/layout/QuickSwitchBar.tsx'
import { PanelWindow } from './components/PanelWindow.tsx'
import { PanelBoundary } from './components/shared/PanelBoundary.tsx'
import { AuxiliaryWindowBoundary } from './components/shared/AuxiliaryWindowBoundary.tsx'
import { CommandPalette } from './components/shared/CommandPalette.tsx'
import { LichClosePrompt } from './components/shared/LichClosePrompt.tsx'
import { usePresentationBridgePublisher } from './lib/usePresentationBridgePublisher.ts'
import { subscribePresentationIntents } from './lib/presentationIntents.ts'
import { useAiWorkerHost } from './lib/aiWorkerHost.ts'
import {
  combatBattleWant,
  fitColumns,
  pickReset,
  pixelsForSizeShare,
  sizeShareForPixels,
  storedSizeShare,
  frameFits,
  SIDE_LEFT_W,
  SIDE_RIGHT_W,
  BOARD_MIN_W,
  CONSOLE_H,
  TOPBAR_H,
} from './lib/columns.ts'
import { windowView } from './lib/windowView.ts'
import { useAppStore } from './store/useAppStore.ts'
import { installKeybindings, runMacroCommands } from './lib/keybindings.ts'
import { requestGameAction } from './lib/gameActions.ts'
import { requestStartFlow, requestStopAll } from './lib/flowStop.ts'
import { MACROS } from './data/macros.ts'
import { claimMacroSend, requestMacro } from './lib/macroFlight.ts'
import { loadPlayerConfig } from './lib/playerConfig.ts'
import { currentAliases } from './lib/useAliases.ts'
import { expandAlias } from './lib/aliases.ts'
import { writeText } from './lib/storage.ts'
import { taskPinActiveId, taskPinLanguage } from './lib/quickSwitch.ts'
import { StorageWarning } from './components/shared/StorageWarning.tsx'
import { LazySurface } from './components/shared/LazySurface.tsx'

const SetupWizard = lazy(() => import('./components/first-run/SetupWizard.tsx').then((module) => ({ default: module.SetupWizard })))

/*
 * The map window is gone.
 *
 * D3 put `?view=map` behind `MAP_WINDOW_ENABLED = false`; D6 removes the
 * constant, the branch, `MapWindow.tsx` and the `'map'` case in `windowView`
 * together. Dan, 9 Sep 2026 (`docs/NO-3D.md`): "The map is gone. It is not
 * coming back, and cancelling 3D did not revive it. The room-graph data is
 * retained for one reason: so Godot can consume it."
 *
 * So there is no local `view()` wrapper any more - `windowView()` is the whole
 * answer, and a wrapper whose only job was to hide one branch from it would be
 * a second source of truth about which windows exist.
 */

/*
 * The three widths of the approved frame's workspace row.
 *
 * `docs/mockups/dr-companion-isometric-mvp.html` is
 * `228px | minmax(620px, 1fr) | 250px`: character side, board slot, context
 * side. Those are this app's three columns now, and they are the same three
 * `fitColumns` has always resolved - see the mapping written out at the
 * `fitColumns` call below, which is the one place that knows it.
 * So the frame is the existing arithmetic with the mockup's numbers as its
 * defaults, not a second layout engine beside it: the squeeze banner, the
 * floors, "Reset widths" and the share-not-pixels persistence all keep
 * working, and the rails stay draggable rather than becoming three hard
 * numbers a player cannot argue with.
 *
 * Every key is bumped, because each slot now holds different content at a
 * different size and a stored share is just a number. A v2 "room" share of
 * 0.34 meant a third of the window for map-plus-transcript; read as the new
 * left rail it would be a 460px column of vitals. That is exactly the "old
 * data under a new meaning" failure - silent, plausible, and wrong - so the
 * bump makes every existing install fall back to the mockup's defaults once,
 * the same way RIGHT_RAIL_KEY's own earlier rename already handled a
 * meaning-change to this family of settings.
 */
const LEFT_RAIL_KEY = 'drc.left-rail-width.v1'
const BOARD_KEY = 'drc.board-slot-width.v1'
/** The context side. Two renames back this was `drc.dash-width.v1`, the
 * dashboard column; then the Experience strip. It is the mockup's right rail
 * now - alerts, actions and the AI worker - and the Experience strip has
 * moved to the console row's own right cell, so the old name would describe
 * neither the slot nor its contents. */
const RIGHT_RAIL_KEY = 'drc.right-rail-width.v1'
/*
 * `drc.map-height.v4` and `drc.map-height.v1` used to be read here: how the
 * board slot divided between the map above and the battle picture below.
 * Nothing divides it now - the map is gone and the board slot is the battle
 * picture - so both keys are unread rather than reinterpreted. Reading a
 * stored map height as anything else is the "old data under a new meaning"
 * trap; `stripRetiredKeys` in `src/lib/layout.ts` deletes them instead.
 */

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
 * the same way `RIGHT_RAIL_KEY`'s own rename above already handled a prior
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
 * Every window of this app, rendered inside one frame.
 *
 * The frame is not decoration: `WindowShell` owns the demo banner, and it is
 * mounted here, above the view switch, so that *every* window carries it -
 * main and each popped-out panel. Issue #400 was the other shape, where the
 * banner sat inside the `v.kind === 'app'` return and the auxiliary return
 * above it showed an invented world with nothing saying so.
 *
 * `AppViews` therefore has no `return` a person can reach without passing
 * through the shell, which is the property `tools/first-screen-test.mjs`
 * asserts. Adding a third window kind cannot reintroduce the bug.
 */
export default function App() {
  const v = windowView()
  return (
    <WindowShell aux={v.kind !== 'app'}>
      <AppViews />
      {/* The one question this app asks on the way out (#488). Mounted beside
        * the view rather than inside it, so it does not depend on the setup
        * wizard having finished - a Lich can be running whatever the app is
        * showing - and only in the main window, which is the one whose close
        * Rust holds. */}
      {v.kind === 'app' && <LichClosePrompt />}
    </WindowShell>
  )
}

function AppViews() {
  // Read once, up front - `windowView()` is a pure read of location.search, and
  // every hook below that needs to know which window this is (the
  // presentation-bridge publisher chief among them) has to have it before
  // any hook is called, since hooks can't be called conditionally on the
  // `v.kind` branches further down.
  const v = windowView()
  const setupComplete = useAppStore((s) => s.setupComplete)
  const connectBridge = useAppStore((s) => s.connectBridge)
  const hostRef = useRef<HTMLElement | null>(null)
  usePresentationBridgePublisher(v.kind === 'app')
  // Same shape and the same reason: one window hosts it. Here rather than in
  // the Settings panel because a background worker that stops when you close
  // its status page is not a background worker - it publishes to the store in
  // aiWorkerHost.ts, which is what the panel reads.
  useAiWorkerHost(v.kind === 'app')

  /*
   * The other direction of the same bridge: Godot asks, Rust validates
   * against the snapshot we published, and this is what actually sends the
   * command. Main window only - every window shares one Tauri event bus, so
   * a listener in each would walk the character once per open window.
   * See presentationIntents.ts.
   */
  useEffect(() => {
    if (v.kind !== 'app') return
    // The store's log, so a travel click refused while paused says why where
    // the player is already looking. See presentationIntents.ts and #462.
    return subscribePresentationIntents((line) => useAppStore.getState().addLog(line, 'warn'))
  }, [v.kind])

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
      sendGame: (command) => requestGameAction(command, `Keyboard command “${command}”`, 'keybind'),
      // The player's own key macros, from the config panel. Read live so a
      // binding saved there works on the next press, and sent one command at a
      // time through the outbound lane with source `macro`, behind the same
      // in-flight gate the action bars claim.
      macros: () => loadPlayerConfig().macros,
      runMacro: ({ commands }) => {
        // Read once per fire rather than once per command: the whole macro
        // expands against one table, and `runMacroCommands` needs that same
        // table to tell `go #queue clear` typed literally from a `$s` whose
        // value is a Genie directive - issue #485.
        const { aliases, variables } = currentAliases()
        runMacroCommands(commands, {
          expand: (command) => expandAlias(command, aliases, { variables }).text,
          variables,
          send: (command) => requestGameAction(command, `Macro “${command}”`, 'macro'),
          claim: () => claimMacroSend().reason,
        })
      },
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
  const [leftRailShare, setRoomShare] = useState<number>(() =>
    readShare(LEFT_RAIL_KEY, window.innerWidth, SIDE_LEFT_W)
  )

  const [boardShare, setBattleShare] = useState<number>(() =>
    readShare(BOARD_KEY, window.innerWidth, BOARD_MIN_W)
  )

  /** Experience, all the way to the right - see ExperienceStrip.tsx. A
   * single fixed column (MindstateBoard no longer reflows into two or three)
   * needs exactly enough width for its longest row and nothing more - 120,
   * measured against the actual rendered text ("Twohanded Edged" plus a
   * two-digit mindstate number, the longest real combination) rather than
   * guessed, with the scrollbar hidden (ExperienceStrip's own `no-scrollbar`)
   * so it never eats into that measurement. */
  const [rightRailShare, setRightRailShare] = useState<number>(() =>
    readShare(RIGHT_RAIL_KEY, window.innerWidth, SIDE_RIGHT_W)
  )

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
  const leftRailW = pixelsForSizeShare(leftRailShare, widthReference, MIN_PX)
  const boardW = pixelsForSizeShare(boardShare, widthReference, MIN_PX)
  const rightRailW = pixelsForSizeShare(rightRailShare, widthReference, MIN_PX)

  const setLeftRailW = (px: number) => {
    const share = sizeShareForPixels(Math.max(MIN_PX, Math.round(px)), widthReference)
    setRoomShare(share)
    writeShare(LEFT_RAIL_KEY, share)
  }
  const setBoardW = (px: number) => {
    const share = sizeShareForPixels(Math.max(MIN_PX, Math.round(px)), widthReference)
    setBattleShare(share)
    writeShare(BOARD_KEY, share)
  }
  const setRightRailW = (px: number) => {
    const share = sizeShareForPixels(Math.max(MIN_PX, Math.round(px)), widthReference)
    setRightRailShare(share)
    writeShare(RIGHT_RAIL_KEY, share)
  }
  const character = useAppStore((s) => s.character)
  const battleActive = character?.situation.includes('in_combat') ?? false
  const leftRailWantVisible = leftRailW
  /* In combat the board becomes the primary surface and the rails pay for it
   * - `fitColumns` squeezes them toward their floors to fund the growth. A
   * display-time request only: the stored widths are untouched and return
   * the instant combat ends. */
  const boardWantVisible = combatBattleWant(boardW, hostW, battleActive)

  /*
   * `fitColumns`/`pickReset` (lib/columns.ts) still speak of "room", "map"
   * and "dash". They were named for a dashboard this app has not had for a
   * long time, and the arithmetic never depended on which physical column
   * played which part - which is exactly why the approved frame could be
   * built on it rather than beside it. The mapping now:
   *
   *   room  -> the board slot in the middle (BOARD_MIN_W and up)
   *   map   -> the left rail, the character side (SIDE_LEFT_W)
   *   dash  -> the right rail, the context side (SIDE_RIGHT_W)
   *
   * The board takes `room`'s part rather than `map`'s, which is the reverse
   * of what the names suggest and is the point. `room` is the slot that
   * absorbs width nobody claimed - "any width nobody asked for still goes
   * here by default", per the module's own header - and on this frame the
   * column that should grow into a wide window is the board. The rails are
   * 228 and 250 because that is what their content needs; a 431px column of
   * vitals on a large monitor is not a feature.
   *
   * That number is measured rather than imagined. With the mapping the other
   * way round, the left rail came out **431px at 1366x768** instead of 228,
   * because it was sitting in `room`'s slot being handed the surplus. Turning
   * the mapping around fixed it without touching `columns.ts` at all, which
   * is the argument for having built the frame on this module rather than
   * beside it.
   *
   * Three peer columns with floors, a fair squeeze when they do not fit, and
   * a "Reset widths" escape - all of which the frame needs and none of which
   * had to be rewritten to get it. Only this call site knows the mapping;
   * the module neither knows nor cares.
   */

  /**
   * Which rails the window is too narrow to draw at all - D2's `frameFits`,
   * doing the job it was added for. Decided before `fitColumns` runs,
   * because a rail that is not drawn must not be given a width either.
   *
   * The mockup answers this question with `body { min-width: 1120px;
   * overflow: hidden }`, which is the one thing from it this client must not
   * copy: clipping is precisely the failure `columns.ts` exists to prevent,
   * and a control off the edge with no scrollbar to reach it by is not a
   * small layout problem, it is a button nobody can press. Dropping a rail
   * is the honest version of the same adaptation - the player loses a panel
   * and can see that they have, instead of losing a control silently.
   */
  const frame = frameFits(hostW || window.innerWidth, hostH || window.innerHeight)
  const showLeftRail = !frame.mustCollapse.includes('left')
  const showRightRail = !frame.mustCollapse.includes('right')

  const fit = fitColumns({
    hostW,
    roomWant: boardWantVisible,
    mapWant: leftRailWantVisible,
    dashWant: rightRailW,
    mapDocked: showLeftRail,
    splitW: SPLIT_W,
    // The rails do not have an "empty" width. `dashEmpty`/`MAP_EMPTY_WANT`
    // exist so a column with nothing in it stops holding a player's stored
    // width hostage; these two hold vitals and context cards, which are the
    // same size whether or not there is a character to put in them.
    dashEmpty: false,
    // Cap each rail's growth at the width it actually asked for, so the
    // surplus-sharing in fitColumns has nothing to give them and every spare
    // pixel reaches the board. Without this the left rail takes half of any
    // unclaimed width, which is the 431px above.
    mapGrowthMax: leftRailWantVisible,
    dashGrowthMax: rightRailW,
  })
  const rightRailWFit = fit.dash
  const leftRailWFit = fit.map
  // `fit.room` - the board's fitted width - is deliberately not read. The two
  // rails are the only columns given an explicit width; the board is
  // `flex-1` and takes exactly what they leave, which is the same number by
  // construction and one that cannot round to a pixel more than the row has.
  // Setting both would be two authorities on one width, and the loser of
  // that argument is a horizontal scrollbar.

  /* The same slot mapping as the `fitColumns` call above - room is the board,
   * map is the left rail, dash is the right rail. Written out twice would be
   * two mappings to keep in step, so if you change one, change both; they are
   * adjacent for exactly that reason. */
  const resetWidths = () => {
    const plan = pickReset({
      hostW,
      mapDocked: showLeftRail,
      roomWant: boardW,
      mapWant: leftRailW,
      dashWant: rightRailW,
      splitW: SPLIT_W,
    })
    if (plan.room !== null) setBoardW(plan.room)
    if (plan.map !== null) setLeftRailW(plan.map)
    if (plan.dash !== null) setRightRailW(plan.dash)
  }

  /** Small enough to keep a column grabbable, and no opinion beyond that. */
  const atLeastVisible = (px: number) => Math.max(MIN_PX, px)

  /**
   * Two dividers, three columns. Each divider sets the width of the column
   * on its *near* side directly, the same "distance from an edge" shape
   * either way: the first measures the left rail from the left edge, the
   * second measures the right rail from the right edge, and the board slot -
   * the one column with a divider on both sides - takes whatever
   * `fitColumns` leaves it.
   */
  const moveLeftRailEdge = (share: number) => setLeftRailW(atLeastVisible(hostW * share))
  const moveRightRailEdge = (share: number) =>
    setRightRailW(atLeastVisible(hostW * (1 - share)))

  /*
   * The workspace and the console row are the same track list in the mockup,
   * and they are the same two numbers here: `leftRailWFit` and
   * `rightRailWFit`, fitted once above. The workspace puts a `Splitter`
   * between its columns so the rails can be dragged; the console row does
   * not, because dragging it would be a second, independent way to set one
   * width. Two renderings, one source - the alternative is two track lists
   * that agree today and disagree the first time somebody drags anything.
   *
   * Note what is deliberately *not* copied from the mockup: its middle
   * column is `minmax(620px, 1fr)`, and a hard 620px floor here would push
   * the total past a narrow window and put the right rail off the edge -
   * the clipping bug again, wearing a track list. `fitColumns` guarantees
   * the board its share and `frameFits` has already decided whether both
   * rails can be afforded, so the floor lives in the arithmetic rather than
   * being asserted twice in two places that can drift.
   */
  const railStyle = (px: number) => ({ width: Math.round(px) })

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
      {/* The demo banner is not here. It is in `WindowShell`, above the view
          switch, so that the popped-out panel windows carry it too - see
          WindowShell.tsx and issue #400. */}
      {/* Runs regardless of what is on screen - see GameSignals.tsx's own
          header on why this cannot live inside a panel that might not
          mount. */}
      {setupComplete && <GameSignals />}

      {setupComplete && character && (
        <div className="shrink-0" style={{ height: TOPBAR_H }}>
          <TopBar />
        </div>
      )}

      {setupComplete && fit.squeezed && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-2 py-1 text-xs text-ink-faint">
          <span>
            Not enough width for the stored column sizes — the side rails are
            being scaled down to keep the board usable.
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

      {/*
        The workspace row: the mockup's `228px | minmax(620px,1fr) | 250px`.
        Character side, board slot, context side.
      */}
      <main ref={hostRef} className="flex min-h-0 flex-1 overflow-hidden">
        {!setupComplete ? (
          <div className="flex-1 overflow-y-auto">
            <LazySurface label="Setup">
              <SetupWizard />
            </LazySurface>
          </div>
        ) : !character ? (
          /* Nothing else here has anything real to show without a
           * character either - map, board and context are all readings of a
           * live character, not independent tools. */
          <WaitingForCharacter />
        ) : (
          <>
            {showLeftRail && (
              <div
                className="flex min-w-0 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border p-1"
                style={railStyle(leftRailWFit)}
                aria-label="Character side"
              >
                <PanelBoundary label="Vitals">
                  <StatsPanel dense />
                </PanelBoundary>
                <PanelBoundary label="Risk">
                  <RiskBar />
                </PanelBoundary>
              </div>
            )}

            {showLeftRail && (
              <Splitter
                label="Resize the character side and the board"
                value={hostW > 0 ? leftRailWFit / hostW : 0.17}
                onChange={moveLeftRailEdge}
                min={0}
                max={1}
              />
            )}

            {/*
              The board slot. D0 chose a separate Godot window for 1.0, so
              until that window is up this holds the battle picture and
              nothing else. The zone map used to sit above it behind a
              draggable divider; the map is gone (`docs/NO-3D.md`) and Godot
              will own world and route presentation, so the slot is one
              surface again rather than a split with one half missing.
            */}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden" aria-label="Board">
              <div className="min-h-0 flex-1 overflow-hidden">
                <PanelBoundary label="Battle">
                  <BattleColumn />
                </PanelBoundary>
              </div>
            </div>

            {showRightRail && (
              <Splitter
                label="Resize the board and the context side"
                value={hostW > 0 ? 1 - rightRailWFit / hostW : 0.85}
                onChange={moveRightRailEdge}
                min={0}
                max={1}
              />
            )}

            {/*
              The context side: what you consult rather than what you watch.
              `AiWorkerPanel` lives here now, not in Settings. It reports what
              the background worker is doing, and a status display that only
              exists while a settings sheet is open reports it to nobody -
              see its own header. It *moved*: Settings no longer mounts it,
              because one component with two mounts is two panels pretending
              to be one, and they drift.
            */}
            {showRightRail && (
              <div
                className="flex min-w-0 shrink-0 flex-col gap-1 overflow-y-auto border-l border-border p-1"
                style={railStyle(rightRailWFit)}
                aria-label="Context side"
              >
                <PanelBoundary label="Actions">
                  <ActionsPanel dense />
                </PanelBoundary>
                <PanelBoundary label="Local AI worker">
                  <AiWorkerPanel />
                </PanelBoundary>
              </div>
            )}
          </>
        )}
      </main>

      {/*
        The console row: the mockup's third `.app` row, `224px` tall and
        spanning the width, tracked `228px | 1fr | 250px` to line up with the
        workspace above it. Context actions, the transcript, the recent-state
        strip.

        The transcript is here rather than in the board slot, and that is a
        decision worth naming because D0(a) can be read as putting it in the
        slot: it lives in exactly one place, and the mockup's own console row
        is built around it (`.transcript` is `30px | 1fr | 38px`, a heading, a
        scroll, and a command line). Two mounts of the transcript would be a
        fork whichever slot won.
      */}
      {setupComplete && character && (
        <div
          className="flex shrink-0 overflow-hidden border-t border-border bg-surface-raised"
          style={{ height: CONSOLE_H }}
          aria-label="Console"
        >
          {showLeftRail && (
            <div
              className="min-w-0 shrink-0 overflow-hidden border-r border-border"
              style={railStyle(leftRailWFit + SPLIT_W)}
            >
              <PanelBoundary label="Functions and scripts">
                <TaskFlowPanel title="Functions & scripts" dense />
              </PanelBoundary>
            </div>
          )}

          <div className="min-w-0 flex-1 overflow-hidden">
            <PanelBoundary label="Game and chat">
              <GameChatColumn />
            </PanelBoundary>
          </div>

          {/* No PanelBoundary chrome around the strip - see
              ExperienceStrip.tsx: "we don't need borders and padding." A
              crash inside it is still worth catching, so the boundary stays,
              just without Box's frame around it. */}
          {showRightRail && (
            <div
              className="min-w-0 shrink-0 overflow-hidden border-l border-border"
              style={railStyle(rightRailWFit + SPLIT_W)}
            >
              <PanelBoundary label="Experience">
                <ExperienceStrip skills={character?.skills ?? []} />
              </PanelBoundary>
            </div>
          )}
        </div>
      )}

      {setupComplete && <GameActionNotice />}
      {setupComplete && <Console />}
      {setupComplete && <QuickSwitchBar />}
      {setupComplete && <SafetyFooter />}
      {setupComplete && <CommandPalette />}
    </div>
  )
}
