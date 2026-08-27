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
import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Send, Plug, PlugZap, Volume2, VolumeX } from 'lucide-react'
import {
  attachGame,
  clearGame,
  detachGame,
  gameDropped,
  gameLines,
  gameState,
  refreshGameState,
  sendGame,
  subscribeGame,
  type GameLine,
} from '../../lib/gameLink'
import { invokeTauri, isTauri } from '../../lib/tauri'
import { parseHighlights, paint, segments, type Highlight } from '../../lib/highlights'
import { playAlert, setAlertsMuted, alertsMuted } from '../../lib/alertSound'
import { cn } from '../../lib/cn'

/** How many lines are in the DOM at once. */
const WINDOW = 400

/** How many more to add each time the reader reaches the top. */
const STEP = 400

/**
 * One line, painted.
 *
 * Its own component and memoised, because the pane re-renders on every arriving
 * line and repainting four hundred rows to add one is the difference between a
 * client that keeps up with a busy room and one that stutters. The props are a
 * line and the highlight list, and neither changes for a row once it exists.
 */
const GameRow = memo(function GameRow({
  line,
  highlights,
}: {
  line: GameLine
  highlights: Highlight[]
}) {
  if (line.text === '') return <div className="font-mono text-xs leading-snug"> </div>

  const painted = paint(line.text, highlights)
  const pieces = segments(line.text, painted)

  return (
    /* Monospace, because the game aligns things with spaces - the experience
       window is a column layout made of padding, and a proportional font turns
       it into a ragged mess. `whitespace-pre-wrap` for the same reason: runs
       of spaces are meaningful, and long lines still have to wrap rather than
       force a horizontal scrollbar across the pane. */
    <div className="whitespace-pre-wrap break-words font-mono text-xs leading-snug text-ink-muted">
      {pieces.map((piece, i) => (
        <span key={i} style={piece.colour ? { color: piece.colour } : undefined}>
          {piece.text}
        </span>
      ))}
    </div>
  )
})

export function GamePane() {
  const lines = useSyncExternalStore(subscribeGame, gameLines, gameLines)
  const link = useSyncExternalStore(subscribeGame, gameState, gameState)
  const dropped = useSyncExternalStore(subscribeGame, gameDropped, gameDropped)

  const [shown, setShown] = useState(WINDOW)
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

  /**
   * The player's own highlights, read from the config they already have.
   *
   * Loaded once. Re-parsing 57 entries per line would be the whole cost of
   * this feature, and the config does not change while the game is running -
   * when reloading is wanted it will be a button, not a poll.
   */
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [hlNote, setHlNote] = useState<string>('')

  useEffect(() => {
    if (!isTauri()) return
    void (async () => {
      try {
        const cfg = (await invokeTauri('read_genie_config', { leaf: 'highlights.cfg' })) as {
          found: boolean
          path: string
          text: string
          note: string
        }
        if (!cfg.found) {
          // Not a failure. A player with no config yet is a normal state, and
          // saying so beats plain grey text with no explanation.
          setHlNote(cfg.note)
          return
        }
        const { entries, skipped } = parseHighlights(cfg.text)
        setHighlights(entries)
        // Genie drops malformed entries in silence, which is the single
        // failure dr-genie-settings/validate.mjs exists to catch. Inheriting
        // the format is not a reason to inherit the bug.
        setHlNote(
          skipped.length
            ? `${entries.length} highlights, ${skipped.length} skipped`
            : `${entries.length} highlights`
        )
      } catch (e) {
        setHlNote(String(e))
      }
    })()
  }, [])

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
            <button
              type="button"
              className="rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-accent"
              onClick={() => void attachGame(11024)}
              title="Attach to a Lich running with --detachable-client=11024"
              disabled={!isTauri()}
            >
              Attach
            </button>
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
          <GameRow key={l.seq} line={l} highlights={highlights} />
        ))}

        {lines.length === 0 && (
          <p className="p-2 text-xs leading-relaxed text-ink-faint">
            Nothing yet. Start Lich with{' '}
            <code className="text-ink">--detachable-client=11024</code> and press Attach,
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
