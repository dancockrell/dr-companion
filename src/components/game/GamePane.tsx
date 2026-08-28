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
import { Send, Plug, PlugZap, Volume2, VolumeX, Music, Music2 } from 'lucide-react'
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
import { GameLineRow } from './GameLineRow'
import { playAlert, setAlertsMuted, alertsMuted } from '../../lib/alertSound'
import { setZone, setAmbienceMuted, ambienceMuted } from '../../lib/ambientSound'
import { useAppStore } from '../../store/useAppStore'
import { cn } from '../../lib/cn'

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
      for (const s of paint(l.text, highlights).sounds) playAlert(s)
    }
    // `[lines]` is honest now that useGameLines() gives it a fresh identity
    // per version. It was not always: with a raw gameLines() read this effect
    // never re-ran, and sound-carrying lines streamed past the replay fixture
    // for 25s straight with playAlert never called once, while calling it
    // directly played the file correctly. That is the third occurrence of the
    // same defect, and the reason the hook exists rather than another comment.
  }, [lines, highlights])

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

  const [muted, setMuted] = useState(alertsMuted())

  /**
   * The background layer: terrain ambience plus per-zone music, driven by the
   * live bridge's zone report rather than the room line stream this pane
   * otherwise reads. See ambientSound.ts's header for why zone rather than
   * room, and why a no-op on an unchanged zone id is the whole point.
   */
  const mapZone = useAppStore((s) => s.mapZone)
  useEffect(() => {
    setZone(mapZone?.ok ? (mapZone.zone ?? null) : null)
  }, [mapZone])
  const [ambienceOff, setAmbienceOff] = useState(ambienceMuted())

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

  const visible: GameLine[] = lines.length > shown ? lines.slice(-shown) : lines

  const send = () => {
    const text = command.trim()
    if (!text) return
    void sendGame(text).catch(() => {
      /* The link reports its own failure; a toast here would be a second one. */
    })
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
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1 text-xs">
        <span className="font-medium uppercase tracking-wider text-ink-faint">Game</span>

        {/* Connected or not, as a fact.
          *
          * An empty pane means "nothing has happened" and "we are not attached"
          * and those need different actions from the player. The line count is
          * here for the same reason: it is the denominator, and a pane that is
          * empty because the parse dropped everything looks exactly like one
          * that is empty because the room is quiet. */}
        <span
          className={cn(
            'flex items-center gap-1',
            link.connected ? 'text-good' : 'text-ink-faint'
          )}
          title={link.note || `${link.host}:${link.port}`}
        >
          {link.connected ? <PlugZap className="h-3 w-3" /> : <Plug className="h-3 w-3" />}
          {link.connected ? `${link.host}:${link.port}` : link.note || 'not attached'}
        </span>

        {link.connected && (
          <span className="tabular-nums text-ink-faint">{link.lines} lines</span>
        )}

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

        {/* Said out loud rather than left as a mystery about missing text. */}
        {dropped > 0 && (
          <span className="text-warn" title="Scrollback is capped at 20,000 lines">
            {dropped} older lines dropped
          </span>
        )}

        <span className="ml-auto flex items-center gap-1">
          {/* Mute, and it is a real control rather than a courtesy.
            *
            * The corpus is deliberately quiet - 13 of 57 entries make a sound -
            * because a client that pings constantly gets muted at the operating
            * system, and a client muted there has no alerts at all including
            * the idle warning that costs a session. A mute inside the app is
            * how somebody turns it down for an hour instead of forever. */}
          <button
            type="button"
            className={cn(
              'rounded px-1.5 py-0.5',
              muted ? 'text-warn' : 'text-ink-faint hover:text-ink'
            )}
            onClick={() => {
              const next = !muted
              setMuted(next)
              setAlertsMuted(next)
            }}
            title={muted ? 'Alerts are muted' : 'Mute alerts'}
          >
            {muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
          </button>
          {/* Ambience: terrain and per-zone music, separate from alerts on
            * purpose - somebody who wants the idle warning but not a music bed
            * running under everything should be able to have exactly that. */}
          <button
            type="button"
            className={cn(
              'rounded px-1.5 py-0.5',
              ambienceOff ? 'text-warn' : 'text-ink-faint hover:text-ink'
            )}
            onClick={() => {
              const next = !ambienceOff
              setAmbienceOff(next)
              setAmbienceMuted(next)
            }}
            title={ambienceOff ? 'Ambience is muted' : 'Mute ambience'}
          >
            {ambienceOff ? <Music2 className="h-3 w-3" /> : <Music className="h-3 w-3" />}
          </button>
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
        {lines.length > shown && (
          <div className="py-1 text-center text-xs text-ink-faint">
            {lines.length - shown} earlier lines, scroll up to load
          </div>
        )}

        {visible.map((l) => (
          <GameLineRow key={l.seq} line={l} highlights={highlights} />
        ))}

        {lines.length === 0 && (
          <p className="p-2 text-xs leading-relaxed text-ink-faint">
            Nothing yet. Start Lich with{' '}
            <code className="text-ink">--detachable-client={port}</code> and press Attach,
            and this becomes the client rather than a panel beside one.
          </p>
        )}
      </div>

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
          title="Send"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
