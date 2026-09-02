import { useState } from 'react'
import { Anvil, Apple, Backpack, Beer, Bone, BookOpen, BowArrow, Box, Coins, Cookie, ExternalLink, FlaskConical, Gem, Hammer, Key, Leaf, Package, Pickaxe, ScrollText, Search, Shield, Shirt, Skull, Sparkles, Sword, Utensils, Wand2, X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { nounOf } from '../../lib/room'
import { useRoomItemTake } from '../../lib/useRoomItemTake'
import { useDragScroll } from '../../lib/useDragScroll'
import { requestGameAction } from '../../lib/gameActions'
import { scrollableRegionProps } from '../../lib/scrollableRegion'

/**
 * The floor, as its own row — pulled off the battle board itself
 * (`CombatRadar` used to draw it as its own corner) so the board stays
 * about who's fighting, not what's lying around after. Same pill style
 * `BattleActionBar` already uses: icon, label, one row, no group headers.
 *
 * Identical names collapse into one pill with a count, same idea CardDeck
 * already uses for duplicate creatures — three piles of "some copper
 * kronars" read as one pill worth three rather than three indistinguishable
 * coin pills in a row.
 *
 * Two independent mounts, on purpose: a compact `glance` strip over the
 * bottom of the room art (`BattleColumn`) and a full `browser` inside the
 * room description (`ClassicRoomText`) — different contexts, both required,
 * neither a substitute for the other (the browser handles a long list with
 * search; the glance strip stays visible while looking at the picture).
 * They used to share one lifted selection value, and only the browser ever
 * rendered the action panel that selecting an item opens — so clicking a
 * pill in the glance strip changed shared state with no visible result
 * there, while the actual panel opened in the other copy whenever it
 * scrolled into view. Each mount now owns its own selection (`selectedItem`
 * is never passed in by either caller, so both fall through to this
 * component's own local state) and its own action panel, opened as a
 * popover in `glance` mode so it doesn't fight the strip's fixed height.
 */

/**
 * A generic-but-good icon for a floor item, guessed from its name the same
 * way a player glances at a pile and knows "that's coins" without reading a
 * label. Only a handful of keywords get their own icon — the things people
 * actually dig through a corpse for — everything else gets the same plain
 * "pile of something" icon rather than a wrong specific guess. Nothing here
 * is a claim about what the item actually is beyond what its own name
 * already says; the full name is still right there as the pill's label.
 */
function iconForItem(name: string) {
  const n = name.toLowerCase()
  if (/\bcoins?\b|\bkronars?\b|\blirums?\b|\bdokoras?\b/.test(n)) return Coins
  if (/\bgems?\b|\bjewels?\b|\bstones?\b/.test(n)) return Gem
  if (/\bbox\b|\bchest\b|\bcrate\b|\bcase\b/.test(n)) return Box
  if (/\bbackpack\b|\bbag\b|\bpouch\b|\bsack\b|\bpack\b/.test(n)) return Backpack
  if (/\bcorpse\b|\bcarcass\b|\bskull\b/.test(n)) return Skull
  if (/\bbones?\b|\btusk\b|\bfang\b|\bclaw\b/.test(n)) return Bone
  if (/\bbook\b|\btome\b|\bgrimoire\b/.test(n)) return BookOpen
  if (/\bscroll\b|\bletter\b|\bnote\b|\bparchment\b/.test(n)) return ScrollText
  if (/\bwand\b|\bstaff\b|\borb\b/.test(n)) return Wand2
  if (/\bbow\b|\bcrossbow\b|\barrows?\b|\bbolts?\b/.test(n)) return BowArrow
  if (/\bsword\b|\bblade\b|\bdagger\b|\bknife\b|\baxe\b|\bmace\b|\bspear\b/.test(n)) return Sword
  if (/\bshield\b|\bbuckler\b/.test(n)) return Shield
  if (/\barmor\b|\barmour\b|\bhauberk\b|\bbrigandine\b|\bhelm\b/.test(n)) return Shirt
  if (/\bherb\b|\bleaf\b|\broot\b|\bflower\b|\bremedy\b/.test(n)) return Leaf
  if (/\bskin\b|\bpelt\b|\bhide\b/.test(n)) return Shirt
  if (/\bingot\b|\bore\b|\bmetal\b/.test(n)) return Anvil
  if (/\bpickaxe\b|\bmining\b/.test(n)) return Pickaxe
  if (/\bhammer\b|\btool\b|\bkit\b/.test(n)) return Hammer
  if (/\bkey\b|\blockpick\b/.test(n)) return Key
  if (/\bpotion\b|\bphial\b|\bvial\b|\bflask\b/.test(n)) return FlaskConical
  if (/\bbeer\b|\bale\b|\bwine\b|\bdrink\b/.test(n)) return Beer
  if (/\bapple\b|\bfruit\b/.test(n)) return Apple
  if (/\bcookie\b|\bcake\b|\bbread\b/.test(n)) return Cookie
  if (/\bfood\b|\bmeat\b|\bstew\b/.test(n)) return Utensils
  if (/\bmagic\b|\bglowing\b|\bshimmering\b|\bcambrinth\b/.test(n)) return Sparkles
  return Package
}

export type FloorItemsMode = 'glance' | 'browser'

export function FloorItems({
  items,
  mode = 'browser',
  selectedItem,
  onSelectedItemChange,
}: {
  items?: string[]
  mode?: FloorItemsMode
  selectedItem?: string | null
  onSelectedItemChange?: (name: string | null) => void
}) {
  const { take, canSend, reason } = useRoomItemTake()
  const drag = useDragScroll()
  const [query, setQuery] = useState('')
  const [internalSelected, setInternalSelected] = useState<string | null>(null)
  const selected = selectedItem === undefined ? internalSelected : selectedItem
  const setSelected = (name: string | null) => {
    if (onSelectedItemChange) onSelectedItemChange(name)
    else setInternalSelected(name)
  }

  if (!items || items.length === 0) return null

  const groups: { name: string; count: number }[] = []
  const indexOf = new Map<string, number>()
  for (const name of items) {
    const i = indexOf.get(name)
    if (i != null) groups[i].count++
    else {
      indexOf.set(name, groups.length)
      groups.push({ name, count: 1 })
    }
  }
  const needle = query.trim().toLowerCase()
  const visible = groups.filter(({ name }) => !needle || name.toLowerCase().includes(needle))
  const targetOf = (name: string) => name.replace(/^(?:a|an|some|the)\s+/i, '').trim()

  return (
    <div
      className={cn('relative flex min-h-0 flex-col', mode === 'browser' && 'h-full')}
      style={{
        gap: 'calc(0.25rem * var(--radar-scale, 1))',
        fontSize: 'max(0.75rem, calc(0.75rem * var(--radar-scale, 1)))',
      }}
      aria-label={`Items on the ground: ${groups.length} kinds, ${items.length} total`}
    >
      <div className={cn('flex min-h-0 items-center gap-1', mode === 'browser' && 'flex-1 items-stretch')}>
        {mode === 'glance' && (
          <span className="shrink-0 rounded border border-accent/35 bg-surface-overlay/80 px-1.5 py-1 text-xs font-medium tabular-nums text-accent" title={`${items.length} items in ${groups.length} distinct piles`}>
            {items.length} · {groups.length} kinds
          </span>
        )}
        <div
          {...scrollableRegionProps('Items on the ground', mode === 'glance' ? 'horizontal' : 'vertical')}
          ref={drag.ref}
          onPointerDown={drag.onPointerDown}
          onPointerMove={drag.onPointerMove}
          onPointerUp={drag.onPointerUp}
          onPointerCancel={drag.onPointerCancel}
          className={cn(
            'flex min-h-0 min-w-0 flex-1 gap-1',
            mode === 'glance' ? 'overflow-x-auto' : 'flex-wrap content-start overflow-y-auto pr-1',
            drag.dragging ? 'cursor-grabbing select-none' : 'cursor-grab'
          )}
        >
          {visible.map(({ name, count }) => {
            const Icon = iconForItem(name)
            const label = count > 1 ? `${name} (${count})` : name
            const tooltip = `${label} — click for Look, Get, Appraise, Analyze, and Elanthipedia`
            return (
              <button
                key={name}
                type="button"
                onClick={() => setSelected(selected === name ? null : name)}
                aria-pressed={selected === name}
                title={tooltip}
                className={cn(
                  'flex shrink-0 items-center rounded border border-border shadow-sm backdrop-blur-sm',
                  mode === 'glance' ? 'bg-surface/72' : 'bg-surface-raised',
                  'text-ink-muted hover:border-ink-faint hover:text-ink',
                  selected === name && 'border-accent bg-accent/10 text-ink'
                )}
                style={{
                  gap: 'calc(0.25rem * var(--radar-scale, 1))',
                  paddingInline: 'calc(0.375rem * var(--radar-scale, 1))',
                  paddingBlock: 'calc(0.25rem * var(--radar-scale, 1))',
                  fontSize: 'inherit',
                }}
              >
                <Icon
                  className="shrink-0 text-accent"
                  style={{
                    width: 'clamp(0.75rem, calc(0.875rem * var(--radar-scale, 1)), 1.1rem)',
                    height: 'clamp(0.75rem, calc(0.875rem * var(--radar-scale, 1)), 1.1rem)',
                  }}
                  aria-hidden
                />
                <span className="whitespace-nowrap">{label}</span>
              </button>
            )
          })}
        </div>
      </div>
      {selected && (() => {
        const target = targetOf(selected)
        const wikiUrl = `https://elanthipedia.play.net/Special:Search?search=${encodeURIComponent(target)}`
        return (
          <div
            className={cn(
              'flex flex-wrap items-center gap-1 rounded border border-accent/45 bg-surface-overlay/90 p-1.5 text-xs shadow-lg backdrop-blur',
              // The glance strip is a fixed-height bar over the room art —
              // growing the panel inline would either clip it or push the
              // strip taller than the art allows, so it opens as a popover
              // instead, anchored above the row it came from rather than
              // sharing layout space with it.
              mode === 'glance' && 'absolute inset-x-0 bottom-full z-10 mb-1 w-max max-w-full'
            )}
            aria-label={`Actions for ${selected}`}
          >
            <strong className="mr-1 min-w-0 flex-1 truncate text-ink" title={selected}>{selected}</strong>
            <button type="button" onClick={() => requestGameAction(`look ${target}`, `Look at ${selected}`)} className="rounded border border-border px-1.5 py-0.5 text-ink-muted hover:text-ink" title={`Look at ${selected}`}>Look</button>
            <button type="button" disabled={!canSend} onClick={() => take(selected)} className="rounded border border-border px-1.5 py-0.5 text-ink-muted hover:text-accent disabled:opacity-40" title={reason ?? `get ${nounOf(selected)}`}>Get</button>
            <button type="button" onClick={() => requestGameAction(`appraise ${target} quick`, `Appraise ${selected}`)} className="rounded border border-border px-1.5 py-0.5 text-ink-muted hover:text-ink" title={`Quick-appraise ${selected}`}>Appraise</button>
            <button type="button" onClick={() => requestGameAction(`analyze ${target}`, `Analyze ${selected}`)} className="rounded border border-border px-1.5 py-0.5 text-ink-muted hover:text-ink" title={`Analyze ${selected}`}>Analyze</button>
            <a href={wikiUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded border border-info/40 px-1.5 py-0.5 text-info hover:bg-info/10" title={`Search Elanthipedia for ${selected}`}><BookOpen className="h-3 w-3" /> Elanthipedia <ExternalLink className="h-3 w-3" /></a>
            <button type="button" onClick={() => setSelected(null)} className="rounded p-0.5 text-ink-faint hover:text-ink" title="Close item actions" aria-label="Close item actions"><X className="h-3.5 w-3.5" /></button>
          </div>
        )
      })()}
      {mode === 'browser' && reason && <p className="text-xs text-warn leading-snug">{reason}</p>}
      {mode === 'browser' && groups.length > 12 && (
        <label className="flex h-7 shrink-0 items-center gap-1 rounded border border-border bg-surface px-1.5 text-xs">
          <Search className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Find among ${groups.length} kinds / ${items.length} items…`} className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-faint" />
        </label>
      )}
    </div>
  )
}
