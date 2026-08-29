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
 * # Standard mixer shape (29 Aug 2026)
 *
 * "Powerful and standard, easy to understand" - the panel used to be a bare
 * stack of label+slider+percent rows, identical in shape whether the row was
 * a five-word system concept ("Danger") or something self-explanatory. Every
 * OS volume mixer and every DAW uses the same row: a clickable speaker icon
 * that mutes *that one channel* (remembering its level so a second click
 * restores it, not a guessed default), the name, a one-line plain-language
 * description of what actually lives on it, then the slider and percent.
 * `ChannelRow` below is that row, used for all four channels so the shape is
 * consistent rather than copy-pasted per channel - a listener who
 * understands one row understands all four.
 *
 * A slider at 0% *is* mute - there is no separate flag to fall out of sync
 * with it, and dragging back up remembers exactly where it was because the
 * number is the only state there is. See alertSound.ts's and
 * ambientSound.ts's own headers for the same reasoning applied at the
 * engine level. The per-row mute button is a convenience on top of that, not
 * a second source of truth: it just remembers the last level you had before
 * you clicked it, the same way the whole-panel quick-mute button already did
 * for all four channels at once.
 */
import { useEffect, useRef, useState } from 'react'
import { Volume2, Volume1, VolumeX, SkipBack, SkipForward, Play, Radio, Siren, Skull, MessageCircle, Music2, Star, X } from 'lucide-react'
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
  onMusicVolumeChange,
  setRadioStation,
  currentRadioStation,
  RADIO_STATIONS,
  setCustomStream,
  currentCustomStream,
} from '../../lib/ambientSound'
import { externalMediaAvailable, sendMediaKey, type MediaAction } from '../../lib/externalMedia'
import { loadPrefs, savePrefs, type FavoriteStation } from '../../lib/persistence'
import { cn } from '../../lib/cn'
import { MusicTransport } from './MusicTransport'

/**
 * One row of the mixer: a mute toggle, a name, a plain-language description
 * of what's on the channel, and the slider itself. `muted` is derived by the
 * caller from `value === 0` - this component has no state of its own, same
 * "the number is the only state" rule as everything else in this file.
 */
function ChannelRow({
  icon: Icon,
  label,
  description,
  value,
  onChange,
  onCommit,
  onToggleMute,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  description: string
  value: number
  onChange: (v: number) => void
  onCommit: (v: number) => void
  onToggleMute: () => void
}) {
  const pct = Math.round(value * 100)
  const muted = value === 0
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onToggleMute}
        className={cn(
          'shrink-0 rounded p-1',
          muted ? 'text-warn' : 'text-ink-faint hover:text-ink'
        )}
        title={muted ? `Unmute ${label}` : `Mute ${label}`}
      >
        <Icon className="h-3.5 w-3.5" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-ink">{label}</span>
          <span className="w-9 shrink-0 text-right text-xs tabular-nums text-ink-muted">{pct}%</span>
        </div>
        <div className="mb-1 truncate text-xs text-ink-faint" title={description}>
          {description}
        </div>
        <input
          type="range"
          min={0}
          max={150}
          value={pct}
          onChange={(e) => onChange(Number(e.target.value) / 100)}
          onMouseUp={(e) => onCommit(Number(e.currentTarget.value) / 100)}
          onTouchEnd={(e) => onCommit(Number(e.currentTarget.value) / 100)}
          onKeyUp={(e) => onCommit(Number(e.currentTarget.value) / 100)}
          className="w-full accent-accent"
          aria-label={`${label} volume`}
        />
      </div>
    </div>
  )
}

/** A small caps section header, so "these three are alerts" and "this is
 * music" read as two groups rather than one undifferentiated stack. */
function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint', className)}>
      {children}
    </div>
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
        <button type="button" className="rounded p-1 text-ink-faint hover:text-ink" onClick={() => tap('previous')} title="Previous" aria-label="Previous">
          <SkipBack className="h-3.5 w-3.5" />
        </button>
        <button type="button" className="rounded p-1 text-ink-faint hover:text-ink" onClick={() => tap('play_pause')} title="Play / pause" aria-label="Play / pause">
          <Play className="h-3.5 w-3.5" />
        </button>
        <button type="button" className="rounded p-1 text-ink-faint hover:text-ink" onClick={() => tap('next')} title="Next" aria-label="Next">
          <SkipForward className="h-3.5 w-3.5" />
        </button>
        <span className="mx-1 h-4 w-px bg-border" />
        <button type="button" className="rounded p-1 text-ink-faint hover:text-ink" onClick={() => tap('volume_down')} title="Volume down" aria-label="Volume down">
          <Volume1 className="h-3.5 w-3.5" />
        </button>
        <button type="button" className="rounded p-1 text-ink-faint hover:text-ink" onClick={() => tap('volume_up')} title="Volume up" aria-label="Volume up">
          <Volume2 className="h-3.5 w-3.5" />
        </button>
        <button type="button" className="rounded p-1 text-ink-faint hover:text-ink" onClick={() => tap('mute')} title="Mute / unmute" aria-label="Mute / unmute">
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
  const [customName, setCustomName] = useState('')
  const [favorites, setFavorites] = useState<FavoriteStation[]>(() => loadPrefs().favoriteStations ?? [])
  // The OS media-session play/pause buttons (initMediaSession in
  // ambientSound.ts) can change this volume without this panel's own slider
  // ever being touched - subscribe so the slider doesn't silently disagree
  // with what's actually playing, which is exactly the failure mode "no
  // separate mute flag" exists to prevent everywhere else in this file.
  useEffect(() => onMusicVolumeChange(setMusic), [])
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

  // Per-channel mute: remembers the level a channel was at before muting it
  // and restores exactly that on the next click, same contract as the
  // whole-panel quick-mute button but scoped to one channel. A channel
  // already at 0% - whether from this button or a slider dragged down by
  // hand - has nothing of its own to restore, so it falls back to a level
  // worth actually hearing rather than un-muting to silence.
  const lastNonZero = useRef<{ alerts: number; danger: number; speech: number; music: number }>({
    alerts: alerts || 0.45,
    danger: danger || 0.45,
    speech: speech || 0.45,
    music: music || 0.45,
  })
  const makeChannelHandlers = (
    key: 'alerts' | 'danger' | 'speech' | 'music',
    value: number,
    set: (v: number) => void,
    setModule: (v: number) => void,
    save: (v: number) => void,
    preview?: () => void
  ) => ({
    onChange: (v: number) => {
      set(v)
      setModule(v)
    },
    onCommit: (v: number) => {
      if (v > 0) lastNonZero.current[key] = v
      save(v)
      preview?.()
    },
    onToggleMute: () => {
      const next = value > 0 ? 0 : lastNonZero.current[key]
      set(next)
      setModule(next)
      save(next)
    },
  })

  /**
   * Favorites - a player's own saved stations, first class rather than a
   * side effect of whatever happens to be playing. Two kinds share one list
   * (see persistence.ts's FavoriteStation) because from a listener's chair
   * a curated station and a stream they found themselves are both just "a
   * station," and one list is easier to scan than two.
   */
  const isFavorited = (kind: FavoriteStation['kind'], id: string) =>
    favorites.some((f) => f.kind === kind && f.id === id)

  const saveFavorites = (next: FavoriteStation[]) => {
    setFavorites(next)
    savePrefs({ favoriteStations: next })
  }

  const toggleBuiltinFavorite = (id: string, name: string) => {
    const exists = isFavorited('builtin', id)
    saveFavorites(
      exists
        ? favorites.filter((f) => !(f.kind === 'builtin' && f.id === id))
        : [...favorites, { kind: 'builtin', id, name }]
    )
  }

  const removeFavorite = (kind: FavoriteStation['kind'], id: string) => {
    saveFavorites(favorites.filter((f) => !(f.kind === kind && f.id === id)))
  }

  const playFavorite = (f: FavoriteStation) => {
    if (f.kind === 'builtin') {
      setRadioId(f.id)
      setRadioStation(f.id)
      setCustomUrl('')
      savePrefs({ radioStation: f.id, customStreamUrl: null })
    } else {
      setCustomUrl(f.id)
      setCustomName(f.name)
      setRadioId(null)
      setCustomStream(f.id)
      savePrefs({ customStreamUrl: f.id, radioStation: null })
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
        <div className="absolute bottom-full right-0 z-50 mb-1 max-h-[80vh] w-96 overflow-y-auto rounded-lg border border-border bg-surface p-3 shadow-2xl">
          <div className="mb-2 text-xs font-semibold text-ink">Sound</div>

          <SectionLabel>Alerts</SectionLabel>
          <div className="flex flex-col gap-2.5">
            <ChannelRow
              icon={Siren}
              label="System"
              description="Idle warning, disconnects, resting/learning"
              value={alerts}
              {...makeChannelHandlers(
                'alerts',
                alerts,
                setAlerts,
                setAlertsVolume,
                (v) => savePrefs({ alertsVolume: v }),
                // A quick way to hear where the slider landed, the same
                // sound the idle warning uses - trying a volume by waiting
                // for the next real alert is not feedback.
                () => playAlert('Thunder.wav', 'alert')
              )}
            />
            <ChannelRow
              icon={Skull}
              label="Danger"
              description="Creatures entering, wounds, bleeding, poison"
              value={danger}
              {...makeChannelHandlers(
                'danger',
                danger,
                setDanger,
                setDangerVolume,
                (v) => savePrefs({ dangerVolume: v }),
                () => playAlert('Growl.wav', 'danger')
              )}
            />
            <ChannelRow
              icon={MessageCircle}
              label="Speech"
              description="Whispers and tells addressed to you"
              value={speech}
              {...makeChannelHandlers(
                'speech',
                speech,
                setSpeech,
                setSpeechVolume,
                (v) => savePrefs({ speechVolume: v }),
                () => playAlert('Whisper.wav', 'speech')
              )}
            />
          </div>

          <SectionLabel className="mt-3">Music</SectionLabel>
          <ChannelRow
            icon={Music2}
            label="Music"
            description="Zone playlists, radio, and any stream below"
            value={music}
            {...makeChannelHandlers('music', music, setMusic, setMusicVolume, (v) => savePrefs({ musicVolume: v }))}
          />

          <div className="mt-3 border-t border-border pt-2">
            {/* Prev/play-pause/next plus the title - a bare slider doesn't
              * tell a listener what they're hearing, let them move past a
              * track they don't want, or actually pause it. Shared with
              * SafetyFooter's own copy - see MusicTransport's header. */}
            <MusicTransport className="mb-2" showProgress />


            {/* Favorites, first class: a player's own saved stations up
              * front, not buried below a list of six they may not want. One
              * click plays either kind - see playFavorite's own header. */}
            {favorites.length > 0 && (
              <div className="mb-2">
                <div className="mb-1 flex items-center gap-1 text-xs font-medium text-ink-muted">
                  <Star className="h-3 w-3 fill-current text-accent" />
                  Favorites
                </div>
                <div className="flex flex-col gap-0.5">
                  {favorites.map((f) => {
                    const active =
                      (f.kind === 'builtin' && radioId === f.id) || (f.kind === 'custom' && customUrl === f.id)
                    return (
                      <div
                        key={`${f.kind}:${f.id}`}
                        className={cn(
                          'group flex items-center gap-1 rounded px-1.5 py-1 text-xs',
                          active ? 'bg-accent/15 text-ink' : 'text-ink-muted hover:bg-border/40 hover:text-ink'
                        )}
                      >
                        <button
                          type="button"
                          className="flex flex-1 items-center gap-1.5 truncate text-left"
                          onClick={() => playFavorite(f)}
                          title={f.kind === 'custom' ? f.id : undefined}
                        >
                          {active ? <Play className="h-3 w-3 shrink-0 text-accent" /> : null}
                          <span className="truncate">{f.name}</span>
                        </button>
                        <button
                          type="button"
                          className="shrink-0 rounded p-0.5 text-ink-faint opacity-0 hover:text-warn group-hover:opacity-100"
                          onClick={() => removeFavorite(f.kind, f.id)}
                          title={`Remove ${f.name} from favorites`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Every built-in station, shown off rather than tucked into a
              * dropdown - real curated playlists (six stations, hundreds of
              * tracks between them) deserve to be seen, not guessed at from
              * a name in a <select>. Star toggles a favorite; clicking the
              * row plays it. Overrides zone music in the same slot - see
              * RadioPlayer in ambientSound.ts. */}
            <div className="mb-1 text-xs font-medium text-ink-muted">Radio stations</div>
            <div className="flex flex-col gap-0.5">
              <button
                type="button"
                className={cn(
                  'flex items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs',
                  radioId === null && !customUrl ? 'bg-accent/15 text-ink' : 'text-ink-muted hover:bg-border/40 hover:text-ink'
                )}
                onClick={() => {
                  setRadioId(null)
                  setRadioStation(null)
                  setCustomUrl('')
                  savePrefs({ radioStation: null, customStreamUrl: null })
                }}
              >
                {radioId === null && !customUrl ? <Play className="h-3 w-3 shrink-0 text-accent" /> : <span className="w-3 shrink-0" />}
                Zone music (follows where you are)
              </button>
              {RADIO_STATIONS.map((s) => {
                const active = radioId === s.id
                const favorited = isFavorited('builtin', s.id)
                return (
                  <div
                    key={s.id}
                    className={cn(
                      'group flex items-center gap-1 rounded px-1.5 py-1 text-xs',
                      active ? 'bg-accent/15 text-ink' : 'text-ink-muted hover:bg-border/40 hover:text-ink'
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggleBuiltinFavorite(s.id, s.name)}
                      className={cn('shrink-0 p-0.5', favorited ? 'text-accent' : 'text-ink-faint opacity-0 hover:text-accent group-hover:opacity-100')}
                      title={favorited ? `Remove ${s.name} from favorites` : `Save ${s.name} to favorites`}
                    >
                      <Star className={cn('h-3 w-3', favorited && 'fill-current')} />
                    </button>
                    <button
                      type="button"
                      className="flex flex-1 items-center gap-1.5 truncate text-left"
                      title={s.description}
                      onClick={() => {
                        setRadioId(s.id)
                        setRadioStation(s.id)
                        setCustomUrl('')
                        savePrefs({ radioStation: s.id, customStreamUrl: null })
                      }}
                    >
                      {active ? <Play className="h-3 w-3 shrink-0 text-accent" /> : null}
                      <span className="truncate">{s.name}</span>
                      <span className="shrink-0 text-ink-faint">({s.tracks.length})</span>
                    </button>
                  </div>
                )
              })}
            </div>
            {radioId && (
              <div className="mt-1 truncate text-xs text-ink-faint" title={RADIO_STATIONS.find((s) => s.id === radioId)?.description}>
                {RADIO_STATIONS.find((s) => s.id === radioId)?.description}
              </div>
            )}

            {/* Any direct stream URL (an Icecast/Shoutcast station, or
              * whatever else someone points it at) - the "plug in other
              * radio sources" ask, covering stations beyond the six curated
              * ones. Mutually exclusive with the list above and with zone
              * music - see setCustomStream's own header. Naming it here is
              * what lets it become a favorite: a URL alone is not something
              * a person recognizes in a list a week later. */}
            <form
              className="mt-2 flex flex-col gap-1 border-t border-border pt-2 text-xs"
              onSubmit={(e) => {
                e.preventDefault()
                const url = customUrl.trim()
                if (!url) return
                setRadioId(null)
                setCustomStream(url)
                savePrefs({ customStreamUrl: url, radioStation: null })
              }}
            >
              <span className="text-ink-muted">Add a station by stream URL</span>
              <input
                type="text"
                placeholder="Name (e.g. SomaFM Groove Salad)"
                className="w-full truncate rounded border border-border bg-surface px-1 py-1 text-ink"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
              />
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
                  title="Play this stream" aria-label="Play this stream"
                >
                  <Radio className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  className="shrink-0 rounded border border-border px-2 py-1 text-ink-faint hover:text-accent disabled:opacity-30"
                  disabled={!customUrl.trim()}
                  title="Save to favorites" aria-label="Save to favorites"
                  onClick={() => {
                    const url = customUrl.trim()
                    if (!url) return
                    const name = customName.trim() || url.replace(/^https?:\/\//, '').slice(0, 40)
                    if (isFavorited('custom', url)) {
                      removeFavorite('custom', url)
                    } else {
                      saveFavorites([...favorites, { kind: 'custom', id: url, name }])
                    }
                  }}
                >
                  <Star className={cn('h-3 w-3', customUrl.trim() && isFavorited('custom', customUrl.trim()) && 'fill-current text-accent')} />
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
