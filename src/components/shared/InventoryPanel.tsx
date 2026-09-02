import { useRef, useState } from 'react'
import { BookOpen, ChevronDown, ChevronRight, Package, Search, Sparkles } from 'lucide-react'
import { useAppStore, isIntentImplemented } from '../../store/useAppStore'
import { capabilitiesForCharacter } from '../../lib/accountCapabilities'
import { requestGameAction } from '../../lib/gameActions'
import { fetchElanthipedia, type ElanthipediaPage } from '../../lib/elanthipedia'
import { scrollableRegionProps } from '../../lib/scrollableRegion'

const FILTERS = [
  ['All', 'list'], ['Weapons', 'weapons full'], ['Armor', 'armor full'],
  ['Magic', 'magic full'], ['Crafting', 'crafting full'], ['Loot', 'loot full'],
  ['Wearable', 'wearables full'], ['Storage', 'containers full'],
] as const

function itemTarget(name: string): string {
  return name.replace(/^(?:a|an|some|the)\s+/i, '').trim()
}

function groupedItems(items: string[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>()
  for (const name of items) counts.set(name, (counts.get(name) ?? 0) + 1)
  return [...counts].map(([name, count]) => ({ name, count }))
}

function ItemRow({ name, count = 1, onWiki }: { name: string; count?: number; onWiki: (name: string) => void }) {
  const target = itemTarget(name)
  return (
    <div className="group flex min-w-0 items-center gap-1 border-t border-border/50 px-2 py-1 first:border-t-0">
      <button type="button" className="min-w-0 flex-1 truncate text-left text-xs text-ink hover:text-accent" onClick={() => requestGameAction(`look ${target}`, `Look at ${name}`)} title={`Look at ${name}`}>
        {name}{count > 1 ? ` (${count})` : ''}
      </button>
      <div className="flex shrink-0 items-center opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <button type="button" className="rounded px-1 py-0.5 text-xs text-ink-faint hover:bg-surface-overlay hover:text-ink" onClick={() => requestGameAction(`appraise ${target} quick`, `Appraise ${name}`)} title="Quick appraisal">A</button>
        <button type="button" className="rounded px-1 py-0.5 text-xs text-ink-faint hover:bg-surface-overlay hover:text-ink" onClick={() => requestGameAction(`analyze ${target}`, `Analyze ${name}`)} title="Analyze crafting and special properties"><Sparkles className="h-3 w-3" /></button>
        <button type="button" className="rounded px-1 py-0.5 text-ink-faint hover:bg-surface-overlay hover:text-info" onClick={() => onWiki(name)} title={`Look up ${name} on Elanthipedia`} aria-label={`Elanthipedia information for ${name}`}><BookOpen className="h-3 w-3" /></button>
      </div>
    </div>
  )
}

export function InventoryPanel({ dense = false }: { dense?: boolean }) {
  const inventory = useAppStore((s) => s.inventory)
  const character = useAppStore((s) => s.character)
  const requestIntent = useAppStore((s) => s.requestIntent)
  const bridgeIntents = useAppStore((s) => s.bridgeIntents)
  const lootAvailable = isIntentImplemented(bridgeIntents, 'loot')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [wiki, setWiki] = useState<{ item: string; page: ElanthipediaPage | null; loading: boolean } | null>(null)
  const wikiRequest = useRef(0)

  const showWiki = (item: string) => {
    const request = ++wikiRequest.current
    setWiki({ item, page: null, loading: true })
    void fetchElanthipedia(itemTarget(item)).then((page) => {
      if (request === wikiRequest.current) setWiki({ item, page, loading: false })
    })
  }

  if (!inventory) {
    return (
      <div className="text-xs text-ink-faint px-1 py-2">No inventory data</div>
    )
  }

  const caps = character ? capabilitiesForCharacter(character) : null
  const needle = query.trim().toLowerCase()
  const worn = (inventory.worn ?? []).filter((item) => !needle || item.toLowerCase().includes(needle))
  const containers = inventory.containers.filter((container) =>
    !needle ||
    container.name.toLowerCase().includes(needle) ||
    (container.items ?? []).some((item) => item.toLowerCase().includes(needle))
  )

  /**
   * `pressure`/`used`/`capacity` come from the bridge already fabricated:
   * `companion_bridge.lic` hardcodes `used: 0, capacity: 0, pressure: 'ok'`
   * for every container (issue #5) — a live bridge currently can't even reach
   * that far, since it calls a `DRCI.get_worn_containers` method that does
   * not exist in Lich and silently returns an empty list instead. Nothing
   * here is measured yet, so nothing here is drawn as though it were. DR
   * containers always have a real capacity above zero, so `capacity === 0`
   * unambiguously means "not reported" rather than "holds nothing" — that's
   * what gates the bar below, no separate unknown flag needed until the
   * bridge starts sending a real number.
   *
   * `character.encumbrance` is real, already sent by the bridge
   * (`DRStats.encumbrance`), and was never read here — the panel computed
   * its own fake pressure instead of using the true one sitting unused on
   * the character. Use that for the header instead of `inventory.pressure`.
   */
  const encumbrance = character?.encumbrance
  const pressureColor =
    encumbrance === 'overloaded' || encumbrance === 'heavy'
      ? 'text-danger'
      : encumbrance === 'moderate' || encumbrance === 'light'
        ? 'text-warn'
        : encumbrance
          ? 'text-good'
          : 'text-ink-faint'

  return (
    <div className="space-y-1.5">
      <div className="flex min-w-0 items-center gap-2 text-xs">
        {/* A heading, not a span - this box is mounted bare (no Box `title`,
         * see DashboardLayout), so this is the only accessible name the
         * panel has. A visually-identical span with no heading role reads
         * as unlabelled content to a screen reader. */}
        <h2 className="text-xs font-medium text-ink-faint uppercase tracking-wider">
          Inventory
        </h2>
        <div className="flex min-w-0 flex-1 items-center gap-1 rounded border border-border bg-surface px-1.5 py-1">
          <Search className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find anything carried…" className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink-faint" />
        </div>
        <span className={`shrink-0 ${pressureColor}`}>{encumbrance ?? 'not reported'}</span>
      </div>
      <div {...scrollableRegionProps('Inventory searches', 'horizontal')} className="flex gap-1 overflow-x-auto pb-0.5">
        {FILTERS.map(([label, command]) => (
          <button key={label} type="button" onClick={() => requestGameAction(`inventory ${command}`, `Inventory: ${label}`)} className="shrink-0 rounded border border-border px-1.5 py-0.5 text-xs text-ink-muted hover:border-accent hover:text-accent" title={`Ask the game for ${label.toLowerCase()} across all containers`}>
            {label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-surface-raised divide-y divide-border">
        {containers.map((c) => {
          const known = c.capacity > 0
          const pct = known ? Math.round((c.used / c.capacity) * 100) : 0
          const revealedBySearch = Boolean(needle) && Boolean(c.items)
          const expanded = open.has(c.name) || revealedBySearch
          return (
            <div key={c.name} className="space-y-1">
              <div className="flex items-stretch hover:bg-surface-overlay">
                <button type="button" className="flex min-w-0 flex-1 items-center justify-between gap-2 px-2 py-1.5 text-sm" onClick={() => setOpen((previous) => { const next = new Set(previous); if (next.has(c.name)) next.delete(c.name); else next.add(c.name); return next })} aria-expanded={expanded} title={revealedBySearch ? `${c.name} contains a search match` : `Show ${c.name} contents`}>
                  <span className="text-ink flex items-center gap-1 min-w-0">
                    {expanded ? <ChevronDown className="h-3 w-3 shrink-0 text-ink-faint" /> : <ChevronRight className="h-3 w-3 shrink-0 text-ink-faint" />}
                    <Package className="w-3.5 h-3.5 text-ink-faint shrink-0" />
                    <span className="truncate">{c.name}</span>
                  </span>
                  <span className={!known ? 'text-ink-faint text-xs' : pct >= 90 ? 'text-danger text-xs' : pct >= 70 ? 'text-warn text-xs' : 'text-ink-muted text-xs'}>
                    {known ? `${c.used}/${c.capacity}` : c.items ? `${c.items.length} items` : 'contents unknown'}
                  </span>
                </button>
                <button type="button" className="grid w-8 shrink-0 place-items-center border-l border-border/50 text-ink-faint hover:text-info" onClick={() => showWiki(c.name)} title={`Look up ${c.name} on Elanthipedia`} aria-label={`Elanthipedia information for ${c.name}`}><BookOpen className="h-3.5 w-3.5" /></button>
              </div>
              {known && (
                <div className="mx-2 mb-1.5 h-1.5 rounded-full bg-surface overflow-hidden border border-border/40">
                  <div
                    className={`h-full rounded-full transition-all ${
                      pct >= 90
                        ? 'bg-danger'
                        : pct >= 70
                          ? 'bg-warn'
                          : 'bg-good'
                    }`}
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
              )}
              {expanded && (
                <div className="border-t border-border/60 bg-surface/50">
                  {groupedItems((c.items ?? []).filter((item) => !needle || item.toLowerCase().includes(needle))).map(({ name, count }) => <ItemRow key={name} name={name} count={count} onWiki={showWiki} />)}
                  {!c.items && <button type="button" className="w-full px-2 py-1.5 text-left text-xs text-info hover:bg-surface-overlay" onClick={() => requestGameAction(`inventory ${itemTarget(c.name)}`, `Scan ${c.name}`)}>Scan this container in game</button>}
                  {c.items && c.items.length === 0 && <div className="px-2 py-1.5 text-xs text-ink-faint">Empty</div>}
                </div>
              )}
            </div>
          )
        })}
        {containers.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-ink-faint">
            {needle ? `Nothing carried matches “${query.trim()}”` : 'No containers reported'}
          </div>
        )}
        <div className="px-2 py-1.5 flex justify-between text-xs text-ink-faint">
          <span>Worn {inventory.wornCount}</span>
          <span>Loose {inventory.looseCount}</span>
        </div>
      </div>

      {(inventory.worn?.length ?? 0) > 0 && (
        <details className="rounded border border-border bg-surface-raised" open={Boolean(needle)}>
          <summary className="cursor-pointer px-2 py-1.5 text-xs text-ink-muted">Worn equipment · {inventory.wornCount}</summary>
          <div className="max-h-48 overflow-y-auto">{groupedItems(worn).map(({ name, count }) => <ItemRow key={name} name={name} count={count} onWiki={showWiki} />)}</div>
        </details>
      )}

      {wiki && (
        <aside className="rounded border border-info/40 bg-surface-overlay p-2 text-xs" aria-label={`Elanthipedia information for ${wiki.item}`}>
          <div className="flex items-start justify-between gap-2"><strong className="text-ink">{wiki.item}</strong><button type="button" className="text-ink-faint hover:text-ink" onClick={() => { wikiRequest.current += 1; setWiki(null) }}>Close</button></div>
          {wiki.loading ? <p className="mt-1 text-ink-faint">Checking Elanthipedia…</p> : wiki.page?.found ? <><p className="mt-1 line-clamp-6 text-ink-muted">{wiki.page.extract}</p><a className="mt-1 inline-block text-info hover:underline" href={wiki.page.pageUrl} target="_blank" rel="noreferrer">Full Elanthipedia page</a></> : <p className="mt-1 text-ink-faint">{wiki.page?.note || 'No exact Elanthipedia page found. Try the full wiki search.'}</p>}
          <a className="mt-1 block text-info hover:underline" href={`https://elanthipedia.play.net/Special:Search?search=${encodeURIComponent(itemTarget(wiki.item))}`} target="_blank" rel="noreferrer">Search Elanthipedia for this item</a>
        </aside>
      )}

      {caps?.inventoryPressureTight && (
        <p className="text-xs text-warn leading-snug">
          Tight inventory tier — loot stays selective.
        </p>
      )}

      {/* carryMax/carryWarnAt were sitting in AccountCapabilities with no
        * reader anywhere (issue #39) — the free-account carry ceiling was
        * computed and then thrown away. Worn + loose is the same total the
        * game itself warns against; there is no separate "junk room" count
        * the bridge sends. */}
      {caps?.carryMax != null && (() => {
        const carried = inventory.wornCount + inventory.looseCount
        const overWarn = caps.carryWarnAt != null && carried >= caps.carryWarnAt
        const overMax = carried >= caps.carryMax
        if (!overWarn) return null
        return (
          <p className={`text-xs leading-snug ${overMax ? 'text-danger' : 'text-warn'}`}>
            Carrying {carried} of {caps.carryMax} — free accounts get junk-room
            warnings past this.
          </p>
        )
      })()}

      {!dense && (
        <div className="flex gap-1.5">
          {lootAvailable && (
            <button
              type="button"
              className="flex-1 text-xs rounded-lg border border-border px-2 py-1 text-ink-muted hover:text-ink hover:bg-surface-overlay"
              onClick={() => requestIntent('loot')}
            >
              Loot pass
            </button>
          )}
          <button
            type="button"
            className="flex-1 text-xs rounded-lg border border-border px-2 py-1 text-ink-muted hover:text-ink hover:bg-surface-overlay"
            onClick={() => requestIntent('stow_all')}
          >
            Stow all
          </button>
        </div>
      )}
    </div>
  )
}
