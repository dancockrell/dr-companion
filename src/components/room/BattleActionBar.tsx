import { useState } from 'react'
import { cn } from '../../lib/cn'
import { MACROS, type Macro } from '../../data/macros'
import { useMacroRunner } from '../../lib/useMacroRunner'
import { useDragScroll } from '../../lib/useDragScroll'
import { actionAccent, actionIcon } from '../../lib/battleActionVisuals'
import { scrollableRegionProps } from '../../lib/scrollableRegion'

const GROUPS: Macro['group'][] = ['combat', 'health', 'hunt', 'goods', 'magic', 'travel', 'info']

const GROUP_LABEL: Record<Macro['group'], string> = {
  combat: 'Fight',
  health: 'Heal',
  hunt: 'Hunt',
  goods: 'Items',
  magic: 'Magic',
  travel: 'Travel',
  info: 'Info',
}

const GROUP_TONE: Partial<Record<Macro['group'], string>> = {
  combat: 'border-danger/45',
  health: 'border-good/40',
  hunt: 'border-warn/40',
  goods: 'border-accent/40',
  magic: 'border-magic/40',
  travel: 'border-info/40',
  info: 'border-info/40',
}


/**
 * Dense direct access with visible group names and an immediate explanation.
 * Every variation remains a one-click button, while search and the shared
 * detail panel make an unfamiliar command discoverable without memorising the
 * icon set or waiting for a browser tooltip.
 */
export function BattleActionBar() {
  const { run, canSend, reason, character } = useMacroRunner()
  const macroDrag = useDragScroll()
  const [query, setQuery] = useState('')
  const [explained, setExplained] = useState<{
    actionKey: string
    group: Macro['group']
    label: string
    note?: string
    commands: string[]
  } | null>(null)

  if (!character) return null

  return (
    <div className="relative">
      <label className="mb-1 flex items-center gap-2 text-xs text-ink-muted">
        <span className="shrink-0">Find action</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name or command"
          className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 text-xs text-ink outline-none placeholder:text-ink-faint focus:border-accent"
        />
      </label>
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
          const needle = query.trim().toLowerCase()
          const macros = MACROS.filter((macro) => macro.group === group)
            .map((macro) => ({
              ...macro,
              variations: macro.variations.filter((variation) => !needle ||
                `${variation.label} ${variation.note ?? ''} ${variation.commands.join(' ')}`.toLowerCase().includes(needle)),
            }))
            .filter((macro) => macro.variations.length > 0)
          if (macros.length === 0) return null
          return (
            <div
              key={group}
              className={cn('shrink-0 border-l-2 pl-1', GROUP_TONE[group], groupIndex === 0 && 'border-l-0 pl-0')}
              aria-label={`${group} commands`}
            >
              <p className="mb-0.5 px-0.5 text-xs font-semibold text-ink-muted">{GROUP_LABEL[group]}</p>
              <div className="grid grid-flow-col grid-rows-2 gap-0.5">
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
                    onMouseEnter={() => setExplained({ actionKey, group, label: variation.label, note: variation.note, commands: variation.commands })}
                    onMouseLeave={() => setExplained((current) => current?.actionKey === actionKey ? null : current)}
                    onFocus={() => setExplained({ actionKey, group, label: variation.label, note: variation.note, commands: variation.commands })}
                    onBlur={() => setExplained((current) => current?.actionKey === actionKey ? null : current)}
                    title={`${variation.label}${variation.note ? ` — ${variation.note}` : ''}\nRuns: ${variation.commands.join(' ; ')}`}
                    aria-label={`${variation.label}: ${variation.commands.join('; ')}`}
                    data-action={actionKey}
                    data-game-shape={group}
                    className="game-icon-button relative grid h-9 w-9 shrink-0 place-items-center transition duration-150 focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-35 disabled:saturate-0"
                    style={actionAccent(actionKey)}
                  >
                    <span className="absolute inset-x-2 top-0.5 h-px bg-current opacity-60" aria-hidden />
                    <Icon className="relative z-10 h-5 w-5 drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]" strokeWidth={1.85} aria-hidden />
                    {macro.variations.length > 1 && (
                      <span className="absolute bottom-0.5 right-0.5 h-1 w-1 rotate-45 rounded-[1px] bg-current opacity-65" aria-hidden />
                    )}
                  </button>
                  )
                })
              })}
              </div>
            </div>
          )
        })}
      </div>
      {query.trim() && !MACROS.some((macro) => macro.variations.some((variation) =>
        `${variation.label} ${variation.note ?? ''} ${variation.commands.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))) && (
        <p className="mt-1 text-xs text-ink-muted">No action matches “{query.trim()}”.</p>
      )}
      <div className="mt-1 min-h-11 rounded border border-border/70 bg-surface px-2 py-1 text-xs" aria-live="polite">
        {explained ? <>
          <p className="font-semibold text-ink">{explained.label} <span className="font-normal text-ink-faint">· {GROUP_LABEL[explained.group]}</span></p>
          {explained.note && <p className="text-ink-muted">{explained.note}</p>}
          <p className="font-mono text-ink-faint">Runs: {explained.commands.join(' ; ')}</p>
        </> : <p className="text-ink-faint">Hover or focus an action to see its name, requirement, and exact command.</p>}
      </div>
      {reason && <p className="mt-1 text-xs leading-snug text-warn">{reason}</p>}
    </div>
  )
}
