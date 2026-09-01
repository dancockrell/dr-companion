import { cn } from '../../lib/cn'
import { MACROS, type Macro } from '../../data/macros'
import { useMacroRunner } from '../../lib/useMacroRunner'
import { useDragScroll } from '../../lib/useDragScroll'
import { actionAccent, actionIcon } from '../../lib/battleActionVisuals'
import { scrollableRegionProps } from '../../lib/scrollableRegion'

const GROUPS: Macro['group'][] = ['combat', 'health', 'hunt', 'goods', 'magic', 'travel', 'info']

const GROUP_TONE: Partial<Record<Macro['group'], string>> = {
  combat: 'border-danger/45',
  health: 'border-good/40',
  hunt: 'border-warn/40',
  goods: 'border-accent/40',
  magic: 'border-purple-400/40',
  travel: 'border-info/40',
  info: 'border-slate-400/40',
}


/**
 * Dense direct access, not a toolbar of menus. Every variation is a button of
 * its own: the icon field can grow to dozens of actions without spending the
 * battlespace on labels, padding, headers, or little dropdown hit targets.
 * Full names, notes, and exact commands remain on hover/focus and in the
 * accessible label; clicking always runs the variation shown by that button.
 */
export function BattleActionBar() {
  const { run, canSend, reason, character } = useMacroRunner()
  const macroDrag = useDragScroll()

  if (!character) return null

  return (
    <div className="relative">
      <div
        {...scrollableRegionProps('Battle commands', 'horizontal')}
        ref={macroDrag.ref}
        className={cn('flex items-start gap-1 overflow-x-auto', macroDrag.dragging ? 'cursor-grabbing select-none' : 'cursor-grab')}
        aria-label="Battle commands"
        onPointerDown={macroDrag.onPointerDown}
        onPointerMove={macroDrag.onPointerMove}
        onPointerUp={macroDrag.onPointerUp}
        onPointerCancel={macroDrag.onPointerCancel}
      >
        {GROUPS.map((group, groupIndex) => {
          const macros = MACROS.filter((macro) => macro.group === group)
          return (
            <div
              key={group}
              className={cn('grid shrink-0 grid-flow-col grid-rows-2 gap-0.5 border-l-2 pl-1', GROUP_TONE[group], groupIndex === 0 && 'border-l-0 pl-0')}
              aria-label={`${group} commands`}
            >
              {macros.flatMap((macro) => {
                return macro.variations.map((variation) => {
                  const actionKey = `${macro.id}:${variation.id}`
                  const Icon = actionIcon(actionKey)
                  return (
                  <button
                    key={actionKey}
                    type="button"
                    disabled={!canSend}
                    onClick={() => run(variation.commands)}
                    title={`${variation.label}${variation.note ? ` — ${variation.note}` : ''}\nRuns: ${variation.commands.join(' ; ')}`}
                    aria-label={`${variation.label}: ${variation.commands.join('; ')}`}
                    data-action={actionKey}
                    className="relative grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded border transition duration-150 hover:-translate-y-px hover:brightness-125 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-accent active:translate-y-0 active:scale-95 disabled:cursor-not-allowed disabled:opacity-35 disabled:saturate-0"
                    style={actionAccent(actionKey)}
                  >
                    <span className="absolute inset-x-1 top-0 h-px bg-current opacity-45" aria-hidden />
                    <Icon className="h-4 w-4 drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]" aria-hidden />
                    {macro.variations.length > 1 && (
                      <span className="absolute bottom-0.5 right-0.5 h-1 w-1 rotate-45 rounded-[1px] bg-current opacity-65" aria-hidden />
                    )}
                  </button>
                  )
                })
              })}
            </div>
          )
        })}
      </div>
      {reason && <p className="mt-1 text-xs leading-snug text-warn">{reason}</p>}
    </div>
  )
}
