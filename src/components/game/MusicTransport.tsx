/**
 * Prev / play-pause / next for the app's own music (zone playlists, radio,
 * a custom stream) - shared between the Sound panel and SafetyFooter (29 Aug
 * 2026), so the always-visible footer bar gets a real transport, not just a
 * volume slider hidden inside a popover. One component rather than two
 * copies of the same subscribe-to-nowPlaying/musicVolume wiring, which is
 * exactly the kind of thing that drifts if written twice.
 *
 * Play/pause reads the same "0% is the only mute state" convention as the
 * rest of this app's sound engine - `musicVolume() > 0` is "playing," and
 * the button calls `pauseMusic()`/`resumeMusic()` (ambientSound.ts), which
 * remember the level they muted from rather than guessing one back. This is
 * also what the OS media-session play/pause buttons call
 * (`initMediaSession`), so this component, the footer, and Windows' own Now
 * Playing UI all agree on the same state through the same subscription.
 */
import { SkipBack, SkipForward, Play, Pause, Volume2, Volume1, VolumeX, AudioLines, Star } from 'lucide-react'
import {
  skipTrack,
  musicVolume,
  setMusicVolume,
  onMusicVolumeChange,
  pauseMusic,
  resumeMusic,
  currentCustomStream,
  currentRadioStation,
  RADIO_STATIONS,
  nowPlaying,
  onNowPlayingChange,
  playbackProgress,
  onProgressChange,
  seekMusic,
  CROSSFADE_STYLES,
  setCrossfadeStyle,
  currentCrossfadeStyle,
  onCrossfadeStyleChange,
  type NowPlaying,
  type Progress,
  type CrossfadeStyle,
} from '../../lib/ambientSound'
import { savePrefs } from '../../lib/persistence'
import { isFavorited, toggleFavorite, onFavoritesChange } from '../../lib/favorites'
import { useEffect, useState } from 'react'
import { cn } from '../../lib/cn'

/** cut -> standard -> long -> cut. Same three values SoundControls' own
 * picker offers - see CROSSFADE_STYLES in ambientSound.ts. */
const CROSSFADE_ORDER: CrossfadeStyle[] = ['cut', 'standard', 'long']
function nextCrossfadeStyle(style: CrossfadeStyle): CrossfadeStyle {
  return CROSSFADE_ORDER[(CROSSFADE_ORDER.indexOf(style) + 1) % CROSSFADE_ORDER.length]
}

/** "125" -> "2:05". Caller guarantees a finite, non-negative input - see
 * ProgressBar's own guard on `duration`. */
function formatTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

/**
 * A seekable progress bar - separate from the transport buttons because it
 * needs its own subscription (position changes on every `timeupdate`, far
 * more often than play state or the track itself). One shape now (30 Aug
 * 2026) - a bare, unlabelled sliver used to sit *inside* the button row for
 * the footer specifically (`compact` mode), and it read as decoration, not
 * a control: no time labels, easy to mistake for volume, easy to miss
 * entirely next to the transitions/favorite/volume icons crowding the same
 * row. Dan: "make the track scrubber long, clarify what it is with better
 * design and make it next to the track skipper." This is that fix - the
 * full mm:ss/slider/mm:ss row, same one the Sound panel already used, now
 * also the footer's own second row directly under the skip buttons rather
 * than squeezed between them and everything else.
 *
 * Returns null under one condition - a live stream, or before metadata has
 * arrived (a bar with no end is not a progress bar, it's a lie) - which
 * matters for the footer specifically: with nothing to render, the row it
 * would have taken just isn't claimed, rather than a labelled bar for a
 * duration that doesn't exist.
 */
function ProgressBar() {
  const [p, setP] = useState<Progress | null>(() => playbackProgress())
  useEffect(() => {
    setP((prev) => {
      const current = playbackProgress()
      return prev === current ? prev : current
    })
    return onProgressChange(setP)
  }, [])

  if (!p || !Number.isFinite(p.duration)) return null

  // text-xs, not 10px: DESIGN.md 1.5 puts the floor at 12px and
  // tools/contrast-test.mjs fails the build below it. Timecodes are exactly
  // the kind of thing that gets shrunk because it is "only a number", and they
  // are read by the same eyes as everything else.
  return (
    <div className="flex w-full items-center gap-1.5 text-xs tabular-nums text-ink-faint">
      <span className="w-8 shrink-0 text-right">{formatTime(p.position)}</span>
      <input
        type="range"
        min={0}
        max={p.duration}
        step={1}
        value={Math.min(p.position, p.duration)}
        onChange={(e) => seekMusic(Number(e.currentTarget.value))}
        className="h-1.5 min-w-0 flex-1 accent-accent"
        aria-label="Playback position"
      />
      <span className="w-8 shrink-0">{formatTime(p.duration)}</span>
    </div>
  )
}

export function MusicTransport({
  showTitle = true,
  showProgress = false,
  showVolume = false,
  showTransitions = false,
  showFavorite = false,
  onTitleClick,
  className,
}: {
  /** Off in the footer's tightest state - the badge row already truncates
   * hard, and the transport buttons matter more there than the title. */
  showTitle?: boolean
  /**
   * A full mm:ss/slider/mm:ss row below the transport buttons - the Sound
   * panel's own copy, and (30 Aug 2026) the footer's too. Used to be two
   * different things: the footer had its own bare, unlabelled inline
   * sliver squeezed into the button row itself, which read as decoration
   * more than a control - no time labels, easy to lose next to the
   * favorite/transitions/volume icons in the same row. One shape now,
   * `ProgressBar`'s own header has the fuller story.
   */
  showProgress?: boolean
  /**
   * A compact volume slider inline, next to the transport buttons - added
   * 29 Aug 2026 because the footer had play/pause/skip and nothing to
   * adjust level with, so "turn the music down" meant opening the Sound
   * panel for one slider drag. Real players (Spotify included) put volume
   * where the transport already is; hiding it behind a click was the actual
   * gap, not a missing feature so much as a missing shortcut to one that
   * already existed.
   */
  showVolume?: boolean
  /**
   * A compact cut/standard/long crossfade-style cycle button, inline next to
   * volume - added 29 Aug 2026 so the one player-feel setting a listener is
   * likely to want to nudge ("faster fades", "slower fades") is reachable
   * without opening the panel. Cycles through CROSSFADE_STYLES on click;
   * the tooltip names the current style and what clicking does next, since
   * a bare icon that changes what it does on every click has to say so.
   */
  showTransitions?: boolean
  /**
   * A star that favorites whatever's currently playing - a built-in station
   * or a custom stream, the same two kinds SoundControls' own favorites list
   * already supports (favorites.ts). Hidden entirely for zone music, which
   * isn't a station a player picked and has nothing to star. Added 29 Aug
   * 2026 so "save what's on right now" doesn't require opening the panel and
   * finding the right row in the station list to click its own star.
   */
  showFavorite?: boolean
  /** Makes the title clickable - the footer's compact strip is a glance,
   * not the whole panel, so a click through to it (SoundControls, favorites,
   * the station list, crossfade style) has to go somewhere. */
  onTitleClick?: () => void
  className?: string
}) {
  const [now, setNow] = useState<NowPlaying | null>(() => nowPlaying())
  const [vol, setVol] = useState(() => musicVolume())
  // Re-read at subscribe time, not only at first render - GameSignals' own
  // mount effect (a sibling, not a parent) sets the initial station in *its*
  // effect, which can run after this component's render already captured
  // `now`/`vol` as null/0 but before this effect subscribes. A change that
  // lands in that gap is missed by the lazy useState initializer and never
  // arrives as a later event, because it already happened - same race
  // SoundControls' own header already documents fixing once, reintroduced
  // here in a new component. Calling the setter with the current value on
  // subscribe closes the window regardless of effect ordering between
  // components.
  // Only re-sets when it actually raced - the common case (no sibling effect
  // beat this one to the module) already has the right value from useState's
  // lazy initializer, and re-setting it here would cost an extra render for
  // nothing. Deliberately synchronous, not the anti-pattern the linter
  // usually catches: this effect's whole job is synchronizing with an
  // external, non-React module (ambientSound.ts), and the sync call is what
  // closes a real cross-component mount-order race - see this file's own
  // comment above.
  useEffect(() => {
    setNow((prev) => {
      const current = nowPlaying()
      return prev === current ? prev : current
    })
    return onNowPlayingChange(setNow)
  }, [])
  useEffect(() => {
    setVol((prev) => {
      const current = musicVolume()
      return prev === current ? prev : current
    })
    return onMusicVolumeChange(setVol)
  }, [])
  const [crossfade, setCrossfade] = useState<CrossfadeStyle>(() => currentCrossfadeStyle())
  useEffect(() => {
    setCrossfade((prev) => {
      const current = currentCrossfadeStyle()
      return prev === current ? prev : current
    })
    return onCrossfadeStyleChange(setCrossfade)
  }, [])

  const playing = vol > 0
  // A live stream has no track to skip to - see skipTrack's own header.
  const canSkip = !currentCustomStream()

  // Re-render on any favorites change - a station starred from the panel
  // (or unstarred from this same star elsewhere) has to update this copy
  // too, same reasoning as every other subscription in this component.
  const [, setFavoritesTick] = useState(0)
  useEffect(() => onFavoritesChange(() => setFavoritesTick((n) => n + 1)), [])
  const radioId = currentRadioStation()
  const customStream = currentCustomStream()
  const favoriteTarget: { kind: 'builtin' | 'custom'; id: string; name: string } | null = radioId
    ? { kind: 'builtin', id: radioId, name: RADIO_STATIONS.find((s) => s.id === radioId)?.name ?? radioId }
    : customStream
      ? { kind: 'custom', id: customStream, name: customStream.replace(/^https?:\/\//, '').slice(0, 40) }
      : null
  const favorited = favoriteTarget ? isFavorited(favoriteTarget.kind, favoriteTarget.id) : false

  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <div className="flex min-w-0 items-center gap-0.5">
        <button
          type="button"
          className="shrink-0 rounded p-1 text-ink-faint hover:text-ink disabled:opacity-30"
          onClick={() => skipTrack(-1)}
          disabled={!canSkip}
          title="Previous track" aria-label="Previous track"
        >
          <SkipBack className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="shrink-0 rounded p-1 text-ink-faint hover:text-ink"
          onClick={() => (playing ? pauseMusic() : resumeMusic())}
          title={playing ? 'Pause music' : 'Play music'}
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          className="shrink-0 rounded p-1 text-ink-faint hover:text-ink disabled:opacity-30"
          onClick={() => skipTrack(1)}
          disabled={!canSkip}
          title="Next track" aria-label="Next track"
        >
          <SkipForward className="h-3.5 w-3.5" />
        </button>
        {/* min-w-16, max-w-[12rem], no flex-grow - deliberately not `flex-1`
          * (29 Aug 2026, still true after the scrubber moved to its own row
          * 30 Aug 2026). `flex-1` gives an element `flex-basis: 0%`, so it
          * grows to fill whatever space nothing else claims *regardless of
          * how much its own content needs* - at a wide window this title
          * was claiming a large box and then leaving most of it empty, since
          * the text is left-aligned and usually shorter than the box it got.
          * A bounded max-width means the box is never bigger than the text
          * needs; default flex-shrink still lets it give up width at a
          * narrow window, down to the same six-character floor this strip
          * has always kept. The button row can sit left-packed now that
          * nothing else in it claims the leftover space either - the thing
          * that actually wants to be long is the scrubber below, which gets
          * its own full-width row instead of fighting this one for it. */}
        {showTitle &&
          (onTitleClick ? (
            <button
              type="button"
              className="min-w-16 max-w-[12rem] truncate text-left text-xs text-ink-muted hover:text-ink hover:underline"
              title={
                (now ? `${now.title}${now.composer ? ` — ${now.composer}` : ''}` : 'Silent') +
                ' — open Sound'
              }
              onClick={onTitleClick}
            >
              {now ? now.title : 'Silent'}
            </button>
          ) : (
            <span
              className="min-w-16 max-w-[12rem] truncate text-xs text-ink-muted"
              title={now ? `${now.title}${now.composer ? ` — ${now.composer}` : ''}` : 'Silent'}
            >
              {now ? now.title : 'Silent'}
            </span>
          ))}
        {showFavorite && favoriteTarget && (
          <button
            type="button"
            className={cn(
              'shrink-0 rounded p-1 hover:text-accent',
              favorited ? 'text-accent' : 'text-ink-faint'
            )}
            onClick={() => favoriteTarget && toggleFavorite(favoriteTarget.kind, favoriteTarget.id, favoriteTarget.name)}
            title={
              favorited
                ? `Remove ${favoriteTarget.name} from favorites`
                : `Save ${favoriteTarget.name} to favorites`
            }
          >
            <Star className={cn('h-3.5 w-3.5', favorited && 'fill-current')} />
          </button>
        )}
        {showTransitions && (
          <button
            type="button"
            className="shrink-0 rounded p-1 text-ink-faint hover:text-ink"
            onClick={() => {
              const next = nextCrossfadeStyle(crossfade)
              setCrossfade(next)
              setCrossfadeStyle(next)
              savePrefs({ crossfadeStyle: next })
            }}
            title={`Transitions: ${CROSSFADE_STYLES[crossfade].label} (${CROSSFADE_STYLES[crossfade].description}) — click for ${CROSSFADE_STYLES[nextCrossfadeStyle(crossfade)].label}`}
          >
            <AudioLines className="h-3.5 w-3.5" />
          </button>
        )}
        {showVolume && (
          // min-w-24 (not `hidden ... xl:block`, 29 Aug 2026): the slider used
          // to vanish below the xl breakpoint and leave only the mute icon,
          // so at any window narrower than 1280px there was no visible way to
          // set a level - only on/off. A footer this narrow still has room
          // for a real slider; it just can't be the 4rem one the wide layout
          // affords. Fixed at a usable minimum instead of disappearing.
          <div className="flex min-w-0 shrink-0 items-center gap-1">
            <button
              type="button"
              className="shrink-0 rounded p-1 text-ink-faint hover:text-ink"
              onClick={() => (playing ? pauseMusic() : resumeMusic())}
              title={playing ? 'Mute music' : 'Unmute music'}
            >
              {vol <= 0 ? (
                <VolumeX className="h-3.5 w-3.5" />
              ) : vol < 0.5 ? (
                <Volume1 className="h-3.5 w-3.5" />
              ) : (
                <Volume2 className="h-3.5 w-3.5" />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={150}
              value={Math.round(vol * 100)}
              onChange={(e) => setMusicVolume(Number(e.currentTarget.value) / 100)}
              className="w-12 min-w-9 shrink accent-accent sm:w-16"
              title={`Music volume: ${Math.round(vol * 100)}%`}
              aria-label="Music volume (quick)"
            />
          </div>
        )}
      </div>
      {showProgress && <ProgressBar />}
    </div>
  )
}
