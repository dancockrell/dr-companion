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
 * different is which subset gets a button here: `MacroBar` is a scrolling
 * row of twelve equal slots in the dashboard rail, three columns over from
 * the radar; reaching it mid-fight means looking away from the picture
 * that is telling you what's about to hit you. Combat, hunting and health
 * are the three groups a player actually reaches for *during* a fight or
 * the walk into one — goods, magic prep and travel are between-fights
 * business and stay where they already live.
 *
 * Deliberately the same pill — icon, label, one row, no group headers —
 * `MacroBar` already uses, not a bigger bespoke button of its own. A first
 * pass gave this bar its own larger icon-over-label style with a heading
 * over each of the three groups, on the reasoning that a battle-pane
 * button should read as more important. Looking at it next to the rest of
 * the app said the opposite: three uppercase labels and eight boxy tiles
 * stacked under a picture, a description box and a status strip read as a
 * cramped instrument panel, not "the same app, one more button row." One
 * unlabeled scrolling row, sized like every other macro button in this
 * app, says what it does without needing a caption to justify itself.
 */
const GROUPS: Macro['group'][] = ['combat', 'hunt', 'health']

export function BattleActionBar() {
  const { macroChoice, setMacroChoice } = useMacroChoice()
  const { run, canSend, reason, character } = useMacroRunner()
  const [open, setOpen] = useState<string | null>(null)

  if (!character) return null

  const macros = MACROS.filter((m) => GROUPS.includes(m.group))
  const variationOf = (m: Macro) => m.variations.find((v) => v.id === macroChoice[m.id]) ?? m.variations[0]

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        {macros.map((m) => {
          const v = variationOf(m)
          const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[m.icon] ?? Icons.Zap
          const isOpen = open === m.id
          return (
            <div key={m.id} className="relative">
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
                  'flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs',
                  'text-ink-muted hover:border-ink-faint hover:text-ink',
                  'disabled:cursor-not-allowed disabled:opacity-40',
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

      {/* Same reasoning as ActionsPanel's own: a disabled row that says
          nothing is a row that teaches its rule by refusing you. */}
      {reason && <p className="text-xs text-warn leading-snug">{reason}</p>}
    </div>
  )
}
