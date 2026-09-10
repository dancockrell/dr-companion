import { lazy, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { WaitingForCharacter } from './components/shared/WaitingForCharacter.tsx'
import { ExperienceStrip } from './components/shared/ExperienceStrip.tsx'
import { GameSignals } from './components/shared/GameSignals.tsx'
import { GameActionNotice } from './components/game/GameActionNotice.tsx'
import { BattleColumn } from './components/room/BattleColumn.tsx'
import { GameChatColumn } from './components/room/GameChatColumn.tsx'
import { Splitter } from './components/layout/Splitter.tsx'
import { TopBar } from './components/layout/TopBar.tsx'
import { StatsPanel } from './components/shared/StatsPanel.tsx'
import { RiskBar } from './components/shared/RiskBar.tsx'
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
import { onLichStarted } from './lib/lichStarted.ts'
import { useAiWorkerHost } from './lib/aiWorkerHost.ts'
import {
  combatBattleWant,
  fitColumns,
  pickReset,
  pixelsForSizeShare,
  sizeShareForPixels,
  storedSizeShare,
  ROOM_MIN,
  DASH_MIN,
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
import { IconBar } from './components/layout/IconBar.tsx'
import { panelTitle } from './components/dashboard/panels.tsx'
import { closePanelWindow, openPanelWindow } from './lib/panelWindows.ts'
import {
  readScenePaneState,
  writeScenePaneState,
  sizeBucket,
  railWant,
  DOCKED_RAIL_W,
  COMBAT_GROWTH,
  type ScenePaneState,
} from './lib/scenePane.ts'

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
 * One stored width, because there are two columns.
 *
 * Dan, 9 September 2026, after his first live session: "it's not best to put
 * the screen in the middle ... put it in the right corner and have a bottom
 * bar of icons for various functions and then on the left you have room for
 * your text heavy windows." So the workspace is the text on the left and one
 * rail on the right, with a single divider between them, and a single divider
 * has one number behind it.
 *
 * The three keys that stood here (`drc.left-rail-width.v1`,
 * `drc.board-slot-width.v1`, `drc.right-rail-width.v1`) described three
 * columns that no longer exist. They are not reinterpreted as this one: a
 * stored share of 0.13 meant "the character rail is 13% of the window", and
 * read as the new rail that is a 260px column where the pane needs 380. That
 * is the "old data under a new meaning" trap, so the key is new and every
 * install falls back to the default once.
 *
 * v2, 10 September 2026: same trap, one door down. `v1`'s fallback was
 * `SCENE_RAIL_W` (380px), converted to a share the first time an install ever
 * measured its window - so most installs are sitting on a share around 19%
 * to 28%, the exact smallness Dan corrected ("random and broken"). Bumping
 * the key re-measures against `DOCKED_RAIL_W` once, the same as a fresh
 * install, rather than quietly keeping the old proportion under a state
 * (`docked`) that is supposed to mean something bigger.
 */
const RAIL_KEY = 'drc.scene-rail-width.v2'

/*
 * `drc.map-height.v4` and `drc.map-height.v1` used to be read here: how the
 * board slot divided between the map above and the battle picture below.
 * Nothing divides it now, and there is no board slot at all; both keys are
 * unread rather than reinterpreted, and `stripRetiredKeys` in
 * `src/lib/layout.ts` deletes them.
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
    // One attempt, not a ladder. Nobody knows a Lich is there at this point -
    // before sign-in there is not one - so this is a probe for one already
    // running, and its failure is the quiet not-connected state. Dialling
    // eight times over two minutes at an empty port is what put a permanent
    // amber "Bridge reconnecting" over the sign-in screen (#532).
    connectBridge('probe')
  }, [connectBridge])

  /*
   * And the ladder, when a Lich actually exists.
   *
   * Sign-in or the launcher has just started one, and Lich binds its port a
   * few seconds later, so this connect is the one that genuinely needs
   * re-dials. Subscribed at the root for the same reason the connect above is:
   * a panel that may never mount is not where this can live.
   *
   * Main window only. Every window shares this module's channel, but the
   * bridge is per-window and an aux window reconnecting on somebody else's
   * sign-in would dial a port it is not the one waiting for.
   */
  useEffect(() => {
    if (v.kind !== 'app') return
    return onLichStarted((lich) => {
      useAppStore.getState().addLog(`Lich started (${lich.via}). Connecting to it.`)
      connectBridge('expect-lich')
    })
  }, [v.kind, connectBridge])

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
   * The rail is a share of the window, not a fixed pixel width - see
   * `readShare`/`writeShare` above for why. One preference now, because there
   * is one divider: the text region takes whatever the rail leaves, which is
   * exactly `fitColumns`' "room" slot and exactly what `ROOM_MIN` was written
   * to protect ("it holds the game text, the command input and the channel
   * tabs, the parts that make this a client rather than a dashboard").
   *
   * `window.innerWidth` stands in for `hostW` only until the real measurement
   * below lands on the next layout pass.
   */
  const [railShare, setRailShare] = useState<number>(() =>
    readShare(RAIL_KEY, window.innerWidth, DOCKED_RAIL_W)
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
  const railW = pixelsForSizeShare(railShare, widthReference, MIN_PX)

  const setRailW = (px: number) => {
    const share = sizeShareForPixels(Math.max(MIN_PX, Math.round(px)), widthReference)
    setRailShare(share)
    writeShare(RAIL_KEY, share)
  }

  /*
   * The scene pane's three states, remembered per size of window.
   *
   * See `scenePane.ts` for why one stored answer for every size is one answer
   * that is wrong somewhere.
   */
  const paneW = Math.round(hostW || window.innerWidth)
  const paneH = Math.round(hostH || window.innerHeight)
  const [scene, setSceneState] = useState<ScenePaneState>(() =>
    readScenePaneState(window.innerWidth, window.innerHeight)
  )
  // The bucket, not the pixels: re-reading on every pixel of a drag would
  // fight the player's own choice mid-resize. This fires only when the window
  // crosses into a different class of size, which is exactly when a different
  // stored answer applies.
  const bucket = sizeBucket(paneW, paneH)
  const lastBucket = useRef(bucket)
  useEffect(() => {
    if (lastBucket.current === bucket) return
    lastBucket.current = bucket
    setSceneState(readScenePaneState(paneW, paneH))
  }, [bucket, paneW, paneH])

  const changeScene = (next: ScenePaneState) => {
    setSceneState(next)
    writeScenePaneState(paneW, paneH, next)
    // `popped` is the panel-window machinery, not a second implementation of
    // pop-out. Closing on the way out matters as much as opening on the way
    // in: a window left open while the pane says `hidden` is two answers to
    // "where is the scene".
    if (next === 'popped') void openPanelWindow('board', panelTitle('board'))
    else void closePanelWindow('board')
  }

  const character = useAppStore((s) => s.character)
  const battleActive = character?.situation.includes('in_combat') ?? false

  /*
   * What the rail asks for.
   *
   * `railWant` applies the display-time ceiling for the states that do not
   * put the pane on screen at full size - the stored width is never
   * rewritten, so bringing the pane back restores the width the player
   * dragged.
   *
   * `combatBattleWant` then grows it during a fight, for the reason it was
   * written: a dedicated battlespace that stays at its out-of-combat width
   * while eighteen actors are live defeats the point. Capped at `COMBAT_GROWTH`
   * of what the pane already asked for rather than at that function's own 49%
   * of the window - see the constant for the measurement that made the cap
   * necessary.
   *
   * `minimap` only, not `docked`. `docked` is already sized to be the primary
   * panel - that is the whole point of it existing - so stacking a further
   * 30% onto it pushes toward the "wrong way round for a MUD" arrangement
   * `TEXT_WIDTH_FLOOR` exists to catch, measured directly: applying growth to
   * both states put the text under 55% at every size from 1180px up.
   * `minimap`'s growth is unchanged from Lane O - the small preview still
   * gets bigger in a fight, for the reason this was written in the first
   * place.
   */
  const railAsked = railWant(scene, railW)
  const railWantVisible =
    scene === 'minimap'
      ? Math.min(combatBattleWant(railAsked, hostW, battleActive), Math.round(railAsked * COMBAT_GROWTH))
      : railAsked

  /*
   * Is there room for a rail at all?
   *
   * Derived from the two floors that actually decide it rather than from
   * `frameFits`, whose answer is about a three-column frame with a 620px board
   * in the middle - a frame this app no longer draws. Asking it here would
   * collapse the rail on a 1000px window that comfortably fits 380px of text
   * and a 120px rail.
   *
   * Below this the rail is not drawn at all rather than drawn too small: a
   * column of vitals under its own floor hides controls behind a hover-only
   * scrollbar, and the icon bar can open every one of them in a window
   * instead.
   */
  const showRail = (hostW || window.innerWidth) >= ROOM_MIN + DASH_MIN + SPLIT_W

  /*
   * Two columns through the same arithmetic, using its two-column mode.
   *
   * `mapDocked: false` is not a workaround - it is the case `columns.ts`
   * documents as "the map is not on screen to be blamed for anything": one
   * divider, two columns, which is what this frame is. The mapping:
   *
   *   room  -> the text region on the left. It is `room` because `room` is the
   *            slot that absorbs width nobody claimed, and because `ROOM_MIN`
   *            is already the floor written for exactly this content.
   *   dash  -> the right rail: the scene pane in the corner, then the vitals.
   *   map   -> nothing. There is no third column.
   *
   * Only the rail is given an explicit width; the text region is `flex-1` and
   * takes what is left, which is the same number by construction and cannot
   * round a pixel past the row.
   */
  const fit = fitColumns({
    hostW,
    roomWant: 0,
    mapWant: 0,
    dashWant: railWantVisible,
    mapDocked: false,
    splitW: SPLIT_W,
    // The rail holds vitals and risk whatever the pane is doing, so it is
    // never "empty" in the sense `dashEmpty` means.
    dashEmpty: false,
    // Cap its growth at what it asked for, so every spare pixel of a wide
    // window reaches the text rather than widening a column of vitals.
    dashGrowthMax: railWantVisible,
  })
  const railWFit = fit.dash

  const resetWidths = () => {
    const plan = pickReset({
      hostW,
      mapDocked: false,
      roomWant: ROOM_MIN,
      mapWant: 0,
      dashWant: railW,
      splitW: SPLIT_W,
    })
    // `pickReset`'s two-column branch answers about `dash` and nothing else,
    // which is the only column with a stored width here. Its default is the
    // rail's own, not `DEFAULT_DASH_W`: that constant is 250, the width of a
    // context column that no longer exists.
    if (plan.dash !== null) setRailW(DOCKED_RAIL_W)
  }

  /** Small enough to keep a column grabbable, and no opinion beyond that. */
  const atLeastVisible = (px: number) => Math.max(MIN_PX, px)

  /**
   * One divider, measured from the right edge - the same "distance from an
   * edge" shape the two dividers had, with the one that is gone removed
   * rather than left pointing at a column that is not there.
   */
  const moveRailEdge = (share: number) => setRailW(atLeastVisible(hostW * (1 - share)))

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
            Not enough width for the stored rail size - it is being scaled down
            to keep the game text readable.
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
        The workspace: the text on the left, the rail on the right.

        The transcript used to be a 224px strip along the bottom - 17.9% of the
        window at Dan's own size - while the room picture in the middle held
        38.8% (`docs/verification/layout-2026-09-09.md`). That is the wrong way
        round for a MUD, and it is what "its really hard to run" was about.
      */}
      <main ref={hostRef} className="flex min-h-0 flex-1 overflow-hidden">
        {!setupComplete ? (
          <div className="flex-1 overflow-y-auto">
            <LazySurface label="Setup">
              <SetupWizard />
            </LazySurface>
          </div>
        ) : (
          <>
            {/*
              The text. The scrollback, the channel tabs and the command line,
              in the width a wall of game text needs - see GameChatColumn.

              **Not gated on `character`**, and that is #523's fix carried into
              this frame rather than quietly undone by it. `GameChatColumn`
              owns `GameConnectionBar`, which is the app's only Attach control -
              the control that *creates* the connection everything else here is
              a reading of. Gating it on `character` puts it inside the state it
              exists to establish, and that was measured on the clean VM on 9
              September 2026: two established connections to the game port, real
              text on the socket, and the app showing "Nothing is connected yet"
              with no way back.

              The old frame kept the transcript safe by putting it in a console
              row outside `main`. This frame has no console row - the transcript
              *is* the workspace - so the gate has to move rather than be
              inherited, and it moves to the rail, which is genuinely a reading
              of a live character.
            */}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden" aria-label="Text">
              {!character && (
                /* The call to action, above the transcript rather than instead
                 * of it. It says what to do next; the bar below it is what does
                 * it. Capped and scrollable so a short window cannot push the
                 * command line off the screen - issue #418's rule, applied to
                 * the one screen that now shows both at once. */
                <div className="max-h-[45%] min-h-0 shrink-0 overflow-y-auto border-b border-border">
                  <WaitingForCharacter />
                </div>
              )}
              <div className="min-h-0 flex-1">
                <PanelBoundary label="Game and chat">
                  <GameChatColumn />
                </PanelBoundary>
              </div>
            </div>

            {showRail && character && (
              <Splitter
                label="Resize the game text and the right rail"
                value={hostW > 0 ? 1 - railWFit / hostW : 0.8}
                onChange={moveRailEdge}
                min={0}
                max={1}
              />
            )}

            {/*
              The right rail. The scene pane is the first thing in it, so it
              sits in the top right corner of the workspace - which is where
              Dan asked for it - and the things you watch continuously sit
              underneath.

              Dan, 10 September 2026, correcting Lane O's small default: "you
              are going to get a godot screen with basically a modern ui." The
              pane is mounted at full size in `docked` (the default) and at a
              player-chosen smaller size in `minimap` - both draw the same
              component, sized by `railWFit` alone, so "primary panel" and
              "small preview" are one component at two widths rather than two
              implementations. In `popped` it is in a window of its own and
              this says so rather than drawing a second copy; in `hidden` it
              is not drawn at all and the ceiling in `railWant` gives the
              width back to the text.
            */}
            {showRail && character && (
              <div
                className="flex min-w-0 shrink-0 flex-col gap-1 overflow-hidden border-l border-border p-1"
                style={railStyle(railWFit)}
                aria-label="Context side"
              >
                {(scene === 'docked' || scene === 'minimap') && (
                  <div
                    className="flex min-h-0 flex-[3] flex-col overflow-hidden rounded border border-border"
                    aria-label="Scene pane"
                  >
                    <PanelBoundary label="Scene">
                      <BattleColumn />
                    </PanelBoundary>
                  </div>
                )}
                {scene === 'popped' && (
                  <p className="shrink-0 rounded border border-border bg-surface-raised p-2 text-xs text-ink-muted">
                    The scene is open in its own window. Press the scene button
                    on the bottom bar to bring it back into this corner.
                  </p>
                )}
                <div className="flex min-h-0 flex-[2] flex-col gap-1 overflow-y-auto">
                  <PanelBoundary label="Vitals">
                    <StatsPanel dense />
                  </PanelBoundary>
                  <PanelBoundary label="Risk">
                    <RiskBar />
                  </PanelBoundary>
                  {/* Experience, all the way to the right, which is where Dan
                      put it and where it stays. It is the rail's own filler:
                      whatever height the pane and the vitals leave is a longer
                      strip of skills, which is the one panel here that is
                      genuinely better for being taller. */}
                  <div className="min-h-24 flex-1">
                    <PanelBoundary label="Experience">
                      <ExperienceStrip skills={character?.skills ?? []} />
                    </PanelBoundary>
                  </div>
                  {/* Not moved to the icon bar: a background worker whose
                      status only exists while something is open reports it to
                      nobody, which is the exact reason it left Settings. */}
                  <PanelBoundary label="Local AI worker">
                    <AiWorkerPanel />
                  </PanelBoundary>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/*
        The bottom bar of icons. Everything that used to hold a fixed slice of
        the window and no longer does is reachable from here - moved, not
        deleted. See IconBar.tsx and panelBar.ts, which names the two panels
        deliberately left off it and why.
      */}
      {setupComplete && character && <IconBar scene={scene} onSceneChange={changeScene} />}

      {setupComplete && <GameActionNotice />}
      {setupComplete && <Console />}
      {setupComplete && <QuickSwitchBar />}
      {setupComplete && <SafetyFooter />}
      {setupComplete && <CommandPalette />}
    </div>
  )
}
