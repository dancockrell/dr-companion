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
import { Volume2, VolumeX } from 'lucide-react'
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
import { loadPrefs, savePrefs } from '../../lib/persistence'
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
  /**
   * Read from `loadPrefs()`, not from `alertsVolume()`/`ambientVolume()`/
   * `musicVolume()` - those return whatever the module's own default is
   * *right now*, and GamePane applies the persisted level to the module in
   * its own effect on mount, in a separate render pass. Reading the module
   * directly here raced that effect: on a fresh profile the module's
   * built-in default (0.45) and `PersistedPrefs`'s default happened to
   * differ (0.8, stale from before the module's own default was lowered -
   * see persistence.ts's comment on `alertsVolume`), and depending on which
   * ran first the slider could show a number that was not what was actually
   * playing. Reading the same `loadPrefs()` snapshot GamePane's effect reads
   * removes the race rather than papering over one instance of it.
   */
  const [alerts, setAlerts] = useState(() => loadPrefs().alertsVolume ?? alertsVolume())
  const [ambient, setAmbient] = useState(() => loadPrefs().ambientVolume ?? ambientVolume())
  const [music, setMusic] = useState(() => loadPrefs().musicVolume ?? musicVolume())
  const [radioId, setRadioId] = useState(currentRadioStation())
  // One ref for the whole control - the quick-mute button, the Sound
  // trigger, and the panel are all descendants of it. Checking two separate
  // refs (trigger, panel) missed the mute button entirely: clicking it read
  // as an outside click and closed the panel out from under whoever just
  // used it, which is the opposite of "easier to use."
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  /**
   * Levels saved the instant "mute quickly" is pressed, so pressing it again
   * restores exactly where things were rather than some remembered default -
   * a listener who had ambience at 40% and music at 10% gets 40% and 10%
   * back, not one guessed number for both. `null` means not currently
   * muted-via-this-button; muting all three sliders to 0 by hand is a
   * different, equally valid path and this button does not try to detect or
   * un-detect that state, only its own.
   */
  const [preMute, setPreMute] = useState<{ alerts: number; ambient: number; music: number } | null>(
    null
  )

  const applyAll = (v: { alerts: number; ambient: number; music: number }) => {
    setAlerts(v.alerts)
    setAmbient(v.ambient)
    setMusic(v.music)
    setAlertsVolume(v.alerts)
    setAmbientVolume(v.ambient)
    setMusicVolume(v.music)
    savePrefs({ alertsVolume: v.alerts, ambientVolume: v.ambient, musicVolume: v.music })
  }

  const toggleQuickMute = () => {
    if (preMute) {
      applyAll(preMute)
      setPreMute(null)
    } else {
      setPreMute({ alerts, ambient, music })
      applyAll({ alerts: 0, ambient: 0, music: 0 })
    }
  }

  // Close on an outside click or Escape - a panel that only closes by
  // clicking its own trigger again is the kind of thing people learn to
  // route around rather than use.
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

  const overallPct = Math.round(((alerts + ambient + music) / 3) * 100)

  return (
    <div ref={wrapperRef} className="relative flex items-center gap-0.5">
      {/* Quick mute, separate from the tuning panel - Dan's ask (28 Aug
        * 2026): "mute quickly or whatever." One click, not open-panel-then-
        * drag-three-sliders-to-zero. Remembers exactly where the three
        * levels were and restores them, rather than a guessed default. */}
      <button
        type="button"
        className={cn(
          'rounded px-1.5 py-0.5',
          preMute ? 'text-warn' : 'text-ink-faint hover:text-ink'
        )}
        onClick={toggleQuickMute}
        title={preMute ? 'Unmute (restores previous levels)' : 'Mute everything'}
      >
        {preMute ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
      </button>

      <button
        type="button"
        className={cn(
          'flex items-center gap-1 rounded px-1.5 py-0.5',
          overallPct === 0 ? 'text-warn' : 'text-ink-faint hover:text-ink'
        )}
        onClick={() => setOpen((v) => !v)}
        title="Sound: alerts, ambience and music"
        aria-expanded={open}
      >
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
                if (preMute) setPreMute(null)
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
                if (preMute) setPreMute(null)
              }}
              onCommit={(v) => savePrefs({ ambientVolume: v })}
            />
            <Slider
              label="Music"
              value={music}
              onChange={(v) => {
                setMusic(v)
                setMusicVolume(v)
                if (preMute) setPreMute(null)
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
