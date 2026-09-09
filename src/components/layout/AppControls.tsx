import { lazy, useEffect, useState } from 'react'
import { Pin, PinOff, Circle, Settings, SlidersHorizontal } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore.ts'
import { setAlwaysOnTop, isTauri } from '../../lib/tauri.ts'
import { cn } from '../../lib/cn.ts'
import { LazySurface } from '../shared/LazySurface.tsx'
import { openPanelWindow } from '../../lib/panelWindows.ts'
import { startLaunchUpdateCheck } from '../../lib/updaterWiring.ts'

const SettingsSheet = lazy(() => import('./SettingsSheet.tsx').then((module) => ({ default: module.SettingsSheet })))

/**
 * Three controls and a connection light, floating over the top right corner.
 *
 * This replaces a full-width bar that carried the app's own name, the
 * character's name, their instance, their location and their activity. Every
 * one of those was already somewhere better: the name titles the character
 * box, the location is on the top bar, and the activity belongs with
 * the actions that change it. The bar was left restating them across the top
 * of the window.
 *
 * The connection light stays because it has nowhere better to be and because
 * it answers a question nothing else does — whether what you are reading is
 * live or a mock. It is deliberately the only status here.
 */
/**
 * Asks the main window to open the Settings sheet. Dispatched by
 * `UpdateBanner`; the listener is in `AppControls`, which owns the sheet.
 */
export const OPEN_SETTINGS_EVENT = 'drc:open-settings'

export function AppControls() {
  const [settingsOpen, setSettingsOpen] = useState(false)

  // The update banner lives in `WindowShell`, above this component and in a
  // different subtree, and its "See what changed" has to land in the Updates
  // section of this sheet. A window event rather than lifting `settingsOpen`
  // into the store: the sheet is main-window-only local UI state, and hoisting
  // it into shared state so one banner can open it would make every pop-out
  // window carry a field about a sheet it cannot render.
  useEffect(() => {
    // The check on launch. Guarded inside `startLaunchUpdateCheck` so a
    // remount does not re-ask, and mounted here because this component is
    // main-window-only: a pop-out panel should not open its own connection to
    // GitHub to answer a question the main window has already answered.
    startLaunchUpdateCheck()

    const open = () => setSettingsOpen(true)
    window.addEventListener(OPEN_SETTINGS_EVENT, open)
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, open)
  }, [])
  const alwaysOnTop = useAppStore((s) => s.alwaysOnTop)
  const setAlwaysOnTopState = useAppStore((s) => s.setAlwaysOnTop)
  const bridgeConnected = useAppStore((s) => s.bridgeConnected)
  const bridgeMode = useAppStore((s) => s.bridgeMode)
  const character = useAppStore((s) => s.character)
  const setupComplete = useAppStore((s) => s.setupComplete)

  const live = setupComplete && bridgeConnected && character?.connected === true

  /*
   * Named once and read twice, as `title` and as `aria-label`.
   *
   * These two are icon-only, so a `title` was their entire name - and a title
   * is the last fallback in the accessible-name order as well as being a
   * hover, which is no answer to a question asked by glancing. An
   * `aria-label` is the name itself.
   *
   * A const rather than the expression written out twice: the two would agree
   * today and drift the first time somebody rewords a toggle, and a label
   * that disagrees with its own tooltip is worse than either alone.
   */
  const configLabel = 'Player config: highlights, aliases, macros'
  const pinLabel =
    (alwaysOnTop ? 'Unpin' : 'Always on top') +
    (isTauri() ? '' : ' (works fully in the desktop app)')

  return (
    <>
      <div className="pointer-events-none absolute right-1 top-1 z-40 flex items-center gap-1">
        {setupComplete && (
          <span
            className="pointer-events-auto flex items-center gap-1 rounded px-1 text-xs text-ink-faint"
            title={
              live
                ? bridgeMode === 'mock'
                  ? 'Simulated character, not the game'
                  : 'Live game'
                : bridgeMode === 'live'
                  ? 'Connecting to Lich'
                  : 'Not connected'
            }
          >
            <Circle
              className={cn(
                'h-2 w-2 fill-current',
                live ? 'text-good' : bridgeMode === 'live' ? 'text-warn' : 'text-ink-faint'
              )}
            />
            {live ? (bridgeMode === 'mock' ? 'Mock' : 'Live') : bridgeMode === 'live' ? '…' : 'Idle'}
          </span>
        )}

        <button
          type="button"
          title={pinLabel}
          aria-label={pinLabel}
          className={cn(
            'pointer-events-auto rounded p-1 text-ink-faint hover:text-ink',
            alwaysOnTop && 'text-accent'
          )}
          onClick={async () => {
            const next = !alwaysOnTop
            setAlwaysOnTopState(next)
            await setAlwaysOnTop(next)
          }}
        >
          {alwaysOnTop ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
        </button>

        {/* The Genie config button stood here until N6, which deleted it
          * because it opened an editor that wrote back into another program's
          * config files. This is not that button: it opens the app's own rules
          * (`playerConfig.ts`), which are stored here and nowhere else. Lane Q,
          * Q1. */}
        <button
          type="button"
          title={configLabel}
          aria-label={configLabel}
          className="pointer-events-auto rounded p-1 text-ink-faint hover:text-ink"
          onClick={() => void openPanelWindow("config", "Player config")}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          title="Settings" aria-label="Settings"
          className="pointer-events-auto rounded p-1 text-ink-faint hover:text-ink"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings className="h-3.5 w-3.5" />
        </button>
      </div>

      {settingsOpen && <LazySurface label="Settings"><SettingsSheet onClose={() => setSettingsOpen(false)} /></LazySurface>}
    </>
  )
}
