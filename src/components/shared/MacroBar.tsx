import { useState } from 'react'
import * as Icons from 'lucide-react'
import { cn } from '../../lib/cn'
import { MACROS, type Macro } from '../../data/macros'

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

  const variationOf = (m: Macro) =>
    m.variations.find((v) => v.id === choice[m.id]) ?? m.variations[0]

  return (
    <div className="relative min-w-0">
      <div
        className={cn(
          'flex gap-1 overflow-x-auto pb-0.5',
          // No scrollbar. The row is shorter than a scrollbar would be.
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
        )}
      >
        {MACROS.map((m) => {
          const v = variationOf(m)
          const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[m.icon] ?? Icons.Zap
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
                title={`${v.label} — ${v.commands.join(' ; ')}${v.note ? `\n${v.note}` : ''}\nRight-click for ${m.variations.length} variations`}
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

      {/* Says there is more without spending a row on saying it. */}
      <span className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-surface to-transparent" />
    </div>
  )
}
