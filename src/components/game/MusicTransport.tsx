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
import { SkipBack, SkipForward, Play, Pause } from 'lucide-react'
import {
  skipTrack,
  musicVolume,
  onMusicVolumeChange,
  pauseMusic,
  resumeMusic,
  currentCustomStream,
  nowPlaying,
  onNowPlayingChange,
  type NowPlaying,
} from '../../lib/ambientSound'
import { useEffect, useState } from 'react'
import { cn } from '../../lib/cn'

export function MusicTransport({
  showTitle = true,
  className,
}: {
  /** Off in the footer's tightest state - the badge row already truncates
   * hard, and the transport buttons matter more there than the title. */
  showTitle?: boolean
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
    <div className={cn('flex min-w-0 items-center gap-0.5', className)}>
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
      {showTitle && (
        <span
          className="min-w-0 truncate text-xs text-ink-muted"
          title={now ? `${now.title}${now.composer ? ` — ${now.composer}` : ''}` : 'Silent'}
        >
          {now ? now.title : 'Silent'}
        </span>
      )}
    </div>
  )
}
