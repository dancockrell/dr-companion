import type { ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'

/**
 * The "read-only status, fetched on request" shape, factored out once it
 * showed up a third time.
 *
 * `TogglesPanel`, `VarsPanel` and `SettingsFilesPanel` each independently
 * built: a header with a Check/Refresh button (byte-identical className in
 * all three), disabled while there's no bridge, a title that explains why
 * it's disabled, a label that flips from an initial verb to "Check again"
 * once data exists, a "Not checked yet" paragraph before the first check,
 * and the actual content once there's something to show. Three copies of the
 * same wrapper meant a style tweak needed three edits to stay consistent,
 * and a fourth panel like these would have been a fourth copy-paste.
 *
 * Only the wrapper is shared. What "hasData" means and what renders inside
 * it stay with each caller — a null toggle set, an empty vars array, and a
 * settings-files list all have their own not-checked/empty/populated
 * distinctions that this component has no business knowing about.
 */
export function CheckPanel({
  label,
  notCheckedText,
  checkTitle,
  connected,
  hasData,
  onCheck,
  headerExtra,
  children,
}: {
  /** Button text before the first check, e.g. "Check toggles". */
  label: string
  /** Shown in place of content before the first check. */
  notCheckedText: string
  /** Button title/tooltip while the bridge is connected. */
  checkTitle: string
  connected: boolean
  hasData: boolean
  onCheck: () => void
  /** Extra header content, e.g. SettingsFilesPanel's "for {character}". */
  headerExtra?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs text-ink-muted hover:bg-surface-overlay hover:text-ink disabled:opacity-50"
          onClick={onCheck}
          disabled={!connected}
          title={connected ? checkTitle : 'Needs a bridge connection'}
        >
          <RefreshCw className="h-3 w-3" />
          {hasData ? 'Check again' : label}
        </button>

        {headerExtra}
      </div>

      {!hasData && <p className="text-xs text-ink-faint">{notCheckedText}</p>}

      {hasData && children}
    </div>
  )
}
