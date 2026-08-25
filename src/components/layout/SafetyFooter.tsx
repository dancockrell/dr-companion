/**
 * Stop, pause, resume. Always visible, never buried.
 *
 * Here because when something goes wrong you want it under the cursor, not two
 * menus deep. That is a usability argument and the whole of the argument; the
 * app has no business editorialising about how anyone plays.
 */
import { Square, Pause, Play } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'

export function SafetyFooter() {
  const requestIntent = useAppStore((s) => s.requestIntent)
  const runningScripts = useAppStore((s) => s.runningScripts)
  const character = useAppStore((s) => s.character)
  const busy = runningScripts.length > 0 ||
    (character?.activity &&
      !['Ready', 'Stopped', 'Paused', 'Healed — Ready'].includes(character.activity))

  return (
    <footer className="shrink-0 border-t border-border bg-surface-raised/90 px-3 py-2 flex items-center gap-2">
      <button
        type="button"
        className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-danger/90 hover:bg-danger text-white text-sm font-semibold py-2 px-3"
        onClick={() => requestIntent('stop_all')}
      >
        <Square className="w-3.5 h-3.5 fill-current" />
        Stop all
      </button>
      <button
        type="button"
        className="rounded-lg border border-border px-3 py-2 text-ink-muted hover:text-ink hover:bg-surface-overlay"
        title="Pause automation"
        onClick={() => requestIntent('pause')}
      >
        <Pause className="w-4 h-4" />
      </button>
      <button
        type="button"
        className="rounded-lg border border-border px-3 py-2 text-ink-muted hover:text-ink hover:bg-surface-overlay"
        title="Resume"
        onClick={() => requestIntent('resume')}
      >
        <Play className="w-4 h-4" />
      </button>
      <span
        className={`text-[10px] w-14 text-right ${
          busy ? 'text-accent animate-pulse-soft' : 'text-ink-faint'
        }`}
      >
        {busy ? 'Active' : 'Idle'}
      </span>
    </footer>
  )
}
