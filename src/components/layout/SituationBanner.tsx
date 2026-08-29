/**
 * Urgent situation strip — low health, combat, dead, etc.
 * Shown above the dashboard body so a 10-year-old still sees "you're hurt".
 *
 * There is no Stop button here any more. The in-combat banner used to carry
 * one, which made three Stops in the app all sending `stop_all`. This strip
 * says what is happening; the bar at the bottom of the window is what you press
 * about it, and that bar is on screen whether or not this strip is.
 *
 * The room the button left is spent on numbers rather than given back. "Health
 * is low" is a judgement the app made; 34 of 118 is the reading it made it
 * from, and the reading is what decides whether you walk to a healer or run.
 */
import type { IntentName } from '../../bridge/types'
import { AlertTriangle, Heart, Swords, Skull, RotateCcw } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { isLowHealth } from '../../lib/vitals'

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
  const lowHealth = flags.includes('low_health') || isLowHealth(character)
  const inCombat = flags.includes('in_combat')
  const dead = flags.includes('dead') || flags.includes('dying')

  if (!lowHealth && !inCombat && !dead && flags.length === 0) return null

  let tone = 'bg-warn/15 border-warn/40 text-warn'
  let icon = <AlertTriangle className="w-4 h-4 shrink-0" />
  let title = 'Attention'
  let action: { label: string; intent: IntentName } | null = null
  let reading: string | null = null

  if (dead) {
    tone = 'bg-danger/20 border-danger/50 text-danger'
    icon = <Skull className="w-4 h-4 shrink-0" />
    title = 'You are down — get help'
    reading = `${character.vitals.spirit} of ${character.vitals.spiritMax} spirit`
    action = autoSuggestHealer
      ? { label: 'Go to Healer', intent: 'go_healer' }
      : null
  } else if (lowHealth) {
    tone = 'bg-danger/15 border-danger/40 text-danger'
    icon = <Heart className="w-4 h-4 shrink-0" />
    title = 'Health is low'
    reading = `${character.vitals.health} of ${character.vitals.healthMax} health`
    action = autoSuggestHealer
      ? { label: 'Go to Healer', intent: 'go_healer' }
      : null
  } else if (inCombat) {
    tone = 'bg-warn/15 border-warn/40 text-warn'
    icon = <Swords className="w-4 h-4 shrink-0" />
    title = 'In combat'
    // No Stop here. It lives in the bar at the bottom of the window, alone.
    reading = `${character.vitals.health} of ${character.vitals.healthMax} health`
  }

  const detail = [reading, ...flags.map((f) => f.replace(/_/g, ' '))].filter(
    Boolean
  )

  return (
    <div
      className={`mx-3 mt-2 mb-0 rounded-xl border px-3 py-2 flex items-center gap-2 text-sm ${tone}`}
    >
      {icon}
      <div className="flex-1 min-w-0">
        <div className="font-semibold leading-tight">{title}</div>
        {detail.length > 0 && (
          <div className="text-xs opacity-80 truncate">
            {detail.join(' · ')}
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
