/**
 * Urgent situation strip — low health, combat, dead, etc.
 * Shown above the dashboard body so a 10-year-old still sees "you're hurt".
 */
import { AlertTriangle, Heart, Swords, Skull, RotateCcw } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'

export function SituationBanner() {
  const character = useAppStore((s) => s.character)
  const requestIntent = useAppStore((s) => s.requestIntent)
  const autoSuggestHealer = useAppStore((s) => s.autoSuggestHealer)
  const runawayReason = useAppStore((s) => s.runawayReason)
  const clearRunaway = useAppStore((s) => s.clearRunaway)

  // A self-stop outranks everything else on this strip. The character has been
  // repeating itself, which is both useless and the thing that gets noticed.
  if (runawayReason) {
    return (
      <div className="mx-3 mt-2 rounded-xl border px-3 py-2 flex items-start gap-2 text-sm bg-danger/15 border-danger/40 text-danger">
        <RotateCcw className="w-4 h-4 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold leading-tight">
            Stopped itself: it was going in circles
          </div>
          <div className="text-xs opacity-80 leading-snug">
            {runawayReason}. Nothing was being achieved, so it stopped rather
            than keep going. Check the console before restarting.
          </div>
        </div>
        <button
          type="button"
          className="shrink-0 text-xs font-semibold rounded-lg px-2.5 py-1.5 bg-surface/80 border border-border hover:bg-surface"
          onClick={clearRunaway}
        >
          Dismiss
        </button>
      </div>
    )
  }

  if (!character) return null

  const flags = character.situation
  const lowHealth =
    flags.includes('low_health') ||
    character.vitals.health / character.vitals.healthMax < 0.35
  const inCombat = flags.includes('in_combat')
  const dead = flags.includes('dead') || flags.includes('dying')

  if (!lowHealth && !inCombat && !dead && flags.length === 0) return null

  let tone = 'bg-warn/15 border-warn/40 text-warn'
  let icon = <AlertTriangle className="w-4 h-4 shrink-0" />
  let title = 'Attention'
  let action: { label: string; intent: string } | null = null

  if (dead) {
    tone = 'bg-danger/20 border-danger/50 text-danger'
    icon = <Skull className="w-4 h-4 shrink-0" />
    title = 'You are down — get help'
    action = autoSuggestHealer
      ? { label: 'Go to Healer', intent: 'go_healer' }
      : null
  } else if (lowHealth) {
    tone = 'bg-danger/15 border-danger/40 text-danger'
    icon = <Heart className="w-4 h-4 shrink-0" />
    title = 'Health is low'
    action = autoSuggestHealer
      ? { label: 'Go to Healer', intent: 'go_healer' }
      : null
  } else if (inCombat) {
    tone = 'bg-warn/15 border-warn/40 text-warn'
    icon = <Swords className="w-4 h-4 shrink-0" />
    title = 'In combat'
    action = { label: 'Stop', intent: 'stop_all' }
  }

  return (
    <div
      className={`mx-3 mt-2 mb-0 rounded-xl border px-3 py-2 flex items-center gap-2 text-sm ${tone}`}
    >
      {icon}
      <div className="flex-1 min-w-0">
        <div className="font-semibold leading-tight">{title}</div>
        {flags.length > 0 && (
          <div className="text-xs opacity-80 truncate">
            {flags.map((f) => f.replace(/_/g, ' ')).join(' · ')}
          </div>
        )}
      </div>
      {action && (
        <button
          type="button"
          className="shrink-0 text-xs font-semibold rounded-lg px-2.5 py-1.5 bg-surface/80 border border-border hover:bg-surface"
          onClick={() => requestIntent(action!.intent)}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
