/**
 * Lightweight settings sheet — mode, bridge, pin, about.
 * Opened from AppHeader gear.
 */
import { useState } from 'react'
import { X } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { setAlwaysOnTop, isTauri } from '../../lib/tauri'
import { TRAIN_FOCUS_OPTIONS } from '../../data/training'
import { HEAL_CITIES } from '../../data/healers'
import { ProfilesPanel } from './ProfilesPanel'
import { EXPECTED_BRIDGE_VERSION } from '../../lib/versions'
import { TYPE_SCALES, setTypeScale, initTypeScale } from '../../lib/typeScale'

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  // Read from the same place that applied it at startup, so the highlighted
  // button always matches what is actually rendering.
  const [scale, setScale] = useState(() => initTypeScale())
  const uiMode = useAppStore((s) => s.uiMode)
  const setUiMode = useAppStore((s) => s.setUiMode)
  const alwaysOnTop = useAppStore((s) => s.alwaysOnTop)
  const setAlwaysOnTopState = useAppStore((s) => s.setAlwaysOnTop)
  const bridgeMode = useAppStore((s) => s.bridgeMode)
  const setBridgeMode = useAppStore((s) => s.setBridgeMode)
  const connectBridge = useAppStore((s) => s.connectBridge)
  const clearLog = useAppStore((s) => s.clearLog)
  const openSetup = useAppStore((s) => s.openSetup)
  const trainFocus = useAppStore((s) => s.trainFocus)
  const toggleTrainFocus = useAppStore((s) => s.toggleTrainFocus)
  const autoSuggestHealer = useAppStore((s) => s.autoSuggestHealer)
  const setAutoSuggestHealer = useAppStore((s) => s.setAutoSuggestHealer)
  const houseEntryMethod = useAppStore((s) => s.houseEntryMethod)
  const setHouseEntryMethod = useAppStore((s) => s.setHouseEntryMethod)
  const houseEntryMaxSearches = useAppStore((s) => s.houseEntryMaxSearches)
  const setHouseEntryMaxSearches = useAppStore((s) => s.setHouseEntryMaxSearches)
  const houseEntryHide = useAppStore((s) => s.houseEntryHide)
  const setHouseEntryHide = useAppStore((s) => s.setHouseEntryHide)
  const character = useAppStore((s) => s.character)
  const preferredHealCity = useAppStore((s) => s.preferredHealCity)
  const setPreferredHealCity = useAppStore((s) => s.setPreferredHealCity)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-3">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface shadow-2xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-ink">Settings</h2>
          <button
            type="button"
            className="p-1 rounded-md text-ink-faint hover:text-ink"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-5 text-sm">
          <section className="space-y-2">
            <h3 className="text-xs font-medium text-ink-faint uppercase tracking-wider">
              Interface mode
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {(['basic', 'power'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`rounded-lg border px-2 py-2 capitalize ${
                    uiMode === m
                      ? 'border-accent text-accent bg-accent/10'
                      : 'border-border text-ink-muted'
                  }`}
                  onClick={() => setUiMode(m)}
                >
                  {m}
                </button>
              ))}
            </div>
            <p className="text-xs text-ink-faint leading-snug">
              Power adds rankings and denser controls. Either way the panels
              move and resize.
            </p>
          </section>

          <ProfilesPanel />

          <section className="space-y-2">
            <h3 className="text-xs font-medium text-ink-faint uppercase tracking-wider">
              Bridge
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className={`rounded-lg border px-2 py-2 ${
                  bridgeMode === 'mock'
                    ? 'border-accent text-accent bg-accent/10'
                    : 'border-border text-ink-muted'
                }`}
                onClick={() => {
                  setBridgeMode('mock')
                  connectBridge()
                }}
              >
                Mock
              </button>
              <button
                type="button"
                className={`rounded-lg border px-2 py-2 ${
                  bridgeMode === 'live'
                    ? 'border-accent text-accent bg-accent/10'
                    : 'border-border text-ink-muted'
                }`}
                onClick={() => {
                  setBridgeMode('live')
                  connectBridge()
                }}
              >
                Live Lich
              </button>
            </div>
            <p className="text-xs text-ink-faint">
              Live uses ws://127.0.0.1:7415/companion
            </p>
          </section>

          {/* Applied to the root font size, so every rem-based size in the app
              scales together and the layout keeps its proportions. */}
          <section className="space-y-2">
            <h3 className="text-xs font-medium text-ink-faint uppercase tracking-wider">
              Text size
            </h3>
            <div className="grid grid-cols-4 gap-2">
              {TYPE_SCALES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  className={`rounded-lg border px-2 py-2 ${
                    Math.abs(scale - s.value) < 0.001
                      ? 'border-accent text-accent bg-accent/10'
                      : 'border-border text-ink-muted'
                  }`}
                  style={{ fontSize: `${0.75 * s.value}rem` }}
                  onClick={() => setScale(setTypeScale(s.value))}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-medium text-ink-faint uppercase tracking-wider">
              Window
            </h3>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
              <span className="text-ink-muted">Always on top</span>
              <input
                type="checkbox"
                checked={alwaysOnTop}
                onChange={async (e) => {
                  const v = e.target.checked
                  setAlwaysOnTopState(v)
                  await setAlwaysOnTop(v)
                }}
              />
            </label>
            {!isTauri() && (
              <p className="text-xs text-ink-faint">
                Pin works fully inside the Tauri desktop app.
              </p>
            )}
          </section>


          <section className="space-y-2">
            <h3 className="text-xs font-medium text-ink-faint uppercase tracking-wider">
              Training focus
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {TRAIN_FOCUS_OPTIONS.filter((o) => {
                if (!character) return true
                if (
                  (character.accountTier === 'f2p' ||
                    character.accountTier === 'unknown') &&
                  !o.zolurenOk
                )
                  return false
                return true
              }).map((o) => {
                const on = trainFocus.includes(o.id)
                return (
                  <button
                    key={o.id}
                    type="button"
                    className={`text-xs rounded-full border px-2.5 py-1 ${
                      on
                        ? 'border-accent text-accent bg-accent/10'
                        : 'border-border text-ink-muted'
                    }`}
                    onClick={() => toggleTrainFocus(o.id)}
                  >
                    {o.label}
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-ink-faint">
              Used when you press Start Training. F2P hides non-Zoluren options.
            </p>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
              <span className="text-ink-muted text-xs">Suggest healer when low</span>
              <input
                type="checkbox"
                checked={autoSuggestHealer}
                onChange={(e) => setAutoSuggestHealer(e.target.checked)}
              />
            </label>
          </section>


          <section className="space-y-2">
            <h3 className="text-xs font-medium text-ink-faint uppercase tracking-wider">
              Heal city
            </h3>
            <select
              className="w-full text-xs bg-surface-overlay border border-border rounded-lg px-2 py-1.5 text-ink"
              value={preferredHealCity ?? ''}
              onChange={(e) => setPreferredHealCity(e.target.value || null)}
            >
              <option value="">No preference — score the options</option>
              {HEAL_CITIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} ({c.province})
                </option>
              ))}
            </select>
            <p className="text-xs text-ink-faint leading-snug">
              Pick one and healing goes there regardless of where you are, which
              is what most players want once they know a route. Leave it unset
              and the Companion scores the options by instance, tier, path and
              cost, and shows its reasoning in Power mode.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-medium text-ink-faint uppercase tracking-wider">
              House entry
            </h3>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  ['lockpick_ring', 'Ring'],
                  ['lockpick', 'Pick'],
                  ['rope', 'Rope'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`text-xs rounded-lg border px-2 py-1.5 ${
                    houseEntryMethod === id
                      ? 'border-accent text-accent bg-accent/10'
                      : 'border-border text-ink-muted'
                  }`}
                  onClick={() => setHouseEntryMethod(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="flex items-center justify-between gap-3 text-xs text-ink-muted">
              <span>Max searches</span>
              <input
                type="number"
                min={1}
                max={8}
                value={houseEntryMaxSearches}
                className="w-14 rounded border border-border bg-surface px-1.5 py-1 text-ink"
                onChange={(e) =>
                  setHouseEntryMaxSearches(
                    Math.max(1, Math.min(8, Number(e.target.value) || 1))
                  )
                }
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
              <span className="text-ink-muted text-xs">Hide before searches</span>
              <input
                type="checkbox"
                checked={houseEntryHide}
                onChange={(e) => setHouseEntryHide(e.target.checked)}
              />
            </label>
            <p className="text-xs text-ink-faint leading-snug">
              Ring/Pick train locksmithing; Rope trains athletics. Abort on
              guards; leave on footsteps; respect cooldown.
            </p>
          </section>

          {/* The setup screen skips itself when nothing is missing, which
              means once a machine is working there was no way left to see
              what the app found or which folder it is using. */}
          {isTauri() && (
            <section className="space-y-2">
              <h3 className="text-xs font-medium text-ink-faint uppercase tracking-wider">
                Ruby, Lich and your frontend
              </h3>
              <button
                type="button"
                className="w-full rounded-lg border border-border px-3 py-2 text-ink-muted hover:text-ink"
                onClick={() => {
                  openSetup()
                  onClose()
                }}
              >
                Check what is installed
              </button>
              <p className="text-xs text-ink-faint leading-snug">
                Shows each piece and the folder it is in. Also where to go after
                updating Lich, or if the bridge script needs reinstalling.
              </p>
            </section>
          )}

          <section className="space-y-2">
            <h3 className="text-xs font-medium text-ink-faint uppercase tracking-wider">
              Debug
            </h3>
            <button
              type="button"
              className="w-full rounded-lg border border-border px-3 py-2 text-ink-muted hover:text-ink"
              onClick={() => clearLog()}
            >
              Clear activity log
            </button>
          </section>

          {/* Version numbers. Not a lecture: players know the rules of their
              own game, and being told them by a tool they installed is both
              patronising and useless. */}
          <section className="text-xs text-ink-faint space-y-1 pt-1 border-t border-border">
            <p>DR Companion 0.1.1</p>
            <p>Bridge script {EXPECTED_BRIDGE_VERSION}</p>
          </section>
        </div>
      </div>
    </div>
  )
}
