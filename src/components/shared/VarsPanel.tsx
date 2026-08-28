import { RefreshCw } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'

/**
 * `Lich::Common::Vars` for this character, listed rather than left to `;vars`.
 *
 * Every script on the machine can read and write this store, and the only
 * way to see what's in it has always been typing `;vars list` at the game.
 * Same gap as `SettingsFilesPanel` and `TogglesPanel`: `list_vars` reads and
 * broadcasts the whole thing, and until now nothing in the store or a screen
 * did anything with it.
 *
 * Read-only, on purpose - see VarsEntry in src/bridge/types.ts. These values
 * are owned by whichever script set them, not by this app.
 */
export function VarsPanel() {
  const vars = useAppStore((s) => s.vars)
  const listVars = useAppStore((s) => s.listVars)
  const connected = useAppStore((s) => s.bridgeConnected)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs text-ink-muted hover:bg-surface-overlay hover:text-ink disabled:opacity-50"
          onClick={listVars}
          disabled={!connected}
          title={
            connected
              ? "List this character's Lich variables (the same list ;vars list shows)"
              : 'Needs a bridge connection'
          }
        >
          <RefreshCw className="h-3 w-3" />
          {vars ? 'Check again' : 'List variables'}
        </button>
      </div>

      {!vars && (
        <p className="text-xs text-ink-faint">
          Not checked yet. Scripts store settings here that this app doesn't
          otherwise know about - a hunting room id, a saved preference. Nothing
          here is changed, only read.
        </p>
      )}

      {vars && vars.length === 0 && (
        <p className="text-xs text-ink-faint">No variables set for this character.</p>
      )}

      {vars && vars.length > 0 && (
        <ul className="flex flex-col gap-1">
          {vars.map((v) => (
            <li
              key={v.name}
              className="flex items-baseline gap-2 rounded border border-border bg-surface px-2 py-1"
            >
              <span className="shrink-0 text-xs text-ink">{v.name}</span>
              <span
                className={`min-w-0 flex-1 truncate text-right text-xs ${
                  v.kind === 'other' ? 'text-ink-faint italic' : 'text-ink-muted'
                }`}
                title={v.value}
              >
                {v.value}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
