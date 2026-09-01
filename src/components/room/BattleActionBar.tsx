import { useEffect, useMemo, useState } from 'react'
import * as Icons from 'lucide-react'
import { cn } from '../../lib/cn'
import { MACROS, type Macro } from '../../data/macros'
import { useMacroRunner } from '../../lib/useMacroRunner'
import { useAppStore } from '../../store/useAppStore'
import { getScriptCatalogEntry } from '../../data/scriptCatalog'
import { inferScriptIcon } from '../../lib/scriptIcons'
import { SCRIPT_ICON_COMPONENT } from '../../lib/scriptIconComponents'
import { pythonStatus, type TaskInfo } from '../../lib/pythonTasks'
import { nodeStatus } from '../../lib/nodeTasks'
import { requestStartFlow } from '../../lib/flowStop'
import { useDragScroll } from '../../lib/useDragScroll'

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

const CLUSTER_TONES = [
  'border-danger/55', 'border-good/55', 'border-warn/55', 'border-info/55',
  'border-accent/55', 'border-purple-400/55', 'border-cyan-400/55', 'border-pink-400/55',
]

function clusterTone(name: string) {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return CLUSTER_TONES[hash % CLUSTER_TONES.length]
}

function variationIcon(macro: Macro, label: string, commands: string[]): Icons.LucideIcon {
  const text = `${label} ${commands.join(' ')}`.toLowerCase()
  const matches: Array<[RegExp, Icons.LucideIcon]> = [
    [/retreat twice/, Icons.ChevronsLeft], [/retreat/, Icons.ChevronLeft], [/flee/, Icons.LogOut],
    [/advance|engage/, Icons.MoveUpRight], [/aimed|aim/, Icons.Crosshair], [/ambush/, Icons.BetweenHorizontalEnd],
    [/defensive/, Icons.ShieldCheck], [/guarded|stance/, Icons.ShieldHalf], [/offensive/, Icons.Swords],
    [/find an empath/, Icons.UserRoundSearch], [/go to healer/, Icons.Hospital], [/sleep/, Icons.BedSingle],
    [/diagnose/, Icons.Stethoscope], [/wounds?/, Icons.Bandage], [/tend/, Icons.HandHeart], [/heal|health/, Icons.HeartPulse],
    [/stop stalking/, Icons.Eye], [/stalk/, Icons.Footprints], [/sneak/, Icons.MousePointer2], [/hide/, Icons.EyeOff],
    [/skin/, Icons.Bone], [/coins only/, Icons.Coins], [/take all/, Icons.PackagePlus], [/stow all/, Icons.ArchiveRestore],
    [/loot/, Icons.PackageOpen], [/wealth/, Icons.WalletCards], [/bank/, Icons.Landmark], [/appraise/, Icons.Scale],
    [/harness/, Icons.Orbit], [/prepare/, Icons.Sparkles], [/release/, Icons.WandSparkles],
    [/buffs?/, Icons.ShieldPlus], [/active spells?/, Icons.ListChecks], [/refresh/, Icons.RefreshCw],
    [/town run/, Icons.Building2], [/safe room/, Icons.House], [/guild/, Icons.GraduationCap], [/travel/, Icons.Route],
    [/exits?/, Icons.SignpostBig], [/experience/, Icons.TrendingUp], [/learning/, Icons.Brain], [/skills?/, Icons.ChartNoAxesColumnIncreasing],
    [/tdps?/, Icons.BadgePlus], [/inventory/, Icons.Backpack], [/yourself/, Icons.UserRound], [/who/, Icons.UsersRound],
    [/perceive/, Icons.ScanEye], [/search/, Icons.ScanSearch], [/look/, Icons.Eye],
    [/throw/, Icons.CircleDotDashed], [/parry/, Icons.Swords], [/block|shield/, Icons.ShieldCheck],
    [/dodge|evade/, Icons.Wind], [/north/, Icons.ArrowUp], [/south/, Icons.ArrowDown],
    [/east/, Icons.ArrowRight], [/west/, Icons.ArrowLeft], [/climb/, Icons.Mountain],
    [/go |walk/, Icons.Navigation], [/cast|spell|mana/, Icons.WandSparkles],
    [/assess/, Icons.ClipboardCheck], [/attack|jab|slice|swing|thrust|lunge/, Icons.Sword],
  ]
  const match = matches.find(([pattern]) => pattern.test(text))
  return match?.[1] ?? (Icons as unknown as Record<string, Icons.LucideIcon>)[macro.icon] ?? Icons.Zap
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
  const scriptCatalog = useAppStore((s) => s.scriptCatalog)
  const runningScripts = useAppStore((s) => s.runningScripts)
  const activeFlow = useAppStore((s) => s.activeFlow)
  const listScripts = useAppStore((s) => s.listScripts)
  const startScript = useAppStore((s) => s.startScript)
  const [filter, setFilter] = useState('')
  const [category, setCategory] = useState('All')
  const [tasks, setTasks] = useState<Array<TaskInfo & { lang: 'python' | 'typescript' }>>([])
  const macroDrag = useDragScroll()
  const scriptDrag = useDragScroll()

  useEffect(() => {
    if (scriptCatalog === null) listScripts()
    void Promise.all([pythonStatus(), nodeStatus()]).then(([python, node]) =>
      setTasks([
        ...python.tasks.map((task) => ({ ...task, lang: 'python' as const })),
        ...node.tasks.map((task) => ({
          ...task,
          category: 'TypeScript',
          lang: 'typescript' as const,
        })),
      ])
    )
  }, [listScripts, scriptCatalog])

  const visibleTasks = useMemo(() => {
    const query = filter.trim().toLowerCase()
    return tasks.filter((task) => !query || `${task.title} ${task.summary} ${task.category}`.toLowerCase().includes(query))
  }, [filter, tasks])

  const visibleScripts = useMemo(() => {
    const query = filter.trim().toLowerCase()
    return (scriptCatalog ?? []).filter((name) => {
      const entry = getScriptCatalogEntry(name)
      return entry.tier !== 'hidden' && (!query || `${name} ${entry.label ?? ''} ${entry.description ?? ''} ${entry.category}`.toLowerCase().includes(query))
    })
  }, [filter, scriptCatalog])
  const categories = useMemo(() => {
    const names = new Set<string>()
    tasks.forEach((task) => names.add(task.category || 'Workflows'))
    ;(scriptCatalog ?? []).forEach((name) => {
      const entry = getScriptCatalogEntry(name)
      if (entry.tier !== 'hidden') names.add(entry.category || 'Other')
    })
    return ['All', ...[...names].sort((a, b) => a.localeCompare(b))]
  }, [scriptCatalog, tasks])
  const categoryTasks = category === 'All' ? visibleTasks : visibleTasks.filter((task) => (task.category || 'Workflows') === category)
  const categoryScripts = category === 'All' ? visibleScripts : visibleScripts.filter((name) => (getScriptCatalogEntry(name).category || 'Other') === category)

  if (!character) return null

  return (
    <div className="relative">
      <div
        ref={macroDrag.ref}
        className={cn('no-scrollbar flex touch-none items-start gap-0.5 overflow-x-auto', macroDrag.dragging ? 'cursor-grabbing select-none' : 'cursor-grab')}
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
              className={cn('flex shrink-0 gap-0.5 border-l-2', GROUP_TONE[group], groupIndex === 0 && 'border-l-0')}
              aria-label={`${group} commands`}
            >
              {macros.flatMap((macro) => {
                return macro.variations.map((variation, variationIndex) => (
                  <button
                    key={`${macro.id}:${variation.id}`}
                    type="button"
                    disabled={!canSend}
                    onClick={() => run(variation.commands)}
                    title={`${variation.label}${variation.note ? ` — ${variation.note}` : ''}\n${variation.commands.join(' ; ')}`}
                    aria-label={`${variation.label}: ${variation.commands.join('; ')}`}
                    className={cn(
                      'relative grid h-9 w-9 place-items-center rounded border border-border bg-surface text-ink-muted hover:border-ink-faint hover:bg-surface-overlay hover:text-ink focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40',
                      macro.id === 'attack' && variationIndex === 0 && 'border-danger/70 bg-danger/10 text-danger'
                    )}
                  >
                    {(() => {
                      const Icon = variationIcon(macro, variation.label, variation.commands)
                      return <Icon className="h-[18px] w-[18px]" aria-hidden />
                    })()}
                    {macro.variations.length > 1 && (
                      <span className="absolute bottom-0.5 right-0.5 h-1 w-1 rounded-full bg-current opacity-45" aria-hidden />
                    )}
                  </button>
                ))
              })}
            </div>
          )
        })}
      </div>
      <div className="mt-1 border-t border-border/70 pt-1" aria-label="Scripts and workflows">
        <div
          ref={scriptDrag.ref}
          className={cn('no-scrollbar touch-none overflow-x-auto', scriptDrag.dragging ? 'cursor-grabbing select-none' : 'cursor-grab')}
          onPointerDown={scriptDrag.onPointerDown}
          onPointerMove={scriptDrag.onPointerMove}
          onPointerUp={scriptDrag.onPointerUp}
          onPointerCancel={scriptDrag.onPointerCancel}
        >
          <div className="flex w-max gap-0.5" aria-label={`${category} scripts and workflows`}>
            {categoryTasks.map((task) => {
              const Icon = SCRIPT_ICON_COMPONENT[inferScriptIcon(task.title, task.summary)]
              const running = activeFlow === task.id
              const taskCategory = task.category || 'Workflows'
              return (
                <button
                  key={`${task.lang}:${task.id}`}
                  type="button"
                  onClick={() => requestStartFlow(task.id, task.lang)}
                  title={`${task.title} — ${task.summary}\n${task.kind}`}
                  aria-label={`Run workflow: ${task.title}`}
                  aria-pressed={running}
                  className={cn('grid h-8 w-8 place-items-center rounded-sm border border-l-2 border-border bg-surface text-ink-muted hover:bg-accent/10 hover:text-accent focus-visible:outline-2 focus-visible:outline-accent', clusterTone(taskCategory), running && 'border-good bg-good/15 text-good')}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                </button>
              )
            })}
            {categoryScripts.map((name) => {
              const entry = getScriptCatalogEntry(name)
              const Icon = SCRIPT_ICON_COMPONENT[inferScriptIcon(name, entry.description ?? '')]
              const running = runningScripts.some((runningName) => runningName.toLowerCase() === name.toLowerCase())
              const scriptCategory = entry.category || 'Other'
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => startScript(name)}
                  title={`${entry.label ?? name} — ${entry.description ?? entry.category}\nLich script: ${name}`}
                  aria-label={`Run Lich script: ${entry.label ?? name}`}
                  aria-pressed={running}
                  className={cn('grid h-8 w-8 place-items-center rounded-sm border border-l-2 border-border bg-surface text-ink-muted hover:bg-purple-400/10 hover:text-purple-300 focus-visible:outline-2 focus-visible:outline-accent', clusterTone(scriptCategory), running && 'border-good bg-good/15 text-good')}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                </button>
              )
            })}
          </div>
        </div>
        <div className="mt-1 flex items-center gap-1 border-t border-border/50 pt-1">
          <Icons.Search className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={`Find ${tasks.length + (scriptCatalog?.length ?? 0)} scripts and workflows`}
            aria-label="Find a script or workflow"
            className="h-7 min-w-0 flex-1 rounded border border-border bg-surface px-2 text-xs text-ink outline-none placeholder:text-ink-faint focus:border-accent"
          />
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            aria-label="Script category"
            className="h-7 max-w-36 rounded border border-border bg-surface px-1 text-xs text-ink-muted outline-none focus:border-accent"
          >
            {categories.map((name) => <option key={name}>{name}</option>)}
          </select>
          <span className="shrink-0 text-xs tabular-nums text-ink-faint">{categoryTasks.length + categoryScripts.length}</span>
        </div>
      </div>
      {reason && <p className="mt-1 text-xs leading-snug text-warn">{reason}</p>}
    </div>
  )
}
