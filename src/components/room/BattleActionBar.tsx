import * as Icons from 'lucide-react'
import { cn } from '../../lib/cn'
import { MACROS, type Macro } from '../../data/macros'
import { useMacroRunner } from '../../lib/useMacroRunner'
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
  const macroDrag = useDragScroll()

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
      {reason && <p className="mt-1 text-xs leading-snug text-warn">{reason}</p>}
    </div>
  )
}
