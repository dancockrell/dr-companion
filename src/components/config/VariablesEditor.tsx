/**
 * A read-only, searchable browser for Genie's `#var` table - the thing
 * exceeding Genie means here, since Genie itself has nothing browsable at
 * all: variables.cfg is a raw file, and finding out what `$preposition`
 * currently means means opening it in a text editor. See variables.ts's
 * header for why there is no add/edit/delete here, unlike the other three
 * tabs - most of this file is Genie's own live bookkeeping, not settings.
 */
import { useMemo, useState } from 'react'
import { RefreshCw, Search } from 'lucide-react'
import { useVariables, reloadVariables } from '../../lib/useVariables.ts'

export function VariablesEditor() {
  const { variables, note } = useVariables()
  const [search, setSearch] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return variables
    return variables.filter(
      (v) => v.name.toLowerCase().includes(q) || v.value.toLowerCase().includes(q)
    )
  }, [variables, search])

  const refresh = async () => {
    setRefreshing(true)
    reloadVariables()
    // reloadVariables() fires and forgets its own promise; give the module
    // cache a moment before dropping the spinner rather than reading the
    // stale closed-over `variables` value from before this click.
    await new Promise((r) => setTimeout(r, 300))
    setRefreshing(false)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-border bg-surface-raised p-3 text-xs text-ink-muted">
        Read-only. Most of this file is Genie's own bookkeeping while it plays -{' '}
        <code className="text-ink-faint">roomid</code>, <code className="text-ink-faint">Time.timeOfDay</code>{' '}
        and the like - not settings to hand-edit, so this only looks things up. Referenced
        automatically in the Aliases and Macros tabs whenever a <code className="text-ink-faint">$name</code>{' '}
        appears in what you're testing or writing.
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or value"
            className="w-full rounded border border-border bg-surface py-1.5 pl-7 pr-2 text-sm text-ink placeholder:text-ink-faint"
          />
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          title="Re-read variables.cfg - values change while Genie plays"
          className="flex shrink-0 items-center gap-1 rounded border border-border bg-surface-raised px-2.5 py-1.5 text-xs font-medium text-ink hover:border-accent hover:text-accent disabled:opacity-50"
        >
          <RefreshCw className={refreshing ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} /> Refresh
        </button>
      </div>

      {variables.length === 0 && (
        <div className="rounded border border-border bg-surface-raised p-3 text-sm text-ink-muted">
          {note || 'No variables found.'}
        </div>
      )}

      <div className="flex flex-col gap-1">
        {filtered.map((v) => (
          <div key={v.sourceLine} className="flex items-center gap-2 rounded border border-border bg-surface px-2 py-1.5">
            <span className="w-48 shrink-0 truncate font-mono text-xs font-medium text-ink" title={v.name}>
              {v.name}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-muted" title={v.value}>
              {v.value || <span className="italic text-ink-faint">(empty)</span>}
            </span>
          </div>
        ))}
        {variables.length > 0 && filtered.length === 0 && (
          <div className="py-6 text-center text-sm text-ink-faint">No variable matches “{search}”.</div>
        )}
      </div>

      {variables.length > 0 && (
        <div className="border-t border-border pt-2 text-xs text-ink-faint">{variables.length} variables</div>
      )}
    </div>
  )
}
