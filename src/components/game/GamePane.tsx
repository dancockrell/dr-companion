/**
 * The game text, and the line you type into it.
 *
 * The pane that makes this a client rather than a companion. Everything else
 * in this app is a reading of the game; this is the game.
 *
 * See docs/ENGINE.md.
 *
 * # Windowed from the first commit, not retrofitted
 *
 * A MUD produces a great deal of text - eighteen movement events in ninety
 * seconds was measured in one Crossing room, each reprinting four lines - and
 * twenty thousand `<div>`s in a webview will crawl. Retrofitting that later
 * means rewriting the scroll behaviour, the highlighting and the selection all
 * at once, so it is done now while there is nothing to rewrite.
 *
 * The approach is a **tail window** rather than pixel-accurate virtual
 * scrolling, and the difference is worth stating because it is a real
 * limitation and not an oversight.
 *
 * Virtual scrolling needs to know how tall every line is to place a scrollbar,
 * and these lines wrap: a room description is one line of text and three lines
 * of pixels at one column width and two at another. Getting that right means
 * measuring every line or guessing, and a guess makes the scrollbar lie.
 *
 * So instead: render the newest N, and when the reader reaches the top of that
 * window, extend it. The scrollbar is honest about what is rendered rather
 * than pretending about what is not, and the common case - watching the bottom
 * while playing - never renders more than N. Someone hunting for something
 * said an hour ago pages back to it, which is what a search is for anyway and
 * is the next thing to build.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Plug, PlugZap, Info, Eraser, Link2, Unlink } from 'lucide-react'
import {
  attachGame,
  clearGame,
  detachGame,
  gameDropped,
  gameState,
  refreshGameState,
  subscribeGame,
  lichNote,
  type GameLine,
} from '../../lib/gameLink'
import { useGameLines } from '../../lib/useGameLines'
import { isTauri } from '../../lib/tauri'
import { paint } from '../../lib/highlights'
import { useHighlights } from '../../lib/useHighlights'
import { useOffClasses } from '../../lib/offClasses'
import { useAliases } from '../../lib/useAliases'
import { GameLineRow } from './GameLineRow'
import { playAlert, setAlertsVolume, setDangerVolume, setSpeechVolume } from '../../lib/alertSound'
import {
  setZone,
  setMusicVolume,
  setRadioStation,
  setCustomStream,
  setPlaylist,
  initMediaSession,
  setCrossfadeStyle,
} from '../../lib/ambientSound'
import { getPlaylist } from '../../lib/playlists'
import { loadPrefs } from '../../lib/persistence'
import { useAppStore } from '../../store/useAppStore'
import { cn } from '../../lib/cn'
import { instanceForPort } from '../../data/instances'

/** How many lines are in the DOM at once. */
const WINDOW = 400

/** How many more to add each time the reader reaches the top. */
const STEP = 400

/**
 * The port this app opens when it launches Lich itself, and so the sensible
 * first guess for a Lich somebody else started. Not a constraint - see the
 * port input in the header for why it has to be editable.
 */
const DEFAULT_PORT = '11024'

const PORT_KEY = 'drc.attach-port.v2'

/**
 * A port is a number in the range the OS will actually let something bind.
 *
 * Checked before enabling Attach rather than after pressing it, because the
 * failure otherwise arrives from Rust as a connection error and reads like
 * "Lich is not running" - sending somebody to debug the game when they have
 * simply typed 1102 or 110244.
 */
function validPort(v: string): boolean {
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 && n <= 65535
}

/**
 * Remembered, because a port you retype every launch is barely better than a
 * fixed one - and because remembering it wrong is worse than not remembering
 * it at all. A value saved here during fixture testing is indistinguishable
 * from a real one until Attach is pressed against a live Lich and fails, and
 * that failure presents as "Lich is not running" rather than "this app is
 * pointed at a replay". `v1` shipped with no way to tell a fixture port from
 * a real one apart once stored, and got stuck on 11124 on this machine for
 * exactly that reason. The key is versioned rather than special-cased on the
 * fixture's port number, because this app has no business knowing that port
 * exists - a version bump abandons every value stored under the old
 * contract, honestly, rather than trying to guess which old values are safe.
 */
function loadPort(): string {
  try {
    localStorage.removeItem('drc.attach-port.v1')
    const saved = localStorage.getItem(PORT_KEY)
    return saved && validPort(saved) ? saved : DEFAULT_PORT
  } catch {
    // Private mode. Losing a remembered port is not worth failing the pane.
    return DEFAULT_PORT
  }
}

/**
 * `query`/`setQuery` are lifted to GameChatColumn rather than owned here -
 * GameCommandBar's search box and this pane's own filtered scroller both
 * need the same live value, and they are siblings, not parent/child. See
 * GameCommandBar.tsx's header for the rest of that story.
 */
export function GamePane({
  query,
  setQuery,
}: {
  query: string
  setQuery: (v: string) => void
}) {
  // Subscribes and returns an array whose identity changes when the buffer
  // does, so `[lines]` in a dep array below is simply correct. This used to be
  // a raw `gameLines()` read sitting beside a separate version subscription,
  // and keeping those two things separate is what went wrong three times.
  // See useGameLines.ts's header.
  const lines = useGameLines()
  const link = useSyncExternalStore(subscribeGame, gameState, gameState)
  const dropped = useSyncExternalStore(subscribeGame, gameDropped, gameDropped)

  const [shown, setShown] = useState(WINDOW)
  const [port, setPortState] = useState<string>(loadPort)
  const setPort = (v: string) => {
    setPortState(v)
    try {
      if (validPort(v)) localStorage.setItem(PORT_KEY, v)
    } catch {
      // Private mode; the value still works for this session.
    }
  }
  const scroller = useRef<HTMLDivElement | null>(null)
  const atBottom = useRef(true)

  const { highlights, note: hlNote } = useHighlights()
  const offClasses = useOffClasses()
  // Only the denominator note is read here - expandAlias() and the aliases
  // array itself moved to GameCommandBar with `send()`. useAliases is the
  // same module-level cache either place calls it (see its own header), so
  // calling it again here costs nothing and needs no prop threaded down.
  const { aliases, note: aliasNote } = useAliases()

  useEffect(() => {
    void refreshGameState()
  }, [])

  /**
   * Alerts fire on arrival, not on render.
   *
   * A row re-renders whenever React decides to - a resize, a parent update,
   * the window growing as somebody scrolls up - and playing a sound from
   * render would replay alerts for text that arrived ten minutes ago. Only
   * the arrival of a new line is an event.
   *
   * The high-water mark is a ref rather than state: it must not cause a
   * render of its own, and it has to be correct on the very next line rather
   * than after React commits.
   */
  const soundedUpTo = useRef(0)
  useEffect(() => {
    if (!highlights.length || !lines.length) return
    const newest = lines[lines.length - 1].seq
    if (newest <= soundedUpTo.current) return

    // Only lines this component has not already considered. On the first
    // render after attaching, that is the whole buffer - so the mark starts at
    // whatever is already there rather than playing the backlog.
    const fresh = lines.filter((l) => l.seq > soundedUpTo.current)
    soundedUpTo.current = newest

    for (const l of fresh) {
      // Walk `.matched` rather than `.sounds` - it carries each entry's
      // `class` alongside its sound file, which playAlert needs to pick a
      // channel and (for classes in alertSound.ts's THROTTLE_MS_FOR_CLASS)
      // throttle by class rather than by filename. Deduped by sound name,
      // same as `.sounds` already was, so two matched entries sharing one
      // file within a line still only play it once.
      const p = paint(l.text, highlights, offClasses)
      const played = new Set<string>()
      for (const h of p.matched) {
        if (!h.sound || played.has(h.sound)) continue
        played.add(h.sound)
        playAlert(h.sound, h.cls)
      }
    }
    // `[lines]` is honest now that useGameLines() gives it a fresh identity
    // per version. It was not always: with a raw gameLines() read this effect
    // never re-ran, and sound-carrying lines streamed past the replay fixture
    // for 25s straight with playAlert never called once, while calling it
    // directly played the file correctly. That is the third occurrence of the
    // same defect, and the reason the hook exists rather than another comment.
    //
    // `offClasses` is a real dependency, not a formality: without it, muting
    // a class mid-session would keep using whichever `offClasses` value was
    // captured the last time `lines`/`highlights` changed, so the mute would
    // not actually take effect on the very next line - the exact bug the
    // comment above already describes once for `lines` itself.
  }, [lines, highlights, offClasses])

  // Anything already in the buffer when the config loads is history, not news.
  useEffect(() => {
    if (highlights.length && lines.length) {
      soundedUpTo.current = Math.max(soundedUpTo.current, lines[lines.length - 1].seq)
    }
    // Deliberately keyed on the config alone: this is about adopting a
    // starting point, and re-running it on every line would silence
    // everything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlights])

  /**
   * The ambient terrain-texture layer stays out - Dan's call, 28 Aug 2026:
   * "the idea for that ambiance is bad anyways. pull out that kind of
   * stuff. lets not." But music itself came back the same day: "i do want
   * music. not ambiant...just the music...lots of songs we had." One layer
   * now (ambientSound.ts's `music` slot), driven by the live bridge's zone
   * report rather than the room line stream this pane otherwise reads - see
   * ambientSound.ts's header for why zone rather than room, and why a
   * no-op on an unchanged zone id is the whole point.
   *
   * Persisted volumes are applied here, once, rather than read fresh by
   * alertSound.ts/ambientSound.ts themselves - those modules have no
   * opinion about storage (see their own headers), so something has to
   * hand them the remembered levels on startup. SoundControls only writes
   * the levels back out when a slider is actually moved.
   */
  useEffect(() => {
    // Once, regardless of how many times this effect's dependencies change -
    // registering the same media-key handlers twice is harmless but pointless.
    initMediaSession()
    const prefs = loadPrefs()
    setAlertsVolume(prefs.alertsVolume ?? 0)
    setDangerVolume(prefs.dangerVolume ?? 0)
    setSpeechVolume(prefs.speechVolume ?? 0)
    setMusicVolume(prefs.musicVolume ?? 0)
    setCrossfadeStyle(prefs.crossfadeStyle ?? 'standard')
    // A remembered station, custom stream, or playlist beats zone music on
    // startup, the same override relationship setZone() enforces afterward.
    // Custom stream wins if somehow more than one is set - see
    // persistence.ts's own comment. A playlist deleted since it was last
    // playing (or emptied by track pruning - see playlists.ts) is silently
    // skipped rather than handed an empty list to "play."
    if (prefs.customStreamUrl) {
      setCustomStream(prefs.customStreamUrl)
    } else if (prefs.radioStation) {
      setRadioStation(prefs.radioStation)
    } else if (prefs.activePlaylistId) {
      const pl = getPlaylist(prefs.activePlaylistId)
      if (pl && pl.trackIds.length) setPlaylist(pl.id, pl.trackIds)
    }
  }, [])
  const mapZone = useAppStore((s) => s.mapZone)
  useEffect(() => {
    setZone(mapZone?.ok ? (mapZone.zone ?? null) : null)
  }, [mapZone])

  /**
   * Follow the bottom, unless the reader has deliberately scrolled away.
   *
   * A pane that always jumps to the newest line yanks the text out from under
   * someone reading back through a fight. A pane that never follows makes you
   * chase it. The rule that works is: stick to the bottom while you are at the
   * bottom, and stop the moment you are not.
   */
  const onScroll = useCallback(() => {
    const el = scroller.current
    if (!el) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24

    // Reaching the top of the window extends it rather than stopping dead.
    if (el.scrollTop < 40) {
      setShown((n) => {
        if (n >= lines.length) return n
        // Hold the reader's place: growing the window upward would otherwise
        // shove what they are reading down the pane.
        const before = el.scrollHeight
        requestAnimationFrame(() => {
          const after = el.scrollHeight
          el.scrollTop += after - before
        })
        return Math.min(lines.length, n + STEP)
      })
    }
  }, [lines.length])

  useEffect(() => {
    const el = scroller.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
  }, [lines])

  /**
   * Search the scrollback.
   *
   * This file's own header named it - "which is what a search is for anyway
   * and is the next thing to build" - and the reason is the virtualised tail:
   * only the newest `shown` lines are rendered, so something said an hour ago
   * cannot be found by eye without paging back to it.
   *
   * A filter rather than a jump-to-next-match. Filtering answers the question
   * people actually have in a MUD - "what did Wipsy say", "when did I last see
   * that creature" - and it answers it across the *whole* buffer rather than
   * the rendered window, which is the entire point.
   *
   * Plain case-insensitive substring, not a regex. A regex box invites a typo
   * that silently matches nothing, and "no results" and "your pattern is
   * broken" would render identically - which is the failure this app has been
   * bitten by repeatedly. A literal substring can only fail in the way the
   * reader expects.
   *
   * Searching the whole buffer, not `visible`: a search restricted to what
   * happens to be rendered would be a search that lies about what it looked at.
   */
  const trimmedQuery = query.trim()
  const searching = trimmedQuery.length > 0

  const matches: GameLine[] = searching
    ? lines.filter((l) => l.text.toLowerCase().includes(trimmedQuery.toLowerCase()))
    : []

  /**
   * While searching, the pane shows matches and nothing else.
   *
   * The window cap still applies, so a query matching thousands does not
   * render thousands - but it is applied *after* filtering, so the newest
   * matches are the ones kept rather than the newest lines.
   */
  const visible: GameLine[] = searching
    ? matches.length > shown
      ? matches.slice(-shown)
      : matches
    : lines.length > shown
      ? lines.slice(-shown)
      : lines

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* min-w-0, and the notes truncate, so the row can actually shrink.
        * Without it every child keeps its content width, the row grows past
        * the pane, and the overflow is clipped rather than scrolled. Measured
        * on the real app at an 1180px window: this row ended at x=1232, so
        * the Attach button sat 52px off the right edge where it could not be
        * clicked - while the pane beside it read "not attached". The control
        * that fixes the problem was the one the problem hid. */}
      <div className="flex min-w-0 shrink-0 items-center gap-2 border-b border-border px-2 py-1 text-xs">
        {/* No "Game" label - this row sits directly above the game text and
            nothing else in this pane could be mistaken for something else.
            A section label earns its place only where the content beneath
            it is ambiguous without one. */}
        {/* Connected or not, as a fact - carried by the icon's own colour
          * and shape, not repeated in words beside it. The text this used to
          * show was `link.connected ? 'Attached' : link.note || 'not
          * attached'`, and `note` is hardcoded to `''` while disconnected
          * (see gameLink.ts), so that branch was always the literal string
          * "not attached" - never a real, situation-specific message. Every
          * bit of information this row carried was already in the icon;
          * the words were reserving 4.5rem for a fact restated, not a fact
          * added. The full detail - "Attached", or the host:port this app
          * would attach to - is still one hover away in the title. */}
        <span
          className={cn('flex shrink-0 items-center', link.connected ? 'text-good' : 'text-ink-faint')}
          title={link.connected ? 'Attached' : link.note || `Not attached (${link.host}:${link.port})`}
        >
          {link.connected ? (
            <PlugZap className="h-3 w-3" />
          ) : (
            <Plug className="h-3 w-3" />
          )}
        </span>

        {/* "Connection lost" was the same sentence whether our socket dropped
            or Lich exited underneath us, and those need opposite actions -
            press Attach, or restart Lich first. Lich exits by itself when the
            game server hangs up, so this is the common case, not the exotic
            one. Only shown while detached, and silent when the probe could not
            answer: an unproven claim about Lich would send somebody to restart
            a process that is running fine. See lichNote(). */}
        {!link.connected && lichNote(link.lich) && (
          <span
            className={cn(link.lich === 'gone' ? 'text-warn' : 'text-ink-faint')}
            title="Checked by probing the port, not inferred from the disconnect"
          >
            {lichNote(link.lich)}
          </span>
        )}

        {/* Highlight and alias status, folded into one icon rather than two
          * running text spans - "my highlights are not working" still needs
          * to be answerable (otherwise it is indistinguishable from "nothing
          * has matched yet"), and the alias count still needs its
          * denominator (see useAliases), but neither is something a player
          * reads on every glance at this row. Both were losing a fight for
          * width against the scrollback search box they sat directly next
          * to - the fix is the same one applied to the row's other status
          * text, not a narrower column for words that were already visible
          * in full one hover away. */}
        {(hlNote || aliasNote) && (
          <span
            className="flex shrink-0 items-center text-ink-faint"
            title={[hlNote, aliasNote ? `${aliases.length} aliases` : null].filter(Boolean).join(' · ')}
          >
            <Info className="h-3 w-3" />
          </span>
        )}

        {/* Said out loud rather than left as a mystery about missing text. */}
        {dropped > 0 && (
          <span className="text-warn" title="Scrollback is capped at 20,000 lines">
            {dropped} older lines dropped
          </span>
        )}

        {/* shrink-0: the connection controls are the last thing that may be
          * given up, not the first. Everything to the left of this truncates
          * instead. They already learned this once and moved Sound to the
          * footer for it - "a control living only in this scrollable pane's
          * own header disappeared the moment the pane scrolled". Same lesson,
          * horizontal axis. */}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {/* Sound moved to SafetyFooter (the persistent bottom bar) - a
              control living only in this scrollable pane's own header
              disappeared the moment the pane scrolled, and the footer is
              the one place that's always on screen. */}
          <button
            type="button"
            className="rounded p-1 text-ink-faint hover:text-ink"
            onClick={clearGame}
            title="Clear the scrollback. The connection is untouched."
            aria-label="Clear the scrollback"
          >
            <Eraser className="h-3.5 w-3.5" />
          </button>
          {link.connected ? (
            <button
              type="button"
              className="rounded border border-border p-1 text-ink-muted hover:text-ink"
              onClick={() => void detachGame()}
              title="Detach"
              aria-label="Detach"
            >
              <Unlink className="h-3.5 w-3.5" />
            </button>
          ) : (
            <>
              {/* The port is editable, and it needs to be.
                *
                * This was hardcoded to 11024, which is right for a Lich this
                * app launched itself and wrong for every other case: a Lich
                * someone started by hand on another port, a second character
                * on a second port, or the replay fixture, which now defaults
                * to 11124 specifically so it stops squatting on the real one.
                * With a fixed button none of those was reachable - the pane
                * said "nothing yet" and there was no way to tell it where to
                * look. */}
              {isTauri() ? (
                <>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={port}
                    onChange={(e) =>
                      setPort(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))
                    }
                    className="w-14 rounded border border-border bg-surface px-1 py-0.5 text-center tabular-nums text-ink-muted"
                    title="The port Lich opened with --detachable-client. 11024 is what this app uses when it launches Lich itself."
                  />
                  <button
                    type="button"
                    className="rounded border border-accent/40 bg-accent/10 p-1 text-accent disabled:opacity-40"
                    onClick={() => void attachGame(Number(port))}
                    title={`Attach to a Lich running with --detachable-client=${port}`}
                    aria-label="Attach"
                    disabled={!validPort(port)}
                  >
                    <Link2 className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : (
                <span className="text-ink-faint" title="Game attachment is available in the DR Companion desktop app">
                  Browser preview
                </span>
              )}
            </>
          )}
        </span>
      </div>

      <div
        ref={scroller}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto px-2 py-1"
      >
        {/* A filtered pane and a quiet game look identical, and that is the
          * failure mode this app has paid for more than any other. So while a
          * search is active the pane says so at the top of its own scroller,
          * in the reader's line of sight rather than only in the header, and
          * states the denominator: how many matched, out of how many lines
          * were actually looked at. "3 lines" alone could mean a quiet room. */}
        {searching && (
          <div className="sticky top-0 z-10 -mx-2 mb-1 flex items-center justify-between gap-2 border-b border-accent/30 bg-surface-raised px-2 py-1 text-xs">
            <span className="text-accent">
              {matches.length === 0
                ? `No match for “${trimmedQuery}” in ${lines.length.toLocaleString()} lines`
                : `${matches.length.toLocaleString()} of ${lines.length.toLocaleString()} lines match “${trimmedQuery}”`}
            </span>
            <button
              type="button"
              onClick={() => setQuery('')}
              className="shrink-0 rounded border border-border px-1.5 text-ink-muted hover:bg-surface-overlay hover:text-ink"
            >
              Clear
            </button>
          </div>
        )}

        {/* Only meaningful when not filtering - while searching, `shown` caps
          * matches rather than lines, so this count would describe something
          * the reader is not looking at. */}
        {!searching && lines.length > shown && (
          <div className="py-1 text-center text-xs text-ink-faint">
            {lines.length - shown} earlier lines, scroll up to load
          </div>
        )}
        {searching && matches.length > shown && (
          <div className="py-1 text-center text-xs text-ink-faint">
            showing the newest {shown.toLocaleString()} matches
          </div>
        )}

        {visible.map((l) => (
          <GameLineRow key={l.seq} line={l} highlights={highlights} offClasses={offClasses} />
        ))}

        {lines.length === 0 && (
          <p className="p-2 text-xs leading-relaxed text-ink-faint">
            Nothing yet. Start Lich with{' '}
            <code className="text-ink">--detachable-client={port}</code>
            {/* Which game that port is, when it is one of the four.
              *
              * This sentence is an instruction, and it was interpolating a
              * remembered number without saying what the number meant. Seen on
              * the real app: it read `--detachable-client=11124` while the
              * character was on Prime. 11124 is Platinum. Following it exactly
              * would have started Lich on the wrong instance, and the failure
              * arrives as "Lich is not running".
              *
              * Unrecognised ports stay unlabelled rather than guessed at. */}
            {instanceForPort(port) && (
              <span className="text-ink-muted">
                {' '}
                (DragonRealms {instanceForPort(port)?.label})
              </span>
            )}{' '}
            and press Attach, and this becomes the client rather than a panel beside one.
          </p>
        )}
      </div>
    </div>
  )
}
