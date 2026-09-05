/**
 * Lightweight settings sheet — bridge, pin, about.
 * Opened from the gear in AppControls.
 */
import { useState } from 'react'
import { X } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore.ts'
import { setAlwaysOnTop, isTauri } from '../../lib/tauri.ts'
import { TRAIN_FOCUS_OPTIONS } from '../../data/training.ts'
import { HEAL_CITIES } from '../../data/healers.ts'
import { ProfilesPanel } from './ProfilesPanel.tsx'
import { SettingsFilesPanel } from '../shared/SettingsFilesPanel.tsx'
import { TogglesPanel } from '../shared/TogglesPanel.tsx'
import { VarsPanel } from '../shared/VarsPanel.tsx'
import { LinksPanel } from '../shared/LinksPanel.tsx'
import { ScriptApiPanel } from '../shared/ScriptApiPanel.tsx'
import { AiClaimsPanel } from '../shared/AiClaimsPanel.tsx'
import { PresentationBridgePanel } from '../shared/PresentationBridgePanel.tsx'
import { HuntingGroundsPanel } from '../shared/HuntingGroundsPanel.tsx'
import { EXPECTED_BRIDGE_VERSION } from '../../lib/versions.ts'
import { TYPE_SCALES, setTypeScale, initTypeScale } from '../../lib/typeScale.ts'
import { DEMO_PRESET_LIST } from '../../bridge/index.ts'
import { loadPrefs } from '../../lib/persistence.ts'
import { useModalDialog } from '../../lib/useModalDialog.ts'
import { LICH_LICENSE } from '../../data/lichLicense.ts'
import { DiagnosticsPanel } from '../shared/DiagnosticsPanel.tsx'

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  // Read from the same place that applied it at startup, so the highlighted
  // button always matches what is actually rendering.
  const [scale, setScale] = useState(() => initTypeScale())
  const alwaysOnTop = useAppStore((s) => s.alwaysOnTop)
  const setAlwaysOnTopState = useAppStore((s) => s.setAlwaysOnTop)
  const bridgeMode = useAppStore((s) => s.bridgeMode)
  const setBridgeMode = useAppStore((s) => s.setBridgeMode)
  const connectBridge = useAppStore((s) => s.connectBridge)
  const clearLog = useAppStore((s) => s.clearLog)
  const demoLowHealth = useAppStore((s) => s.demoLowHealth)
  const demoCombat = useAppStore((s) => s.demoCombat)
  const demoSafe = useAppStore((s) => s.demoSafe)
  const demoBrokenPattern = useAppStore((s) => s.demoBrokenPattern)
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
  const loadPreset = useAppStore((s) => s.loadPreset)

  // Which preset is showing. Local because the bridge is the thing that holds
  // it and does not report it back; the select would otherwise sit on its
  // default while the app showed somebody else.
  const [demoPreset, setDemoPreset] = useState(() => loadPrefs().demoPreset ?? 'basic_prime')

  // E9. Collapsed by default: the licence has to be present, not prominent.
  const [showLichLicence, setShowLichLicence] = useState(false)
  const dialogRef = useModalDialog(onClose)

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-scrim p-3"
      data-gameplay-shortcuts="suspend"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
        className="w-full max-w-md rounded-2xl border border-border bg-surface shadow-2xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 id="settings-title" className="text-sm font-semibold text-ink">Settings</h2>
          <button
            type="button"
            className="p-1 rounded-md text-ink-faint hover:text-ink"
            onClick={onClose}
            title="Close" aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-5 text-sm">
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

            {/* Which invented character Mock is pretending to be.
             *
             * This control already existed, in `PresetBar`, which nothing has
             * ever mounted. So for the whole life of the project there was no
             * way to reach any preset but the first, and five of the six had
             * been seen only by whoever wrote them.
             *
             * Not a cosmetic gap. The reachable demo character is a barbarian
             * with a sword, and every guild-shaped hole in this app stayed
             * invisible precisely because that was the only character anybody
             * ever looked at. A chooser nobody can reach is the same as no
             * chooser, and this one cost more than a missing feature would
             * have.
             *
             * It lives under Bridge because that is where Mock is turned on,
             * and it is only meaningful while Mock is the source. */}
            {bridgeMode === 'mock' && (
              <label className="block space-y-1 pt-1">
                <span className="text-xs text-ink-muted">Demo character</span>
                <select
                  className="w-full rounded-lg border border-border bg-surface-overlay px-2 py-1.5 text-xs text-ink"
                  value={demoPreset}
                  onChange={(e) => {
                    setDemoPreset(e.target.value)
                    loadPreset(e.target.value)
                  }}
                >
                  {DEMO_PRESET_LIST.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <span className="block text-xs leading-snug text-ink-faint">
                  They disagree with each other on purpose. Bard · Circle 1 is a
                  real character read off a live session, and it is the one that
                  shows what this app does badly.
                </span>
              </label>
            )}
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

          {/* start_training has read huntMode/selectedHuntId/huntFavorites off
              the store since the intent was written, and the mock bridge and
              rankHuntingGrounds both honor them fully. Nothing ever set them -
              see HuntingGroundsPanel.tsx for the full account. */}
          <section className="space-y-2">
            <h3 className="text-xs font-medium text-ink-faint uppercase tracking-wider">
              Hunting grounds
            </h3>
            <HuntingGroundsPanel />
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

          {/* The bridge has been able to answer this since 0.7.0 and no control
              ever asked it to, so the feature shipped complete and unreachable.
              It lives in Settings because a settings file is what it is about,
              and because it is read once when something is wrong rather than
              watched. */}
          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-ink-faint">
              dr-scripts settings files
            </h3>
            <SettingsFilesPanel />
          </section>

          {/* Same gap, same fix: check_toggles has read BRIEF, INVBRIEF and
              ShowRoomID since before this panel existed, and nothing surfaced
              it but the log pane. Lives next to the settings files panel
              because both are "read the game's own state once, on request"
              rather than something watched continuously. */}
          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-ink-faint">
              Display toggles
            </h3>
            <TogglesPanel />
          </section>

          {/* Third of the same shape: list_vars reads Lich::Common::Vars,
              which any script can set and only `;vars list` could show
              before this. */}
          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-ink-faint">
              Lich variables
            </h3>
            <VarsPanel />
          </section>

          {/* From Lich's own `links` script (links.lic) - twelve lines it
              printed to the console on request, and the console is not
              somewhere a player goes looking for a reference. See
              LinksPanel.tsx for which two entries were left out and why. */}
          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-ink-faint">
              Reference links
            </h3>
            <LinksPanel />
          </section>

          {/* Fourth of the same shape as the three panels above: script_api_info
              has been able to answer this since it was written - its own doc
              comment says "for a settings panel to show it" - and nothing
              called it until now. See ScriptApiPanel.tsx. */}
          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-ink-faint">
              Python scripting API
            </h3>
            <ScriptApiPanel />
          </section>

          {/* Fifth of the same shape: presentation_bridge_info has been able
              to answer this since PR #268 and nothing called it until now.
              See PresentationBridgePanel.tsx. */}
          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-ink-faint">
              Godot 3D viewer bridge
            </h3>
            <PresentationBridgePanel />
          </section>

          {/* The local AI worker's status panel used to be here. D4 moved it
              to the context rail (the workspace's right column in App.tsx),
              and it *moved* rather than gaining a second mount. Acceptance
              criterion 14 asks that model failure, absence, timeout and
              out-of-memory be visible, and a status display that only exists
              while a settings sheet is open is visible to nobody - which is
              the same reason `aiWorkerHost` was lifted out of this panel to
              App.tsx in the first place (see AiWorkerPanel.tsx's header).
              Mounting it in both places would be one component pretending to
              be two panels, and the two would drift. */}

          {/* E12. Its own section rather than a row inside Debug: the six
              questions here are the ones asked before anybody has decided
              there is a bug, and burying them under a heading called Debug is
              how a person answering "is Ruby installed?" never finds them. */}
          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-ink-faint">
              Diagnostics
            </h3>
            <DiagnosticsPanel />
          </section>

          {/* The review queue for what the background worker believes.
              Its own section, appended rather than inserted, so nothing
              above it moves. Deliberately not beside the worker's status
              panel in the context rail: a status line is glanced at, and
              accepting a claim is a decision, which belongs where a person
              has gone looking for settings rather than where their eye
              lands mid-fight. */}
          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-ink-faint">
              AI candidate claims
            </h3>
            <AiClaimsPanel />
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-medium text-ink-faint uppercase tracking-wider">
              Debug
            </h3>
            <p className="text-xs text-ink-faint">
              The activity log a bug report attaches. Clearing it only affects what a
              future report can show — nothing about the running app changes.
            </p>
            <button
              type="button"
              className="w-full rounded-lg border border-border px-3 py-2 text-ink-muted hover:text-ink"
              onClick={() => {
                if (confirm('Clear the activity log? This cannot be undone.')) clearLog()
              }}
            >
              Clear activity log
            </button>

            {/* Mock-only: index.ts's bridge facade already no-ops these
                against a live connection (there's nothing to "simulate" once
                a real character exists), so this only needs to hide, not
                disable. simulateBrokenPattern's own comment says it "needs
                to be reachable in demo mode so the report flow can be
                exercised before anyone is in game" - it wasn't reachable
                anywhere. Same for the other three: simulateCombat's comment
                cites the StatusBoard chips it exists to exercise. */}
            {bridgeMode === 'mock' && (
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  className="rounded-lg border border-border px-2 py-1.5 text-xs text-ink-muted hover:text-ink"
                  onClick={() => demoLowHealth()}
                >
                  Demo: low health
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-border px-2 py-1.5 text-xs text-ink-muted hover:text-ink"
                  onClick={() => demoCombat()}
                >
                  Demo: combat
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-border px-2 py-1.5 text-xs text-ink-muted hover:text-ink"
                  onClick={() => demoSafe()}
                >
                  Demo: safe
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-border px-2 py-1.5 text-xs text-ink-muted hover:text-ink"
                  onClick={() => demoBrokenPattern()}
                >
                  Demo: broken pattern
                </button>
              </div>
            )}
          </section>

          {/* E9. The wizard's ComponentCard already tells a player that
              Ruby4Lich5 is somebody else's BSD-3-Clause software, at the
              moment they choose to install it. That is a disclosure, not the
              licence: condition 2 asks that the notice, the conditions and the
              disclaimer be reproduced with the distribution, and the wizard is
              a screen a returning player never sees again. This is where the
              text itself lives - collapsed, because nobody reads it, and
              present, because they have to be able to.

              The text is not typed here. `src/data/lichLicense.ts` is the one
              copy in this repository, and `tools/build-third-party.mjs`
              renders THIRD_PARTY.md's Lich section from that same module and
              re-reads a real Lich install to check it, so the two cannot
              drift into disagreeing. */}
          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-ink-faint">
              Licences and privacy
            </h3>
            {/* F5. The claim a player most wants, and is least able to check
                for themselves, is "what does this send?". Stating it here
                without somewhere to look would be asking them to take it on
                trust. docs/PRIVACY.md is generated from a scan of the source
                and fails the build the day a destination appears that it does
                not name, which is the part worth linking to. */}
            <p className="text-xs text-ink-faint leading-snug">
              No telemetry and no analytics. Nothing about your character, your
              game text or your account leaves this machine, and your password
              never reaches this app at all - it goes to Lich&apos;s own login.
              The wiki lookup on a watched room asks Elanthipedia about that
              room and nothing else.{' '}
              <a
                href="https://github.com/dancockrell/dr-companion/blob/main/docs/PRIVACY.md"
                target="_blank"
                rel="noreferrer"
                className="text-info hover:underline"
              >
                Every destination, and what is sent
              </a>
              .
            </p>
            <p className="text-xs text-ink-faint leading-snug">
              DR Companion is MIT. It installs and talks to{' '}
              <a
                href={LICH_LICENSE.url}
                target="_blank"
                rel="noreferrer"
                className="text-info hover:underline"
              >
                Lich
              </a>
              , which is {LICH_LICENSE.spdx} and is not part of this app.
              THIRD_PARTY.md in the source lists everything else.
            </p>
            <button
              type="button"
              aria-expanded={showLichLicence}
              className="w-full rounded-lg border border-border px-3 py-2 text-left text-xs text-ink-muted hover:text-ink"
              onClick={() => setShowLichLicence((v) => !v)}
            >
              {showLichLicence ? 'Hide' : 'Show'} Lich&apos;s {LICH_LICENSE.spdx} licence
            </button>
            {showLichLicence && (
              <div className="rounded-lg border border-border p-3 space-y-2 text-xs leading-snug text-ink-faint">
                <p className="font-medium text-ink-muted">{LICH_LICENSE.title}</p>
                {LICH_LICENSE.holders.map((holder) => (
                  <p key={holder}>{holder}</p>
                ))}
                <p>All rights reserved.</p>
                <p>{LICH_LICENSE.grant}</p>
                <ol className="list-decimal space-y-1 pl-4">
                  {LICH_LICENSE.conditions.map((condition) => (
                    <li key={condition.slice(0, 24)}>{condition}</li>
                  ))}
                </ol>
                <p>{LICH_LICENSE.disclaimer}</p>
              </div>
            )}
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
