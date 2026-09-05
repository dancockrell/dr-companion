/**
 * Every script Lich can launch, searchable, with a Start button.
 *
 * Distinct from ScriptLauncher (the curated Activities list): that panel
 * offers a handful of behaviours the bridge composes on your behalf, this one
 * is a thin window onto the raw script library — 200+ files, most of them
 * never seen by this app before today, because there was no way to start one
 * except typing its name into Lich directly.
 *
 * `categoryOf` and `filter` are both optional and both read-only lookups —
 * neither one is the source of truth for what exists. `categoryOf` is
 * cosmetic, a label applied on top for readability. `filter` decides which
 * names get a raw Start button at all, for two different reasons: engine
 * plumbing that would be actively harmful to launch this way (starting a
 * second copy of the bridge itself, racing the one already listening), and
 * scripts that already have a real first-class control elsewhere, where a
 * second raw button beside it would just teach players there are two ways to
 * do everything and one of them is worse.
 *
 * The catalogue of *names* always comes live from the bridge's
 * `list_scripts`, and with no `filter` passed everything renders — the
 * default is permissive, not restrictive. A stale or missing taxonomy must
 * over-show rather than under-show: a wrongly-visible entry is a one-click
 * fix, a silently hidden one is invisible. Same reasoning as the
 * "Uncategorized" fallback below for a name `categoryOf` doesn't recognise.
 */
import { useEffect, useMemo, useState } from 'react'
import { Bookmark, Search, ListTree } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore.ts'
import { Button } from './Button.tsx'
import { cn } from '../../lib/cn.ts'

export type ScriptCategoryLookup = (name: string) => string | undefined
export type ScriptFilter = (name: string) => boolean

const UNCATEGORIZED = 'Uncategorized'

export function ScriptLibraryPanel({
  categoryOf,
  filter,
}: {
  /** Accepted for both call sites' benefit, but no longer read - see the
   * `<section>`'s own comment below for why the padding it used to gate
   * stopped needing a dense/non-dense distinction at all. */
  dense?: boolean
  categoryOf?: ScriptCategoryLookup
  filter?: ScriptFilter
}) {
  const catalog = useAppStore((s) => s.scriptCatalog)
  const scriptStates = useAppStore((s) => s.scriptStates)
  const bridgeConnected = useAppStore((s) => s.bridgeConnected)
  const listScripts = useAppStore((s) => s.listScripts)
  const startScript = useAppStore((s) => s.startScript)
  const quickSwitchPins = useAppStore((s) => s.quickSwitchPins)
  const toggleQuickSwitchPin = useAppStore((s) => s.toggleQuickSwitchPin)
  const [query, setQuery] = useState('')

  // Ask once a bridge is actually there to answer. Re-asks on reconnect,
  // since a different Lich install could report a different library.
  useEffect(() => {
    if (bridgeConnected) listScripts()
  }, [bridgeConnected, listScripts])

  const runningByName = useMemo(() => {
    const m = new Map<string, string>()
    scriptStates.forEach((s) => m.set(s.name.toLowerCase(), s.status))
    return m
  }, [scriptStates])

  // Filtered but not yet searched — what the panel considers "the library"
  // for the count badge, before the search box narrows it further.
  const visible = useMemo(
    () => (catalog ?? []).filter((n) => !filter || filter(n)),
    [catalog, filter]
  )

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const names = visible.filter((n) => !q || n.toLowerCase().includes(q))
    const byCategory = new Map<string, string[]>()
    names.forEach((n) => {
      const cat = categoryOf?.(n) || UNCATEGORIZED
      if (!byCategory.has(cat)) byCategory.set(cat, [])
      byCategory.get(cat)!.push(n)
    })
    return [...byCategory.entries()].sort(([a], [b]) =>
      a === UNCATEGORIZED ? 1 : b === UNCATEGORIZED ? -1 : a.localeCompare(b)
    )
  }, [visible, query, categoryOf])

  if (!bridgeConnected) {
    return (
      <div className="text-xs text-ink-faint px-1 py-2">
        Connect to Lich to see what it can launch.
      </div>
    )
  }

  if (catalog === null) {
    return <div className="text-xs text-ink-faint px-1 py-2">Asking Lich what it can run…</div>
  }

  return (
    // No horizontal padding here: every mount of this panel (DashboardLayout's
    // Box, FreeCanvas/Panel's pop-out wrapper) already pads its content — this
    // section used to double it, one of them redundant on every single mount.
    <section className="pb-1.5">

      <h2 className="text-xs font-medium text-ink-faint uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
        <ListTree className="w-3.5 h-3.5" />
        Script Library
        <span className="text-ink-faint normal-case font-normal">
          ({visible.length})
        </span>
      </h2>

      <div className="relative mb-2">
        <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-ink-faint" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search scripts"
          placeholder="Search scripts…"
          className="w-full pl-7 pr-2 py-1.5 text-xs rounded-lg border border-border bg-surface-raised text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent/50"
        />
      </div>

      {catalog.length === 0 ? (
        <p className="text-xs text-warn leading-snug">
          Lich reported no scripts at all. That almost certainly means the
          bridge could not read its own scripts directory — not that the
          directory is empty.
        </p>
      ) : visible.length === 0 ? (
        // Distinct from the case above on purpose: the bridge answered fine,
        // the curated filter just hid everything it returned. Conflating the
        // two would send someone chasing a bridge problem that isn't one.
        <p className="text-xs text-ink-faint leading-snug">
          {catalog.length} scripts reported, none shown by the current filter.
        </p>
      ) : grouped.length === 0 ? (
        <p className="text-xs text-ink-faint leading-snug">
          Nothing matches “{query}”.
        </p>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {grouped.map(([category, names]) => (
            <div key={category}>
              <div className="text-xs font-medium text-ink-faint uppercase tracking-wide mb-1">
                {category}
              </div>
              <div className="space-y-1">
                {names.map((name) => {
                  const status = runningByName.get(name.toLowerCase())
                  const running = status === 'running' || status === 'paused'
                  const pinned = quickSwitchPins.some((p) => p.kind === 'script' && p.name === name)
                  return (
                    <div
                      key={name}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-raised px-2.5 py-1.5"
                    >
                      <div className="min-w-0 flex items-center gap-1.5">
                        <span className="text-xs text-ink truncate">{name}</span>
                        {status && (
                          <span
                            className={
                              status === 'paused'
                                ? 'text-xs text-warn shrink-0'
                                : 'text-xs text-good shrink-0'
                            }
                          >
                            {status}
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {/* Same bookmark, same meaning, as TaskFlowPanel's — pin
                            to the Quick Switch bar so this specific script
                            is a keypress away without a scroll through the
                            library to find it again. */}
                        <button
                          type="button"
                          onClick={() => toggleQuickSwitchPin({ kind: 'script', name })}
                          title={
                            pinned
                              ? 'Unpin from the Quick Switch bar'
                              : 'Pin to the Quick Switch bar — one click or a number key from anywhere in the app'
                          }
                          aria-label={`${pinned ? 'Remove' : 'Add'} ${name} ${pinned ? 'from' : 'to'} the Quick Switch bar`}
                          className={cn(
                            'rounded p-1',
                            pinned ? 'text-accent' : 'text-ink-faint hover:text-ink-muted'
                          )}
                        >
                          <Bookmark className="h-3 w-3" fill={pinned ? 'currentColor' : 'none'} aria-hidden />
                        </button>
                        <Button
                          size="sm"
                          variant={running ? 'ghost' : 'secondary'}
                          disabled={running}
                          onClick={() => startScript(name)}
                          className="shrink-0 text-xs px-2 py-1"
                        >
                          {running ? 'Running' : 'Start'}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
