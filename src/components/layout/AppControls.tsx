import { useState } from 'react'
import { Pin, PinOff, Circle, Settings, Map as MapIcon } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { setAlwaysOnTop, isTauri } from '../../lib/tauri'
import { useMapDock, setMapDock } from '../../lib/mapDock'
import { SettingsSheet } from './SettingsSheet'
import { cn } from '../../lib/cn'

/**
 * Three controls and a connection light, floating over the top right corner.
 *
 * This replaces a full-width bar that carried the app's own name, the
 * character's name, their instance, their location and their activity. Every
 * one of those was already somewhere better: the name titles the character
 * box, the location is what the map is drawing, and the activity belongs with
 * the actions that change it. The bar was left restating them across the top
 * of the window.
 *
 * The connection light stays because it has nowhere better to be and because
 * it answers a question nothing else does — whether what you are reading is
 * live or a mock. It is deliberately the only status here.
 */
export function AppControls() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const alwaysOnTop = useAppStore((s) => s.alwaysOnTop)
  const setAlwaysOnTopState = useAppStore((s) => s.setAlwaysOnTop)
  const bridgeConnected = useAppStore((s) => s.bridgeConnected)
  const bridgeMode = useAppStore((s) => s.bridgeMode)
  const character = useAppStore((s) => s.character)
  const setupComplete = useAppStore((s) => s.setupComplete)
  const uiMode = useAppStore((s) => s.uiMode)
  const setUiMode = useAppStore((s) => s.setUiMode)
  const mapDock = useMapDock()

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
  const mapLabel = mapDock.docked ? 'Hide the map column' : 'Show the map column'
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

        {setupComplete && (
          <span className="pointer-events-auto flex overflow-hidden rounded border border-border">
            {(['basic', 'power'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={cn(
                  'px-1.5 py-0.5 text-xs capitalize',
                  uiMode === m ? 'bg-accent/15 text-accent' : 'text-ink-faint hover:text-ink'
                )}
                onClick={() => setUiMode(m)}
              >
                {m}
              </button>
            ))}
          </span>
        )}

        {/* The map's way home.
         *
         * Popping the map into its own window hides its column, and the only
         * control offering it back used to live inside the panel that had just
         * gone. That is a one-way door dressed up as a toggle. Here it is
         * always on screen, and it is the same setting either way: the column
         * comes back at the width it was, because the width is remembered
         * separately from whether it is showing. */}
        <button
          type="button"
          title={mapLabel}
          aria-label={mapLabel}
          className={cn(
            'pointer-events-auto rounded p-1 text-ink-faint hover:text-ink',
            mapDock.docked && 'text-accent'
          )}
          onClick={() => setMapDock({ docked: !mapDock.docked })}
        >
          <MapIcon className="h-3.5 w-3.5" />
        </button>

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

        <button
          type="button"
          title="Settings" aria-label="Settings"
          className="pointer-events-auto rounded p-1 text-ink-faint hover:text-ink"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings className="h-3.5 w-3.5" />
        </button>
      </div>

      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
    </>
  )
}
