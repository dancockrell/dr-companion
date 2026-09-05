import { AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore.ts'
import { CheckPanel } from './CheckPanel.tsx'

/**
 * BRIEF, INVBRIEF and ShowRoomID, read from the game rather than guessed.
 *
 * `check_toggles` has read these and logged them since before this panel
 * existed - see companion_bridge.lic's `check_toggles`/`check_room_id_flag`.
 * The bridge broadcast the finding as a `toggles` message and the store had
 * no field for it, so a real player had to be watching the log pane at the
 * right moment to learn their game's BRIEF was on and silently breaking
 * every script that reads room or inventory text. Same shape of gap as
 * `SettingsFilesPanel`, and the same fix: give it a field and a control.
 *
 * # Three icons, not two
 *
 * BRIEF/INVBRIEF being on is a warning (they shorten text scripts read).
 * ShowRoomID being off is a warning for the opposite reason - it needs to be
 * on for Lich to track rooms at all. `null` for any of them is neither: it
 * is "not known," rendered as its own state rather than folded into either
 * good or bad, because it is a different claim from both. See ToggleStatus
 * in src/bridge/types.ts for why `brief`/`invBrief` in particular can land
 * on `null` even after a successful read - there is no verified wire pattern
 * for a confirmed off, only for on.
 */
export function TogglesPanel() {
  const toggles = useAppStore((s) => s.toggles)
  const checkToggles = useAppStore((s) => s.checkToggles)
  const connected = useAppStore((s) => s.bridgeConnected)

  const rows: { label: string; state: boolean | null; goodWhen: boolean; onWord: string }[] = [
    {
      label: 'BRIEF',
      state: toggles?.brief ?? null,
      goodWhen: false,
      onWord: 'on — shortens room text scripts read',
    },
    {
      label: 'INVBRIEF',
      state: toggles?.invBrief ?? null,
      goodWhen: false,
      onWord: 'on — shortens inventory text scripts read',
    },
    {
      label: 'ShowRoomID',
      state: toggles?.showRoomId ?? null,
      goodWhen: true,
      onWord: 'on — what Lich needs to track rooms',
    },
  ]

  return (
    <CheckPanel
      label="Check toggles"
      checkTitle="Ask the game for BRIEF, INVBRIEF and ShowRoomID"
      notCheckedText="Not checked yet. BRIEF and INVBRIEF shorten what the game prints, which breaks anything reading room or inventory text; ShowRoomID needs to be on for Lich to know which room you're in. Nothing here is changed, only read."
      connected={connected}
      hasData={!!toggles}
      onCheck={checkToggles}
    >
      <ul className="flex flex-col gap-1">
        {rows.map((r) => {
          // A row's own state decides which icon it gets, independent of
          // the others - BRIEF being unknown says nothing about ShowRoomID.
          const known = r.state !== null
          const good = known && r.state === r.goodWhen
          const bad = known && r.state !== r.goodWhen

          return (
            <li
              key={r.label}
              className="flex items-center gap-2 rounded border border-border bg-surface px-2 py-1"
            >
              {good && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-good" />}
              {bad && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-danger" />}
              {!known && <HelpCircle className="h-3.5 w-3.5 shrink-0 text-ink-faint" />}

              <span className={`text-xs ${bad ? 'text-danger' : 'text-ink'}`}>{r.label}</span>

              <span className="ml-auto text-xs text-ink-faint">
                {!known
                  ? 'not confirmed'
                  : r.state
                    ? r.onWord
                    : r.label === 'ShowRoomID'
                      ? 'off — turn on with FLAGS ShowRoomID ON'
                      : 'off'}
              </span>
            </li>
          )
        })}
      </ul>
    </CheckPanel>
  )
}
