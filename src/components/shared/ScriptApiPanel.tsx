import { useEffect, useState } from 'react'
import { FolderOpen, RefreshCw } from 'lucide-react'
import { scriptApiInfo, type ScriptApiInfo } from '../../lib/pythonTasks'
import { revealFile } from '../../lib/setup'
import { isTauri } from '../../lib/tauri'

/**
 * The port and token file a player's own script needs to connect - see
 * `docs/PYTHON_API.md`.
 *
 * `Companion()` reads both automatically, so nothing a working script needs
 * comes from this panel. It exists for the two moments that aren't "a script
 * runs fine": confirming the socket is actually listening before chasing a
 * connection failure somewhere else, and pointing a non-Python client at the
 * right port and token file by hand. `script_api_info` on the Rust side has
 * been able to answer both since it was written - its own doc comment says
 * "for a settings panel to show it" - and nothing asked it until now. Same
 * shape as `SettingsFilesPanel` and `TogglesPanel` next to it in Settings: a
 * finished read reaching no control.
 */
export function ScriptApiPanel() {
  const [info, setInfo] = useState<ScriptApiInfo | null>(null)
  const [checking, setChecking] = useState(false)

  const check = () => {
    if (!isTauri()) return
    setChecking(true)
    void scriptApiInfo()
      .then(setInfo)
      .finally(() => setChecking(false))
  }

  useEffect(check, [])

  if (!isTauri()) {
    return (
      <p className="text-xs text-ink-faint">
        Not available in a browser preview - this reads a file the app writes
        on its own machine.
      </p>
    )
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 rounded border border-border bg-surface px-2 py-1.5">
        <span className="text-xs text-ink-faint">Port</span>
        <span className="text-xs tabular-nums text-ink">
          {info?.port ?? (info ? 'not listening yet' : checking ? 'checking…' : '—')}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2 rounded border border-border bg-surface px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs text-ink-faint" title={info?.tokenPath}>
          {info?.tokenPath || 'Token file'}
        </span>
        {info?.tokenPath && (
          <button
            type="button"
            className="shrink-0 rounded p-1 text-ink-faint hover:text-ink"
            onClick={() => void revealFile(info.tokenPath)}
            title="Show in folder"
            aria-label="Show token file in folder"
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <button
        type="button"
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-ink-muted hover:text-ink disabled:opacity-50"
        onClick={check}
        disabled={checking}
      >
        <RefreshCw className={`h-3 w-3 ${checking ? 'animate-spin' : ''}`} />
        Recheck
      </button>

      <p className="text-xs text-ink-faint leading-snug">
        A Python script started with `Companion()` reads both of these
        automatically. This is for confirming the socket is up, or pointing a
        different kind of client at it by hand - the token is regenerated
        every time the app starts.
      </p>
    </div>
  )
}
