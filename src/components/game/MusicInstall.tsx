/**
 * Installing music, one group at a time.
 *
 * #396 put the whole 4.36 GB library behind a single button and said so in its
 * own description: "4.36 GB is a large thing to offer behind one button."
 * `data/audio/manifest.json` already groups the tracks for playback - every
 * radio entry carries a `station`, which is what `RADIO_STATIONS` is built
 * from - so that grouping is the unit of install here rather than a new
 * taxonomy invented for the installer. The largest single choice becomes
 * 1.65 GB.
 *
 * # Two places, one button
 *
 * The footer transport offers the group the listener was *about to hear*; the
 * Sound panel lists every group. Both render `MusicInstallButton`, which is the
 * only place in the app that calls `installMusicLibrary`, so there is exactly
 * one call site and it is a click handler - the property
 * `tools/music-library-test.mjs` asserts, and the reason this lives in its own
 * file rather than being copied into the panel.
 *
 * Nothing here starts on mount, on a timer, or on a retry.
 */
import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import {
  MUSIC_GROUPS,
  MUSIC_LIBRARY_BYTES,
  MUSIC_TRACKS,
  cancelMusicInstall,
  formatLibrarySize,
  installMusicLibrary,
  musicGroup,
  musicLibraryStatus,
  onMusicLibraryChange,
  refreshMusicLibrary,
  removeMusicGroup,
  type MusicGroup,
  type MusicGroupStatus,
  type MusicLibraryStatus,
} from '../../lib/musicLibrary.ts'
import { resetMusicLibraryVerdict, startMusic } from '../../lib/ambientSound.ts'
import { cn } from '../../lib/cn.ts'

/** What the library looks like right now, shared by every consumer through one
 * subscription rather than each component invoking and getting its own answer,
 * which is how the footer and the panel would come to disagree about whether a
 * station is installed. */
function useLibrary(): MusicLibraryStatus | null {
  const [status, setStatus] = useState<MusicLibraryStatus | null>(() => musicLibraryStatus())
  useEffect(() => {
    setStatus((prev) => {
      const current = musicLibraryStatus()
      return prev === current ? prev : current
    })
    return onMusicLibraryChange(setStatus)
  }, [])
  return status
}

/**
 * The one control that downloads anything.
 *
 * `group` null means the whole library. `label` is passed in rather than built
 * here because the two callers are saying different things - "Install Six
 * Strings (1.4 GB)" against "Resume (0.4 GB)" - while doing the same thing.
 */
export function MusicInstallButton({
  group,
  label,
  title,
  className,
  onDone,
}: {
  group: MusicGroup | null
  label: string
  title: string
  className?: string
  onDone?: () => void
}) {
  const [phase, setPhase] = useState<'idle' | 'installing' | 'failed'>('idle')
  const [done, setDone] = useState(0)
  const [error, setError] = useState('')

  const total = group ? group.bytes : MUSIC_LIBRARY_BYTES
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0

  if (phase === 'installing') {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-ink-muted">
        <span className="tabular-nums">
          Installing {percent}% ({formatLibrarySize(done)} of {formatLibrarySize(total)})
        </span>
        <button
          type="button"
          className="rounded border border-line px-1.5 py-0.5 text-xs text-ink-muted hover:text-ink"
          onClick={() => void cancelMusicInstall()}
        >
          Cancel
        </button>
      </span>
    )
  }

  return (
    <span className="flex min-w-0 shrink-0 items-center gap-1.5">
      <button
        type="button"
        className={cn(
          'shrink-0 rounded border border-accent/40 px-1.5 py-0.5 text-xs text-accent hover:bg-accent/10',
          className
        )}
        title={title}
        onClick={() => {
          setError('')
          setDone(0)
          setPhase('installing')
          void installMusicLibrary(group, (p) => setDone(p.received))
            .then(() => {
              setPhase('idle')
              // A cancelled install resolves too, having written whatever it
              // got - so the verdict is reset and playback restarted either
              // way, and what actually arrived is read back off disk rather
              // than assumed from the fact that the call returned.
              resetMusicLibraryVerdict()
              startMusic()
              onDone?.()
            })
            .catch((e: unknown) => {
              setPhase('failed')
              setError(e instanceof Error ? e.message : String(e))
            })
        }}
      >
        {label}
      </button>
      {phase === 'failed' && (
        <span className="min-w-0 max-w-48 truncate text-xs text-warn" role="alert" title={error}>
          {error}
        </span>
      )}
    </span>
  )
}

/**
 * What to do about music that is not installed, in the transport.
 *
 * #383 made the missing library honest: one `Music not installed` state, no
 * track name, no Retry that could not work. Honest and a dead end, which #396
 * fixed with a 4.4 GB button. This offers the group that was about to play
 * first, because that is the smallest thing that would actually fix what the
 * listener just noticed, with the whole library still one click away for
 * somebody who wants it all.
 *
 * `groupId` comes from `NowPlaying`, so the state and its remedy are describing
 * the same track rather than two components guessing separately.
 */
export function MusicInstallAction({ groupId }: { groupId?: string }) {
  const group = groupId === undefined ? undefined : musicGroup(groupId)
  // `flex-wrap` and no `shrink-0` (6 Sep 2026): with two buttons instead of
  // one, this row is wider than the Sound panel's column, and the panel's copy
  // of the transport clipped `Install all` clean off the right edge - the
  // second button was on screen and unreachable. Found by looking at the
  // screenshot, not by reading the class list. Wrapping onto a second line
  // costs a few pixels of height in the footer and keeps both controls
  // clickable at every width.
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
      {group && (
        <MusicInstallButton
          group={group}
          label={`Install ${group.name} (${formatLibrarySize(group.bytes)})`}
          title={`Download the ${group.tracks.length} tracks of ${group.name} (${formatLibrarySize(group.bytes)}) into this app's data folder. Nothing is downloaded until you press this.`}
        />
      )}
      <MusicInstallButton
        group={null}
        label={`Install all (${formatLibrarySize(MUSIC_LIBRARY_BYTES)})`}
        // Secondary next to the group above: same control, quieter, because
        // the whole library is the larger commitment and should not be the
        // one that reads as the default.
        className={group ? 'border-line text-ink-muted hover:bg-line/10 hover:text-ink' : undefined}
        title={`Download all ${MUSIC_TRACKS.length} tracks (${formatLibrarySize(MUSIC_LIBRARY_BYTES)}) into this app's data folder. Nothing is downloaded until you press this.`}
      />
    </span>
  )
}

function stateLabel(s: MusicGroupStatus): string {
  if (s.state === 'installed') return 'Installed'
  // `partial` names the interrupted downloads separately from the missing
  // count, because they are the ones the next Resume continues rather than
  // refetches - #402. A group with nothing finished but a download stopped
  // part-way reads `Partial, 42 of 42 missing (1 interrupted)`, which is what
  // is actually on the disk, where it used to read `Not installed`.
  if (s.state === 'partial') {
    const missing = `Partial, ${s.missing} of ${s.total} missing`
    return s.partial > 0 ? `${missing} (${s.partial} interrupted)` : missing
  }
  return 'Not installed'
}

/**
 * Every group, its size, whether it is there, and one control per row.
 *
 * Rendered in the Sound panel. Outside the desktop app there is no app data
 * directory to look in, so this says it could not check rather than listing
 * five absences - "I have not looked" is not "they are not there", and folding
 * those together is what made a dev-server preview claim things about a machine
 * it cannot see.
 */
export function MusicLibraryGroups() {
  const status = useLibrary()
  useEffect(() => {
    void refreshMusicLibrary()
  }, [])
  const [busy, setBusy] = useState<string | null>(null)

  const byId: Record<string, MusicGroupStatus | undefined> = Object.fromEntries(
    (status?.groups ?? []).map((g) => [g.id, g])
  )

  return (
    <div className="mb-2 flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-ink-muted">Music library</span>
        <span className="tabular-nums text-ink-faint">
          {status
            ? `${status.installed} of ${status.total} tracks, ${formatLibrarySize(status.bytesInstalled)} of ${formatLibrarySize(status.bytesTotal)}`
            : `not checked outside the app, ${formatLibrarySize(MUSIC_LIBRARY_BYTES)} in all`}
        </span>
      </div>
      {MUSIC_GROUPS.map((group) => {
        const s = byId[group.id]
        const remaining = s ? s.bytesTotal - s.bytesInstalled : group.bytes
        return (
          // Two lines, not one (6 Sep 2026): the name, the size, the state and
          // up to two controls do not fit across a panel this narrow, and on
          // one line the name truncated to "The Old Concert ..." while the
          // buttons were pushed past the edge. Seen in the screenshot.
          <div
            key={group.id}
            className="flex flex-col gap-1 rounded border border-border px-1.5 py-1 text-xs"
          >
            <div className="flex items-baseline gap-1.5">
              <span className="min-w-0 flex-1 truncate text-ink" title={group.description}>
                {group.name}
              </span>
              <span className="shrink-0 tabular-nums text-ink-faint">
                {group.tracks.length} · {formatLibrarySize(group.bytes)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                'shrink-0',
                s?.state === 'installed'
                  ? 'text-ok'
                  : s?.state === 'partial'
                    ? 'text-warn'
                    : 'text-ink-faint'
              )}
            >
              {s ? stateLabel(s) : 'Could not check'}
            </span>
            <span className="flex-1" />
            {s && s.state !== 'installed' && (
              <MusicInstallButton
                group={group}
                label={
                  s.state === 'partial'
                    ? `Resume (${formatLibrarySize(remaining)})`
                    : `Install (${formatLibrarySize(group.bytes)})`
                }
                title={
                  s.state === 'partial'
                    ? `Download the ${s.missing} tracks of ${group.name} that are not here yet (${formatLibrarySize(remaining)}). Nothing already downloaded is fetched again.`
                    : `Download the ${group.tracks.length} tracks of ${group.name} (${formatLibrarySize(group.bytes)}) into this app's data folder.`
                }
              />
            )}
            {s && s.installed > 0 && (
              <button
                type="button"
                className="shrink-0 rounded border border-line p-1 text-ink-faint hover:text-warn disabled:opacity-40"
                disabled={busy === group.id}
                title={`Delete the ${s.installed} installed tracks of ${group.name} (${formatLibrarySize(s.bytesInstalled)}) from this app's data folder. Nothing else is touched.`}
                aria-label={`Remove ${group.name}`}
                onClick={() => {
                  setBusy(group.id)
                  void removeMusicGroup(group)
                    .then(() => {
                      // Whatever is playing may have just been deleted, so the
                      // players are told to look again rather than left holding
                      // a URL with nothing behind it.
                      resetMusicLibraryVerdict()
                      startMusic()
                    })
                    .finally(() => setBusy(null))
                }}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
