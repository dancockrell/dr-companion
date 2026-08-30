/**
 * Fast switching between activities — pinned Python tasks and raw scripts,
 * one keypress or click away, in the fixed window chrome rather than a
 * scrolling panel.
 *
 * Started as Task Flows only, back when a flow was TypeScript composed
 * client-side and driven by a timer. That engine is gone (see
 * `pythonTasks.ts`'s header) — a pinned task here is a Python task id,
 * started and stopped through the same `requestStartFlow`/`requestStopAll`
 * signals a flow used to use, which kept their names across that rewrite.
 *
 * Extended to pin raw scripts too, so a player's actual handful of
 * regulars — their hunting script, their bank run — get the same
 * one-keypress reach a task already had, instead of living behind the
 * Script Library's scroll and search box. A task and a script are different
 * things underneath (a task is a separate process this app can stop; a
 * script is Lich's own and this bar can only ask it to start — the bridge
 * already refuses a second start harmlessly, per server_test.rb's
 * "start_script refuses a script that is already running", so a pinned
 * running script's slot is simply inert rather than needing its own stop
 * path) but on the bar they read the same way: an icon, a tooltip, a
 * keypress.
 *
 * Drawn as an ability bar, not a row of labelled buttons: "think like
 * abilities in an MMORPG where you need icons and tooltips" was the exact
 * direction, and it is right for the same reason it is right in an MMO — at
 * fifty possible slots, a glyph is scannable at a glance and a row of text
 * labels is not. The label moves into a hover card instead, the way an
 * ability tooltip carries the full description a bar icon has no room for.
 *
 * Empty on purpose until something is pinned. A bar of icon-less boxes with
 * nothing behind any of them would be furniture nobody reads; the hint text
 * says how to fill one instead.
 */
import { useEffect, useState } from 'react'
import { Play, Terminal, type LucideIcon } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { pythonStatus, type TaskInfo } from '../../lib/pythonTasks'
import { requestStartFlow, requestStopAll } from '../../lib/flowStop'
import { KEYBOARD_SLOTS } from '../../lib/quickSwitch'
import { getScriptCatalogEntry } from '../../data/scriptCatalog'
import { cn } from '../../lib/cn'

/** What the bar actually needs to draw one slot, task or script alike. */
interface SlotView {
  key: string
  Icon: LucideIcon
  title: string
  summary: string
  active: boolean
  onClick: () => void
  footer: (keyed: boolean, i: number) => string
}

export function QuickSwitchBar() {
  const pins = useAppStore((s) => s.quickSwitchPins)
  const activeFlow = useAppStore((s) => s.activeFlow)
  const scriptStates = useAppStore((s) => s.scriptStates)
  const startScript = useAppStore((s) => s.startScript)
  const character = useAppStore((s) => s.character)

  // Fetched once, not on every render: unlike the old flow list (a handful
  // of localStorage reads), this is a Tauri invoke into a Python process.
  // A task pinned before the catalog resolves still renders — see the
  // fallback below — so there is nothing here that has to race the fetch.
  const [tasks, setTasks] = useState<TaskInfo[]>([])
  useEffect(() => {
    let cancelled = false
    void pythonStatus().then((s) => {
      if (!cancelled) setTasks(s.tasks)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const runningScripts = new Set(
    scriptStates
      .filter((s) => s.status === 'running' || s.status === 'paused')
      .map((s) => s.name.toLowerCase())
  )

  const slots: SlotView[] = pins.map((pin): SlotView => {
    if (pin.kind === 'task') {
      const task = tasks.find((t) => t.id === pin.id)
      const active = activeFlow === pin.id
      return {
        key: `task:${pin.id}`,
        Icon: Play,
        title: task?.title ?? pin.id,
        summary:
          task?.summary ??
          "This task's details haven't loaded from the bridge yet — press to try it anyway.",
        active,
        onClick: () => (active ? requestStopAll() : requestStartFlow(pin.id)),
        footer: (keyed, i) =>
          active ? 'Running — click to stop' : keyed ? `Key ${i + 1}, or click` : 'Click to start',
      }
    }

    // A script pin. Always startable, never toggled off from here — see
    // the module doc for why that asymmetry is fine rather than a gap.
    const entry = getScriptCatalogEntry(pin.name)
    const active = runningScripts.has(pin.name.toLowerCase())
    return {
      key: `script:${pin.name}`,
      Icon: Terminal,
      title: pin.name,
      summary: entry.description ?? 'Raw Lich script.',
      active,
      onClick: () => startScript(pin.name),
      footer: (keyed, i) =>
        active ? 'Already running' : keyed ? `Key ${i + 1}, or click` : 'Click to start',
    }
  })

  if (!character) return null

  if (slots.length === 0) {
    return (
      <div className="flex shrink-0 items-center gap-1.5 border-t border-border bg-surface px-3 py-1 text-xs text-ink-faint">
        <span>
          Quick Switch is empty — pin a task or a script (the star on each
          one) to jump between activities with a click or the number keys.
        </span>
      </div>
    )
  }

  return (
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-t border-border bg-surface px-2 py-1.5">
      {slots.map((slot, i) => {
        const keyed = i < KEYBOARD_SLOTS
        const Icon = slot.Icon
        return (
          // `group` carries hover/focus down to the tooltip card below,
          // which is a sibling rather than nested in the button — the same
          // reason TaskFlowPanel's pin star is a sibling of its button, and
          // it also means the tooltip's own text stays out of the button's
          // accessible name.
          <div key={slot.key} className="group relative shrink-0">
            <button
              type="button"
              onClick={slot.onClick}
              aria-label={`${slot.title}${slot.active ? ', running' : ''}`}
              className={cn(
                'relative flex h-10 w-10 items-center justify-center rounded-lg border transition-colors',
                slot.active
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-border bg-surface-raised text-ink-muted hover:border-ink-faint hover:text-ink'
              )}
            >
              <Icon className="h-5 w-5" />
              {keyed && (
                <span
                  className={cn(
                    'absolute -left-1 -top-1 rounded px-1 font-mono text-xs leading-tight tabular-nums',
                    slot.active ? 'bg-accent text-surface' : 'bg-surface-overlay text-ink-faint'
                  )}
                >
                  {i + 1}
                </span>
              )}
              {slot.active && (
                <span className="absolute -bottom-1 -right-1 h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
              )}
            </button>

            {/* The tooltip. An ability's full text: what it is, what it does
                right now, and how to reach it — the three things a bar icon
                alone cannot carry. Shown on hover or keyboard focus, never
                both a native title and this at once, so nothing doubles up
                for a screen reader or shows twice for a mouse user. */}
            <div
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-56 -translate-x-1/2 rounded-lg border border-border bg-surface-overlay p-2 text-left opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            >
              <div className="flex items-center gap-1.5">
                <Icon className={cn('h-4 w-4 shrink-0', slot.active ? 'text-accent' : 'text-ink-muted')} />
                <span className="truncate text-xs font-semibold text-ink">{slot.title}</span>
              </div>
              <p className="mt-1 text-xs leading-snug text-ink-muted">{slot.summary}</p>
              <p className="mt-1 text-xs text-ink-faint">{slot.footer(keyed, i)}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
