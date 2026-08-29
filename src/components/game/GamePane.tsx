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
import { Send, Plug, PlugZap } from 'lucide-react'
import {
  attachGame,
  clearGame,
  detachGame,
  gameDropped,
  gameState,
  refreshGameState,
  sendGame,
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
import { expandAlias } from '../../lib/aliases'
import { GameLineRow } from './GameLineRow'
import { playAlert, setAlertsVolume, setDangerVolume, setSpeechVolume } from '../../lib/alertSound'
import {
  setZone,
  setMusicVolume,
  setRadioStation,
  setCustomStream,
  initMediaSession,
  setCrossfadeStyle,
} from '../../lib/ambientSound'
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

export function GamePane() {
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
  const [command, setCommand] = useState('')

  /**
   * Command history, the way every MUD client has done it since 1990.
   *
   * `index` is a position from the end, so a new command entering the list
   * does not shift where the reader is. -1 means "not browsing".
   */
  const [history, setHistory] = useState<string[]>([])
  const [historyAt, setHistoryAt] = useState(-1)

  const scroller = useRef<HTMLDivElement | null>(null)
  const atBottom = useRef(true)

  const { highlights, note: hlNote } = useHighlights()
  const offClasses = useOffClasses()
  const { aliases, note: aliasNote } = useAliases()

  /** What the last typed line expanded to, or empty. Cleared by the next send. */
  const [expansion, setExpansion] = useState('')

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
    // A remembered station or custom stream beats zone music on startup, the
    // same override relationship setZone() enforces afterward. Custom stream
    // wins if somehow both are set - see persistence.ts's own comment.
    if (prefs.customStreamUrl) {
      setCustomStream(prefs.customStreamUrl)
    } else if (prefs.radioStation) {
      setRadioStation(prefs.radioStation)
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
  const [query, setQuery] = useState('')
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

  const send = () => {
    const text = command.trim()
    if (!text) return

    /**
     * Aliases expand here, at the one place a typed line becomes a game
     * command.
     *
     * Shown, never silent. `appc sword` reaching the game as `appraise sword
     * careful` is the whole point of the feature, and a player who cannot see
     * what was actually sent has no way to find a wrong alias - the game
     * simply does something they did not ask for. So the expansion stays on
     * screen until the next line is typed.
     *
     * `capped` means a cycle or the depth limit. The partly-expanded text
     * still goes out, because refusing to send is a worse surprise than
     * sending something the player can see, but the chain is named so they
     * can find which alias is looping.
     */
    const { text: outgoing, expanded, chain, capped } = expandAlias(text, aliases)
    setExpansion(
      capped
        ? `${text} → ${outgoing} (chain stopped: ${chain.join(' → ')})`
        : expanded
          ? `${text} → ${outgoing}`
          : ''
    )

    void sendGame(outgoing).catch(() => {
      /* The link reports its own failure; a toast here would be a second one. */
    })
    // History keeps what was typed, not what was sent. Up-arrow is for
    // retyping your own line, and handing back the expansion would make the
    // alias unrecoverable after one press.
    setHistory((h) => (h[h.length - 1] === text ? h : [...h, text].slice(-500)))
    setHistoryAt(-1)
    setCommand('')
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      send()
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!history.length) return
      const next = historyAt < 0 ? history.length - 1 : Math.max(0, historyAt - 1)
      setHistoryAt(next)
      setCommand(history[next])
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyAt < 0) return
      const next = historyAt + 1
      if (next >= history.length) {
        setHistoryAt(-1)
        setCommand('')
      } else {
        setHistoryAt(next)
        setCommand(history[next])
      }
    }
  }

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
        <span className="shrink-0 font-medium uppercase tracking-wider text-ink-faint">Game</span>

        {/* Connected or not, as a fact.
          *
          * An empty pane means "nothing has happened" and "we are not attached"
          * and those need different actions from the player. The line count is
          * here for the same reason: it is the denominator, and a pane that is
          * empty because the parse dropped everything looks exactly like one
          * that is empty because the room is quiet. */}
        <span
          className={cn(
            'flex min-w-0 items-center gap-1',
            link.connected ? 'text-good' : 'text-ink-faint'
          )}
          title={link.note || `${link.host}:${link.port}`}
        >
          {link.connected ? (
            <PlugZap className="h-3 w-3 shrink-0" />
          ) : (
            <Plug className="h-3 w-3 shrink-0" />
          )}
          {/* truncate, like hlNote and aliasNote already do - link.note is the
            * one unbounded string in this row that was not allowed to give up
            * width, so a long disconnect reason pushed the controls off.
            *
            * With a floor, though. Plain `truncate` inside a `min-w-0` parent
            * shrinks to nothing when the row is tight, and it did: measured at
            * 0px wide, so the pane reported neither "Attached" nor "not
            * attached" and looked like it had no opinion. Whether you are
            * connected is the second most important thing in this row after
            * the button that connects you, and second place still outranks
            * the search box. 4.5rem keeps a readable stub; the full string
            * stays in the title. */}
          <span className="min-w-[4.5rem] truncate">
            {link.connected ? 'Attached' : link.note || 'not attached'}
          </span>
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

        {/* Said out loud, because "my highlights are not working" is otherwise
            indistinguishable from "nothing has matched yet". */}
        {hlNote && (
          <span className="truncate text-ink-faint" title={hlNote}>
            {hlNote}
          </span>
        )}

        {/* The alias count carries its denominator - see useAliases. */}
        {aliasNote && (
          <span className="truncate text-ink-faint" title={aliasNote}>
            {aliases.length} aliases
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
          {/* Searches the whole buffer, not the rendered window - see the
            * `matches` note. Escape clears, because a filter you cannot get
            * out of quickly is one people stop using. */}
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                setQuery('')
              }
            }}
            placeholder="Find in scrollback"
            title="Filter the whole scrollback, including lines older than the rendered window. Plain text, not a pattern. Escape clears."
            className="w-32 rounded border border-border bg-surface px-1.5 py-0.5 text-ink-muted placeholder:text-ink-faint focus:border-accent/40 focus:text-ink"
          />
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-ink-faint hover:text-ink"
            onClick={clearGame}
            title="Clear the scrollback. The connection is untouched."
          >
            Clear
          </button>
          {link.connected ? (
            <button
              type="button"
              className="rounded border border-border px-1.5 py-0.5 text-ink-muted hover:text-ink"
              onClick={() => void detachGame()}
            >
              Detach
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
              <input
                type="text"
                inputMode="numeric"
                value={port}
                onChange={(e) =>
                  setPort(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))
                }
                className="w-14 rounded border border-border bg-surface px-1 py-0.5 text-center tabular-nums text-ink-muted"
                title="The port Lich opened with --detachable-client. 11024 is what this app uses when it launches Lich itself."
                disabled={!isTauri()}
              />
              <button
                type="button"
                className="rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-accent disabled:opacity-40"
                onClick={() => void attachGame(Number(port))}
                title={`Attach to a Lich running with --detachable-client=${port}`}
                disabled={!isTauri() || !validPort(port)}
              >
                Attach
              </button>
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

      {/* What the last line actually became, when an alias changed it.
          Directly above the input, because that is where the player is
          looking, and it is the only way to tell a wrong alias from the game
          misbehaving. */}
      {expansion && (
        <div
          className="shrink-0 truncate border-t border-border px-2 py-0.5 font-mono text-xs text-ink-faint"
          title={expansion}
        >
          {expansion}
        </div>
      )}

      <div className="flex shrink-0 items-center gap-1 border-t border-border p-1.5">
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={onKey}
          placeholder={link.connected ? 'Command, then Enter' : 'Not attached'}
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 font-mono text-xs text-ink placeholder:text-ink-faint focus:border-accent/60 focus:outline-none"
        />
        <button
          type="button"
          onClick={send}
          className="shrink-0 rounded border border-border p-1.5 text-ink-faint hover:text-ink"
          title="Send" aria-label="Send"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
