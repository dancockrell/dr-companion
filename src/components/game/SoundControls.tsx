/**
 * Four channels - System, Danger, Speech and Music - plus a quick mute and
 * the radio station picker. Alerts split from one channel into three (29 Aug
 * 2026): a listener bothered by one kind of ping used to have to mute all of
 * them together, which is what emptied highlights.cfg's Danger section of
 * sound in the first place (see alertSound.ts's header) - the fix was never
 * "fewer sounds," it was "sounds a listener can balance instead of an
 * all-or-nothing switch." There used to be a fifth channel too, Ambience
 * (terrain texture); that layer was pulled out of the app entirely (28 Aug
 * 2026, Dan: "the idea for that ambiance is bad anyways... lets not"), then
 * music itself came back the same day ("i do want music. not ambiant...just
 * the music...lots of songs we had"), followed by "that will need a volume
 * control and mute too" - this is that control.
 *
 * A slider at 0% *is* mute - there is no separate flag to fall out of sync
 * with it, and dragging back up remembers exactly where it was because the
 * number is the only state there is. See alertSound.ts's and
 * ambientSound.ts's own headers for the same reasoning applied at the
 * engine level.
 */
import { useEffect, useRef, useState } from 'react'
import { Volume2, Volume1, VolumeX, SkipBack, SkipForward, Play, Radio } from 'lucide-react'
import {
  playAlert,
  setAlertsVolume,
  alertsVolume,
  setDangerVolume,
  dangerVolume,
  setSpeechVolume,
  speechVolume,
} from '../../lib/alertSound'
import {
  setMusicVolume,
  musicVolume,
  setRadioStation,
  currentRadioStation,
  RADIO_STATIONS,
  setCustomStream,
  currentCustomStream,
  skipTrack,
  nowPlaying,
  onNowPlayingChange,
  type NowPlaying,
} from '../../lib/ambientSound'
import { externalMediaAvailable, sendMediaKey, type MediaAction } from '../../lib/externalMedia'
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
      <span className="w-14 shrink-0 text-ink-muted">{label}</span>
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

/**
 * Play/pause/skip/volume for whatever else is playing outside the app -
 * Spotify, a browser tab, a desktop radio app - sent as global media keys.
 * See externalMedia.ts and src-tauri/src/media_keys.rs for the mechanism and
 * why this, not real audio capture, is what's built. Hidden entirely in the
 * browser demo, where there's no OS underneath to send a key to.
 */
function ExternalMediaControls() {
  if (!externalMediaAvailable()) return null

  const tap = (action: MediaAction) => {
    void sendMediaKey(action).catch((e) => console.warn('media key failed', action, e))
  }

  return (
    <div className="mt-3 border-t border-border pt-2">
      <div className="mb-1 text-xs text-ink-muted">
        External source (Spotify, browser, etc.)
      </div>
      <div className="flex items-center justify-between gap-1">
        <button type="button" className="rounded p-1 text-ink-faint hover:text-ink" onClick={() => tap('previous')} title="Previous">
          <SkipBack className="h-3.5 w-3.5" />
        </button>
        <button type="button" className="rounded p-1 text-ink-faint hover:text-ink" onClick={() => tap('play_pause')} title="Play / pause">
          <Play className="h-3.5 w-3.5" />
        </button>
        <button type="button" className="rounded p-1 text-ink-faint hover:text-ink" onClick={() => tap('next')} title="Next">
          <SkipForward className="h-3.5 w-3.5" />
        </button>
        <span className="mx-1 h-4 w-px bg-border" />
        <button type="button" className="rounded p-1 text-ink-faint hover:text-ink" onClick={() => tap('volume_down')} title="Volume down">
          <Volume1 className="h-3.5 w-3.5" />
        </button>
        <button type="button" className="rounded p-1 text-ink-faint hover:text-ink" onClick={() => tap('volume_up')} title="Volume up">
          <Volume2 className="h-3.5 w-3.5" />
        </button>
        <button type="button" className="rounded p-1 text-ink-faint hover:text-ink" onClick={() => tap('mute')} title="Mute / unmute">
          <VolumeX className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

export function SoundControls() {
  const [open, setOpen] = useState(false)
  // Read from `loadPrefs()`, not `alertsVolume()`/`musicVolume()` - those
  // return whatever the module's own default is *right now*, and GamePane
  // applies the persisted level to the same module in its own effect, in a
  // separate render pass. Reading the module directly here raced that
  // effect once already (see git history on this file) and produced a
  // slider that showed a different number than what was actually playing.
  // Reading the same snapshot GamePane's effect reads removes the race.
  const [alerts, setAlerts] = useState(() => loadPrefs().alertsVolume ?? alertsVolume())
  const [danger, setDanger] = useState(() => loadPrefs().dangerVolume ?? dangerVolume())
  const [speech, setSpeech] = useState(() => loadPrefs().speechVolume ?? speechVolume())
  const [music, setMusic] = useState(() => loadPrefs().musicVolume ?? musicVolume())
  const [radioId, setRadioId] = useState(currentRadioStation())
  const [customUrl, setCustomUrl] = useState(currentCustomStream() ?? '')
  const [now, setNow] = useState<NowPlaying | null>(() => nowPlaying())
  // Subscribes rather than polls - a track change (radio/zone advancing on
  // its own between user actions) has to reach this line without the player
  // touching a slider first.
  useEffect(() => onNowPlayingChange(setNow), [])
  // One ref for the whole control - the quick-mute button, the Sound
  // trigger, and the panel are all descendants of it. Two separate refs
  // (trigger, panel) missed the mute button once already: clicking it read
  // as an outside click and closed the panel out from under whoever just
  // used it.
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  /**
   * Levels saved the instant quick-mute is pressed, so pressing it again
   * restores exactly where things were rather than some remembered default.
   * `null` means not currently muted-via-this-button; muting every slider
   * to 0 by hand is a different, equally valid path this button does not
   * try to detect.
   */
  const [preMute, setPreMute] = useState<{
    alerts: number
    danger: number
    speech: number
    music: number
  } | null>(null)

  const applyAll = (v: { alerts: number; danger: number; speech: number; music: number }) => {
    setAlerts(v.alerts)
    setDanger(v.danger)
    setSpeech(v.speech)
    setMusic(v.music)
    setAlertsVolume(v.alerts)
    setDangerVolume(v.danger)
    setSpeechVolume(v.speech)
    setMusicVolume(v.music)
    savePrefs({
      alertsVolume: v.alerts,
      dangerVolume: v.danger,
      speechVolume: v.speech,
      musicVolume: v.music,
    })
  }

  const toggleQuickMute = () => {
    if (preMute) {
      applyAll(preMute)
      setPreMute(null)
    } else {
      setPreMute({ alerts, danger, speech, music })
      applyAll({ alerts: 0, danger: 0, speech: 0, music: 0 })
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

  const overallPct = Math.round(((alerts + danger + speech + music) / 4) * 100)

  return (
    <div ref={wrapperRef} className="relative flex items-center gap-0.5">
      {/* Quick mute: one click, not open-panel-then-drag-two-sliders-to-zero. */}
      <button
        type="button"
        className={cn('rounded px-1.5 py-0.5', preMute ? 'text-warn' : 'text-ink-faint hover:text-ink')}
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
        title="Sound: system, danger, speech and music"
        aria-expanded={open}
      >
        Sound
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-surface p-3 shadow-2xl">
          <div className="mb-2 text-xs font-semibold text-ink">Sound</div>

          <div className="flex flex-col gap-2">
            <Slider
              label="System"
              value={alerts}
              onChange={(v) => {
                setAlerts(v)
                setAlertsVolume(v)
                if (preMute) setPreMute(null)
              }}
              onCommit={(v) => {
                savePrefs({ alertsVolume: v })
                // A quick way to hear where the slider landed, the same
                // sound the idle warning uses - trying a volume by waiting
                // for the next real alert is not feedback.
                playAlert('Thunder.wav', 'alert')
              }}
            />
            <Slider
              label="Danger"
              value={danger}
              onChange={(v) => {
                setDanger(v)
                setDangerVolume(v)
                if (preMute) setPreMute(null)
              }}
              onCommit={(v) => {
                savePrefs({ dangerVolume: v })
                playAlert('Growl.wav', 'danger')
              }}
            />
            <Slider
              label="Speech"
              value={speech}
              onChange={(v) => {
                setSpeech(v)
                setSpeechVolume(v)
                if (preMute) setPreMute(null)
              }}
              onCommit={(v) => {
                savePrefs({ speechVolume: v })
                playAlert('Whisper.wav', 'speech')
              }}
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
            {/* What's actually in the music slot right now, plus track-skip -
              * a bare slider doesn't tell a listener what they're hearing or
              * let them move past a track they don't want. */}
            <div className="mb-2 flex items-center gap-1">
              <button
                type="button"
                className="rounded p-1 text-ink-faint hover:text-ink disabled:opacity-30"
                onClick={() => skipTrack(-1)}
                disabled={!!customUrl}
                title="Previous track"
              >
                <SkipBack className="h-3 w-3" />
              </button>
              <div className="flex-1 truncate text-xs text-ink" title={now ? `${now.title}${now.composer ? ` — ${now.composer}` : ''}` : 'Silent'}>
                {now ? now.title : 'Silent'}
                {now?.composer ? <span className="text-ink-muted"> — {now.composer}</span> : null}
              </div>
              <button
                type="button"
                className="rounded p-1 text-ink-faint hover:text-ink disabled:opacity-30"
                onClick={() => skipTrack(1)}
                disabled={!!customUrl}
                title="Next track"
              >
                <SkipForward className="h-3 w-3" />
              </button>
            </div>

            {/* The radio: a station, not a track. Selecting one starts its
              * playlist looping and advancing on its own - see RadioPlayer in
              * ambientSound.ts. Overrides zone music in the same slot. */}
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-ink-muted">Radio station</span>
              <select
                className="w-full truncate rounded border border-border bg-surface px-1 py-1 text-ink"
                value={radioId ?? ''}
                onChange={(e) => {
                  const next = e.target.value || null
                  setRadioId(next)
                  setRadioStation(next)
                  if (next) {
                    setCustomUrl('')
                    savePrefs({ radioStation: next, customStreamUrl: null })
                  } else {
                    savePrefs({ radioStation: null })
                  }
                }}
                title={
                  RADIO_STATIONS.find((s) => s.id === radioId)?.description ??
                  'Overrides zone music'
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

            {/* Any direct stream URL (an Icecast/Shoutcast station, or
              * whatever else someone points it at) - the "plug in other
              * radio sources" ask, covering stations beyond the six curated
              * ones. Mutually exclusive with the picker above and with zone
              * music - see setCustomStream's own header. */}
            <form
              className="mt-2 flex flex-col gap-1 text-xs"
              onSubmit={(e) => {
                e.preventDefault()
                const url = customUrl.trim()
                if (!url) return
                setRadioId(null)
                setCustomStream(url)
                savePrefs({ customStreamUrl: url, radioStation: null })
              }}
            >
              <span className="text-ink-muted">Custom stream URL</span>
              <div className="flex gap-1">
                <input
                  type="url"
                  inputMode="url"
                  placeholder="https://…/stream"
                  className="w-full truncate rounded border border-border bg-surface px-1 py-1 text-ink"
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                />
                <button
                  type="submit"
                  className="shrink-0 rounded border border-border px-2 py-1 text-ink-faint hover:text-ink"
                  title="Play this stream"
                >
                  <Radio className="h-3 w-3" />
                </button>
              </div>
              {currentCustomStream() && (
                <button
                  type="button"
                  className="self-start text-ink-faint underline hover:text-ink"
                  onClick={() => {
                    setCustomUrl('')
                    setCustomStream(null)
                    savePrefs({ customStreamUrl: null })
                  }}
                >
                  Stop custom stream
                </button>
              )}
            </form>
          </div>

          <ExternalMediaControls />
        </div>
      )}
    </div>
  )
}
