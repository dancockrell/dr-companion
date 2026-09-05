import { useRef, useState } from 'react'
import {
  Activity,
  Brain,
  Coins,
  Eye,
  EyeOff,
  Footprints,
  Heart,
  Navigation,
  Package,
  Search,
  Shield,
  ShieldOff,
  Sparkles,
  Star,
  Swords,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '../../lib/cn.ts'
import { useScrollEdges } from '../../lib/useScrollEdges.ts'
import { MACROS, type Macro } from '../../data/macros.ts'

/**
 * The lucide component behind each macro's `icon` name.
 *
 * Was `(Icons as Record<string, LucideIcon>)[m.icon]` against a namespace
 * import of the whole package - a runtime string lookup defeats
 * tree-shaking, so every lucide icon shipped in the startup bundle to
 * render the 15 named here. `MACROS` is a fixed, in-repo list (`data/
 * macros.ts`), not player or bridge data, so the set of names this ever
 * needs to resolve is closed and known at build time - the same reasoning
 * `scriptIconComponents.ts` already applies to script icons, one file over.
 */
const MACRO_ICON: Record<string, LucideIcon> = {
  Activity,
  Brain,
  Coins,
  Eye,
  EyeOff,
  Footprints,
  Heart,
  Navigation,
  Package,
  Search,
  Shield,
  ShieldOff,
  Sparkles,
  Star,
  Swords,
}

/**
 * The macro bar.
 *
 * Replaces four buttons spread across the full width of the window — Healer,
 * Loot, Buffs, Safe — which spent about ten percent of the viewport saying
 * four words. Twelve slots now, each with variations behind it, in the same
 * height.
 *
 * It scrolls sideways and shows no scrollbar. A scrollbar under a row of
 * 28px buttons is furniture taller than the thing it scrolls, and the
 * overflow is discoverable by dragging or with a wheel over the row. Edge
 * fades say there is more without spending a row on saying it.
 *
 * Those fades are the whole affordance, since the scrollbar is gone, so they
 * have to be true: one at each end, each shown only while there is actually
 * something past it. See the note on `edges` - the first version was a single
 * fade on the right that was always lit, which is the same amount of
 * information as no fade at all.
 *
 * Right-click a slot to change which variation it runs. That choice is the
 * customisation: the defaults are opinions, not decisions, and a player who
 * always tends rather than walking to a healer should be able to say so once.
 */
export function MacroBar({
  choice,
  onChoose,
  onRun,
  disabled,
}: {
  /** Which variation each slot currently runs, by macro id. */
  choice: Record<string, string>
  onChoose: (macroId: string, variationId: string) => void
  onRun: (commands: string[]) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState<string | null>(null)

  /* Which edges actually have something past them. See useScrollEdges - the
   * measurement lives there now because MapToolRail needs the same answer and
   * a second copy is a second thing to get wrong. */
  const scroller = useRef<HTMLDivElement>(null)
  const { edges, onScroll } = useScrollEdges(scroller)

  const variationOf = (m: Macro) =>
    m.variations.find((v) => v.id === choice[m.id]) ?? m.variations[0]

  return (
    <div className="relative min-w-0">
      <div
        ref={scroller}
        onScroll={onScroll}
        className={cn(
          'flex gap-1 overflow-x-auto pb-0.5',
          // No scrollbar. The row is shorter than a scrollbar would be.
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
        )}
      >
        {MACROS.map((m) => {
          const v = variationOf(m)
          const Icon = MACRO_ICON[m.icon] ?? Zap
          const isOpen = open === m.id

          return (
            <div key={m.id} className="relative shrink-0">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onRun(v.commands)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setOpen(isOpen ? null : m.id)
                }}
                title={`${v.label} — ${v.commands.join(' ; ')}${v.note ? `\n${v.note}` : ''}${
                  m.variations.length > 1 ? `\nRight-click for ${m.variations.length} variations` : ''
                }`}
                className={cn(
                  'flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs',
                  'text-ink-muted hover:border-ink-faint hover:text-ink',
                  'disabled:opacity-40',
                  isOpen && 'border-accent text-accent'
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="whitespace-nowrap">{v.label}</span>
              </button>

              {isOpen && (
                <div className="absolute bottom-full left-0 z-30 mb-1 w-52 rounded border border-border bg-surface-overlay p-1 shadow-lg">
                  {m.variations.map((alt) => (
                    <button
                      key={alt.id}
                      type="button"
                      onClick={() => {
                        onChoose(m.id, alt.id)
                        setOpen(null)
                      }}
                      className={cn(
                        'flex w-full flex-col items-start rounded px-1.5 py-1 text-left',
                        alt.id === v.id ? 'bg-accent/15 text-accent' : 'hover:bg-surface-raised'
                      )}
                    >
                      <span className="text-xs text-ink">{alt.label}</span>
                      {alt.note && <span className="text-xs text-ink-faint">{alt.note}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Says there is more, only when there is. Both edges, because after a
        * scroll the macros you cannot see are the ones behind you. */}
      {edges.start && (
        <span className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-surface to-transparent" />
      )}
      {edges.end && (
        <span className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-surface to-transparent" />
      )}
    </div>
  )
}
