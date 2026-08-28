/**
 * One control for all three sound channels, opened from a single button
 * rather than three separate icon toggles crammed into the toolbar - Dan's
 * ask (28 Aug 2026): "full and strong sound controls... obvious but...
 * easier to use and more intuitive than now."
 *
 * Three sliders, not three mute buttons plus three sliders. A slider at 0%
 * *is* mute - there is no separate flag to fall out of sync with it, and
 * dragging back up remembers exactly where it was because the number is the
 * only state there is. See alertSound.ts's and ambientSound.ts's own
 * headers for the same reasoning applied at the engine level.
 *
 * The radio station picker lives here too, under Music, rather than as its
 * own `<select>` in the toolbar - it is a music-channel setting, not a
 * separate concern.
 */
import { useEffect, useRef, useState } from 'react'
import { Volume2 } from 'lucide-react'
import {
  playAlert,
  setAlertsVolume,
  alertsVolume,
} from '../../lib/alertSound'
import {
  setAmbientVolume,
  ambientVolume,
  setMusicVolume,
  musicVolume,
  setRadioStation,
  currentRadioStation,
  RADIO_STATIONS,
} from '../../lib/ambientSound'
import { savePrefs } from '../../lib/persistence'
import { cn } from '../../lib/cn'

function Slider({
  label,
  value,
  onChange,
  onCommit,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  onCommit: (v: number) => void
}) {
  const pct = Math.round(value * 100)
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0 text-ink-muted">{label}</span>
      <input
        type="range"
        min={0}
        max={150}
        value={pct}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        onMouseUp={(e) => onCommit(Number(e.currentTarget.value) / 100)}
        onTouchEnd={(e) => onCommit(Number(e.currentTarget.value) / 100)}
        onKeyUp={(e) => onCommit(Number(e.currentTarget.value) / 100)}
        className="min-w-[6rem] flex-1 accent-accent"
        aria-label={`${label} volume`}
      />
      <span className="w-9 shrink-0 text-right tabular-nums text-ink">{pct}%</span>
    </label>
  )
}

export function SoundControls() {
  const [open, setOpen] = useState(false)
  const [alerts, setAlerts] = useState(alertsVolume())
  const [ambient, setAmbient] = useState(ambientVolume())
  const [music, setMusic] = useState(musicVolume())
  const [radioId, setRadioId] = useState(currentRadioStation())
  const panelRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  // Close on an outside click or Escape - a panel that only closes by
  // clicking its own trigger again is the kind of thing people learn to
  // route around rather than use.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (
        panelRef.current?.contains(e.target as Node) ||
        buttonRef.current?.contains(e.target as Node)
      ) {
        return
      }
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

  const overallPct = Math.round(((alerts + ambient + music) / 3) * 100)

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        className={cn(
          'flex items-center gap-1 rounded px-1.5 py-0.5',
          overallPct === 0 ? 'text-warn' : 'text-ink-faint hover:text-ink'
        )}
        onClick={() => setOpen((v) => !v)}
        title="Sound: alerts, ambience and music"
        aria-expanded={open}
      >
        <Volume2 className="h-3 w-3" />
        Sound
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-surface p-3 shadow-2xl"
        >
          <div className="mb-2 text-xs font-semibold text-ink">Sound</div>

          <div className="flex flex-col gap-2">
            <Slider
              label="Alerts"
              value={alerts}
              onChange={(v) => {
                setAlerts(v)
                setAlertsVolume(v)
              }}
              onCommit={(v) => {
                savePrefs({ alertsVolume: v })
                // A quick way to hear where the slider landed, the same
                // sound an idle warning would use - trying a volume by
                // waiting for the next real alert is not feedback.
                playAlert('Help.wav')
              }}
            />
            <Slider
              label="Ambience"
              value={ambient}
              onChange={(v) => {
                setAmbient(v)
                setAmbientVolume(v)
              }}
              onCommit={(v) => savePrefs({ ambientVolume: v })}
            />
            <Slider
              label="Music"
              value={music}
              onChange={(v) => {
                setMusic(v)
                setMusicVolume(v)
              }}
              onCommit={(v) => savePrefs({ musicVolume: v })}
            />
          </div>

          <div className="mt-3 border-t border-border pt-2">
            {/* The radio: a station, not a track. Selecting one starts its
              * playlist looping and advancing on its own - see RadioPlayer in
              * ambientSound.ts. An override of the music layer only; ambience
              * keeps playing under whatever the station is playing. */}
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-ink-muted">Radio station</span>
              <select
                className="w-full truncate rounded border border-border bg-surface px-1 py-1 text-ink"
                value={radioId ?? ''}
                onChange={(e) => {
                  const next = e.target.value || null
                  setRadioId(next)
                  setRadioStation(next)
                }}
                title={
                  RADIO_STATIONS.find((s) => s.id === radioId)?.description ??
                  'Overrides zone music; ambience keeps playing'
                }
              >
                <option value="">Zone music</option>
                {RADIO_STATIONS.map((s) => (
                  <option key={s.id} value={s.id} title={s.description}>
                    {s.name} ({s.tracks.length})
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}
    </div>
  )
}
