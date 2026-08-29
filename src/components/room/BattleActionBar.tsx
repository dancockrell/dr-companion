import { useState } from 'react'
import * as Icons from 'lucide-react'
import { cn } from '../../lib/cn'
import { MACROS, type Macro } from '../../data/macros'
import { useMacroChoice } from '../../lib/useMacroChoice'
import { useMacroRunner } from '../../lib/useMacroRunner'

/**
 * One touch, in the pane where the fight actually is.
 *
 * `ActionsPanel`'s twelve-slot `MacroBar` already covers every one of these
 * commands, and still does — this is not a second catalog, it reads the same
 * `MACROS` and the same persisted `useMacroChoice` a player already set
 * there, through the same `useMacroRunner` gate `ActionsPanel` uses. What's
 * different is which subset gets a button here and how big that button is.
 * `MacroBar` is a scrolling row of twelve equal slots in the dashboard rail,
 * three columns over from the radar; reaching it mid-fight means looking
 * away from the picture that is telling you what's about to hit you. Combat,
 * hunting and health are the three groups a player actually reaches for
 * *during* a fight or the walk into one — goods, magic prep and travel are
 * between-fights business and stay where they already live.
 */
const GROUPS: Array<{ key: Macro['group']; label: string }> = [
  { key: 'combat', label: 'Combat' },
  { key: 'hunt', label: 'Hunt' },
  { key: 'health', label: 'Health' },
]

export function BattleActionBar() {
  const { macroChoice, setMacroChoice } = useMacroChoice()
  const { run, canSend, reason, character } = useMacroRunner()
  const [open, setOpen] = useState<string | null>(null)

  if (!character) return null

  const variationOf = (m: Macro) => m.variations.find((v) => v.id === macroChoice[m.id]) ?? m.variations[0]

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-2">
        {GROUPS.map(({ key, label }) => {
          const macros = MACROS.filter((m) => m.group === key)
          if (macros.length === 0) return null
          return (
            <div key={key} className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
                {label}
              </span>
              <div className="flex gap-1">
                {macros.map((m) => {
                  const v = variationOf(m)
                  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[m.icon] ?? Icons.Zap
                  const isOpen = open === m.id
                  return (
                    <div key={m.id} className="relative">
                      {/* Bigger than MacroBar's own slots on purpose — this
                          is the button a player reaches for with a fight
                          already on screen, not one they scan a row of
                          twelve to find. Icon over label, not beside it, so
                          eight of these still fit across a battle pane at
                          its default width without wrapping to a second
                          row. */}
                      <button
                        type="button"
                        disabled={!canSend}
                        onClick={() => run(v.commands)}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          setOpen(isOpen ? null : m.id)
                        }}
                        title={`${v.label} — ${v.commands.join(' ; ')}${v.note ? `\n${v.note}` : ''}${
                          m.variations.length > 1 ? `\nRight-click for ${m.variations.length} variations` : ''
                        }`}
                        className={cn(
                          'flex w-16 flex-col items-center gap-1 rounded border border-border px-1 py-1.5',
                          'text-ink-muted hover:border-ink-faint hover:text-ink',
                          'disabled:cursor-not-allowed disabled:opacity-40',
                          isOpen && 'border-accent text-accent'
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="text-xs leading-tight">{v.label}</span>
                      </button>

                      {isOpen && (
                        <div className="absolute top-full left-0 z-30 mt-1 w-52 rounded border border-border bg-surface-overlay p-1 shadow-lg">
                          {m.variations.map((alt) => (
                            <button
                              key={alt.id}
                              type="button"
                              onClick={() => {
                                setMacroChoice(m.id, alt.id)
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
            </div>
          )
        })}
      </div>

      {/* Same reasoning as ActionsPanel's own: a disabled row that says
          nothing is a row that teaches its rule by refusing you. */}
      {reason && <p className="text-xs text-warn leading-snug">{reason}</p>}
    </div>
  )
}
