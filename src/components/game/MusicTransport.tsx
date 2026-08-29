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
import { SkipBack, SkipForward, Play, Pause, Volume2, Volume1, VolumeX } from 'lucide-react'
import {
  skipTrack,
  musicVolume,
  setMusicVolume,
  onMusicVolumeChange,
  pauseMusic,
  resumeMusic,
  currentCustomStream,
  nowPlaying,
  onNowPlayingChange,
  playbackProgress,
  onProgressChange,
  seekMusic,
  type NowPlaying,
  type Progress,
} from '../../lib/ambientSound'
import { useEffect, useState } from 'react'
import { cn } from '../../lib/cn'

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
 * more often than play state or the track itself).
 *
 * `compact` (29 Aug 2026) drops the mm:ss labels for the footer's inline
 * copy, which sits *in* the button row rather than below it - see this
 * file's own header on `MusicTransport` for why the footer needed this at
 * all. Both variants return null under the same condition (a live stream,
 * or before metadata has arrived - a bar with no end is not a progress bar,
 * it's a lie), which matters for the footer specifically: with nothing to
 * render there, the space it would have filled just isn't claimed, rather
 * than sitting there empty. See MusicTransport's own note on why the old
 * layout gave that space to the title instead and it went to waste.
 */
function ProgressBar({ compact = false }: { compact?: boolean }) {
  const [p, setP] = useState<Progress | null>(() => playbackProgress())
  useEffect(() => {
    setP((prev) => {
      const current = playbackProgress()
      return prev === current ? prev : current
    })
    return onProgressChange(setP)
  }, [])

  if (!p || !Number.isFinite(p.duration)) return null

  const slider = (
    <input
      type="range"
      min={0}
      max={p.duration}
      step={1}
      value={Math.min(p.position, p.duration)}
      onChange={(e) => seekMusic(Number(e.currentTarget.value))}
      className="min-w-0 flex-1 accent-accent"
      aria-label="Playback position"
    />
  )

  if (compact) {
    // No time labels - the footer strip is already tight, and the full
    // mm:ss/mm:ss pair is one click away in the Sound panel's own copy of
    // this bar. The slider alone is still real seeking, not decoration.
    return <div className="flex min-w-16 flex-1 items-center">{slider}</div>
  }

  // text-xs, not 10px: DESIGN.md 1.5 puts the floor at 12px and
  // tools/contrast-test.mjs fails the build below it. Timecodes are exactly
  // the kind of thing that gets shrunk because it is "only a number", and they
  // are read by the same eyes as everything else.
  return (
    <div className="flex w-full items-center gap-1.5 text-xs tabular-nums text-ink-faint">
      <span className="w-8 shrink-0 text-right">{formatTime(p.position)}</span>
      {slider}
      <span className="w-8 shrink-0">{formatTime(p.duration)}</span>
    </div>
  )
}

export function MusicTransport({
  showTitle = true,
  showProgress = false,
  showInlineProgress = false,
  showVolume = false,
  onTitleClick,
  className,
}: {
  /** Off in the footer's tightest state - the badge row already truncates
   * hard, and the transport buttons matter more there than the title. */
  showTitle?: boolean
  /** On only in the Sound panel - a full mm:ss/slider/mm:ss row below the
   * transport buttons. See `showInlineProgress` for the footer's copy. */
  showProgress?: boolean
  /**
   * The footer's scrubber - inline in the button row, no time labels
   * (`ProgressBar`'s `compact` mode). Added 29 Aug 2026 to fix a real
   * layout bug, not just to add a feature: the title used to be the only
   * `flex-1` in this row, so at a wide window it claimed all the leftover
   * space and then left most of it empty, since the text itself is
   * left-aligned and usually shorter than the box it was given - a visibly
   * broken-looking gap between the title and the volume control, not a
   * deliberate design. The title is bounded now (`max-w-[16rem]`) and this
   * bar is the thing that actually wants the slack: real, useful (you can
   * seek from the footer now, not just watch it), and it simply doesn't
   * render when there's nothing to show (a live stream, or before metadata
   * arrives), so the gap only ever appears when there is truly nothing to
   * put there instead of whenever the title happened to be short.
   */
  showInlineProgress?: boolean
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
  /** Makes the title clickable - the footer's compact strip is a glance,
   * not the whole panel, so a click through to it (SoundControls, favorites,
   * the station list, crossfade style) has to go somewhere. */
  onTitleClick?: () => void
  className?: string
}) {
  const [now, setNow] = useState<NowPlaying | null>(() => nowPlaying())
  const [vol, setVol] = useState(() => musicVolume())
  // Re-read at subscribe time, not only at first render - GamePane's own
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

  const playing = vol > 0
  // A live stream has no track to skip to - see skipTrack's own header.
  const canSkip = !currentCustomStream()

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
          * any more (29 Aug 2026). `flex-1` gives an element `flex-basis: 0%`,
          * so it grows to fill whatever space nothing else claims *regardless
          * of how much its own content needs* - at a wide window this title
          * was claiming a large box and then leaving most of it empty, since
          * the text is left-aligned and usually shorter than the box it got.
          * Visibly broken-looking dead air, not a design. A bounded max-width
          * means the box is never bigger than the text needs; default
          * flex-shrink (every flex item's own default) still lets it give up
          * width at a narrow window, down to the same six-character floor
          * this strip has always kept, because a title that's shrunk past
          * legibility is worse than one that's merely capped. The slack this
          * used to (mis)absorb now goes to the scrubber below - see
          * showInlineProgress's own header. */}
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
        {showInlineProgress && <ProgressBar compact />}
        {showVolume && (
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
              className="hidden w-16 min-w-9 shrink accent-accent xl:block"
              aria-label="Music volume (quick)"
            />
          </div>
        )}
      </div>
      {showProgress && <ProgressBar />}
    </div>
  )
}
