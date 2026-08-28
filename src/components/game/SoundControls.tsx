/**
 * Alert-sound volume, plus a quick mute. This used to also carry ambience,
 * zone music and a radio station picker; that whole layer (ambientSound.ts)
 * was pulled out of the running app - Dan's call, 28 Aug 2026, after
 * repeated overlap and volume complaints: "the idea for that ambiance is
 * bad anyways. pull out that kind of stuff. lets not." What's left is the
 * part that was actually asked for at the start of this and that works:
 * short alert one-shots, tuned down and adjustable.
 *
 * A slider at 0% *is* mute - there is no separate flag to fall out of sync
 * with it. See alertSound.ts's own header for the same reasoning applied
 * at the engine level.
 */
import { useEffect, useRef, useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { playAlert, setAlertsVolume, alertsVolume } from '../../lib/alertSound'
import { loadPrefs, savePrefs } from '../../lib/persistence'
import { cn } from '../../lib/cn'

export function SoundControls() {
  const [open, setOpen] = useState(false)
  // Read from `loadPrefs()`, not `alertsVolume()` - the module's own
  // default and GamePane's effect that applies the persisted level both
  // run independently, and reading the module directly here raced that
  // effect once (see git history on this file for the bug it caused).
  // Reading the same snapshot GamePane's effect reads removes the race.
  const [alerts, setAlerts] = useState(() => loadPrefs().alertsVolume ?? alertsVolume())
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  /** The level saved the instant quick-mute is pressed, restored on the next press. */
  const [preMute, setPreMute] = useState<number | null>(null)

  const apply = (v: number) => {
    setAlerts(v)
    setAlertsVolume(v)
    savePrefs({ alertsVolume: v })
  }

  const toggleQuickMute = () => {
    if (preMute !== null) {
      apply(preMute)
      setPreMute(null)
    } else {
      setPreMute(alerts)
      apply(0)
    }
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapperRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pct = Math.round(alerts * 100)

  return (
    <div ref={wrapperRef} className="relative flex items-center gap-0.5">
      <button
        type="button"
        className={cn('rounded px-1.5 py-0.5', preMute !== null ? 'text-warn' : 'text-ink-faint hover:text-ink')}
        onClick={toggleQuickMute}
        title={preMute !== null ? 'Unmute (restores the previous level)' : 'Mute alerts'}
      >
        {preMute !== null ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
      </button>

      <button
        type="button"
        className={cn(
          'flex items-center gap-1 rounded px-1.5 py-0.5',
          pct === 0 ? 'text-warn' : 'text-ink-faint hover:text-ink'
        )}
        onClick={() => setOpen((v) => !v)}
        title="Alert sound volume"
        aria-expanded={open}
      >
        Sound
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-border bg-surface p-3 shadow-2xl">
          <label className="flex items-center gap-2 text-xs">
            <span className="w-12 shrink-0 text-ink-muted">Alerts</span>
            <input
              type="range"
              min={0}
              max={150}
              value={pct}
              onChange={(e) => {
                apply(Number(e.target.value) / 100)
                if (preMute !== null) setPreMute(null)
              }}
              onMouseUp={() => playAlert('Help.wav')}
              onTouchEnd={() => playAlert('Help.wav')}
              onKeyUp={() => playAlert('Help.wav')}
              className="min-w-[6rem] flex-1 accent-accent"
              aria-label="Alerts volume"
            />
            <span className="w-9 shrink-0 text-right tabular-nums text-ink">{pct}%</span>
          </label>
        </div>
      )}
    </div>
  )
}
