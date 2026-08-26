import { useState } from 'react'
import { Pin, PinOff, Circle, Settings } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { setAlwaysOnTop } from '../../lib/tauri'
import { SettingsSheet } from './SettingsSheet'
import { CharacterStrip } from '../dashboard/CharacterHeader'

export function AppHeader() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const alwaysOnTop = useAppStore((s) => s.alwaysOnTop)
  const setAlwaysOnTopState = useAppStore((s) => s.setAlwaysOnTop)
  const bridgeConnected = useAppStore((s) => s.bridgeConnected)
  const bridgeMode = useAppStore((s) => s.bridgeMode)
  const character = useAppStore((s) => s.character)
  const setupComplete = useAppStore((s) => s.setupComplete)

  const live =
    setupComplete && bridgeConnected && character?.connected === true

  return (
    <>
      <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface-raised/80 px-3 py-1 select-none">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold tracking-wide text-ink-muted shrink-0">
            DR Companion
          </span>
          {setupComplete && (
            <span className="flex items-center gap-1 text-xs text-ink-faint truncate">
              <Circle
                className={`w-2 h-2 fill-current ${
                  live
                    ? 'text-good'
                    : bridgeMode === 'live'
                      ? 'text-warn'
                      : 'text-ink-faint'
                }`}
              />
              {live
                ? bridgeMode === 'mock'
                  ? 'Mock'
                  : 'Live'
                : bridgeMode === 'live'
                  ? 'Connecting…'
                  : 'Idle'}
            </span>
          )}
        </div>

        {/* Who and where, on the same bar as the connection light. Two bars
            for this was about 200px of height carrying a dozen words. */}
        {setupComplete && character && <CharacterStrip character={character} />}

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            title={alwaysOnTop ? 'Unpin' : 'Always on top'}
            className={`p-1 rounded-md border border-transparent hover:border-border text-ink-faint hover:text-ink ${
              alwaysOnTop ? 'text-accent border-border/60 bg-accent/10' : ''
            }`}
            onClick={async () => {
              const next = !alwaysOnTop
              setAlwaysOnTopState(next)
              await setAlwaysOnTop(next)
            }}
          >
            {alwaysOnTop ? (
              <Pin className="w-3.5 h-3.5" />
            ) : (
              <PinOff className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            type="button"
            title="Settings"
            className="p-1 rounded-md border border-transparent hover:border-border text-ink-faint hover:text-ink"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
    </>
  )
}
