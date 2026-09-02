/**
 * Fast switching between activities — pinned Python or TypeScript tasks and raw scripts,
 * one keypress or click away, in the fixed window chrome rather than a
 * scrolling panel.
 *
 * Started as Task Flows only, back when a flow was TypeScript composed
 * client-side and driven by a timer. That engine is gone (see
 * `pythonTasks.ts`'s header) — a pinned task here carries its backend language
 * and bare id, then starts and stops through the same `requestStartFlow`/`requestStopAll`
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
import { Play, Terminal, X, type LucideIcon } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { useTaskCatalogs } from '../../lib/taskCatalogStatus'
import { requestStartFlow, requestStopAll } from '../../lib/flowStop'
import { KEYBOARD_SLOTS, taskPinActiveId, taskPinLanguage } from '../../lib/quickSwitch'
import { getScriptCatalogEntry } from '../../data/scriptCatalog'
import { cn } from '../../lib/cn'
import { MACROS } from '../../data/macros'
import { actionAccent, actionIcon } from '../../lib/battleActionVisuals'
import { useMacroRunner } from '../../lib/useMacroRunner'
import type { CSSProperties } from 'react'
import type { QuickSwitchPin } from '../../lib/quickSwitch'

/** What the bar actually needs to draw one slot, task or script alike. */
interface SlotView {
  key: string
  pin: QuickSwitchPin
  Icon: LucideIcon
  title: string
  summary: string
  active: boolean
  onClick: () => void
  footer: (keyed: boolean, i: number) => string
  style?: CSSProperties
}

export function QuickSwitchBar() {
  const pins = useAppStore((s) => s.quickSwitchPins)
  const activeFlow = useAppStore((s) => s.activeFlow)
  const scriptStates = useAppStore((s) => s.scriptStates)
  const startScript = useAppStore((s) => s.startScript)
  const character = useAppStore((s) => s.character)
  const togglePin = useAppStore((s) => s.toggleQuickSwitchPin)
  const macro = useMacroRunner()

  // Fetched once, not on every render: unlike the old flow list (a handful
  // of localStorage reads), this is a Tauri invoke into a Python process.
  // A task pinned before the catalog resolves still renders — see the
  // fallback below — so there is nothing here that has to race the fetch.
  const catalogs = useTaskCatalogs()
  const pythonTasks = catalogs.python.value?.tasks ?? []
  const nodeTasks = catalogs.node.value?.tasks ?? []

  const runningScripts = new Set(
    scriptStates
      .filter((s) => s.status === 'running' || s.status === 'paused')
      .map((s) => s.name.toLowerCase())
  )

  const slots: SlotView[] = pins.map((pin): SlotView => {
    if (pin.kind === 'command') {
      const [macroId, variationId] = pin.actionKey.split(':')
      const definition = MACROS.find((item) => item.id === macroId)
      const variation = definition?.variations.find((item) => item.id === variationId)
      return {
        key: `command:${pin.actionKey}`,
        pin,
        Icon: actionIcon(pin.actionKey),
        title: variation?.label ?? pin.actionKey,
        summary: variation
          ? `${variation.note ?? definition?.label ?? 'Game command'} Runs: ${variation.commands.join(' ; ')}`
          : 'This command is no longer in the library. Remove it from the hotbar.',
        active: false,
        onClick: () => variation && macro.run(variation.commands),
        footer: (keyed, i) =>
          !variation ? 'Unavailable' : !macro.canSend ? (macro.reason ?? 'Unavailable') : keyed ? `Key ${i + 1}, or click` : 'Click to run',
        style: actionAccent(pin.actionKey),
      }
    }
    if (pin.kind === 'task') {
      const lang = taskPinLanguage(pin)
      const catalog = lang === 'typescript' ? catalogs.node : catalogs.python
      const tasks = lang === 'typescript' ? nodeTasks : pythonTasks
      const task = tasks.find((t) => t.id === pin.id)
      const activeId = taskPinActiveId(pin)
      const active = activeFlow === activeId
      const languageLabel = lang === 'typescript' ? 'TypeScript' : 'Python'
      return {
        key: `task:${lang}:${pin.id}`,
        pin,
        Icon: Play,
        title: task?.title ?? pin.id,
        summary:
          task?.summary ?? (catalog.error
            ? `${languageLabel} task lookup failed: ${catalog.error}. Open Functions & Scripts to retry.`
            : catalog.state === 'loading'
              ? 'Task details are loading — press to try it anyway.'
              : `This task is no longer in the ${languageLabel} catalog.`),
        active,
        onClick: () => (active ? requestStopAll() : requestStartFlow(pin.id, lang)),
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
      pin,
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
          Hotbar is empty — use the star on any command, task, or script in
          Functions &amp; scripts. Click here or use number keys 1–9 once pinned.
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
              disabled={slot.pin.kind === 'command' && !macro.canSend}
              aria-label={`${slot.title}${slot.active ? ', running' : ''}`}
              className={cn(
                'relative flex h-10 w-10 items-center justify-center rounded-lg border transition-colors',
                slot.style
                  ? 'hover:brightness-125'
                  : slot.active
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-border bg-surface-raised text-ink-muted hover:border-ink-faint hover:text-ink',
                'disabled:cursor-not-allowed disabled:opacity-35 disabled:saturate-0'
              )}
              style={slot.style}
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

            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                togglePin(slot.pin)
              }}
              title={`Remove ${slot.title} from the hotbar`}
              aria-label={`Remove ${slot.title} from the hotbar`}
              className="absolute -right-1 -top-1 z-10 grid h-4 w-4 place-items-center rounded-full border border-border bg-surface-overlay text-ink-faint opacity-0 shadow transition group-hover:opacity-100 group-focus-within:opacity-100 hover:border-danger/60 hover:text-danger"
            >
              <X className="h-2.5 w-2.5" aria-hidden />
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
