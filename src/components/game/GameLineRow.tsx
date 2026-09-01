/**
 * One line of game text, painted.
 *
 * Its own file because two panes draw game lines now - the main window and the
 * channel tabs - and a second copy of the painting logic is a second place for
 * a highlight to behave differently. Genie users are used to a config meaning
 * one thing everywhere.
 *
 * Memoised, because the pane re-renders on every arriving line and repainting
 * four hundred rows to add one is the difference between keeping up with a
 * busy room and stuttering.
 */
import { memo } from 'react'
import { paint, segments, type Highlight } from '../../lib/highlights'
import type { GameLine } from '../../lib/gameLink'
import { cn } from '../../lib/cn'
import { formatGameDateTime, formatGameTime } from '../../lib/gameTime'

export const GameLineRow = memo(function GameLineRow({
  line,
  highlights,
  offClasses,
  showStream = false,
  showTime = false,
}: {
  line: GameLine
  highlights: Highlight[]
  /** Classes a player has muted - Genie's `#class off`, given a real toggle.
   * See lib/offClasses.ts. Optional and defaulting to nothing off, so every
   * existing call site keeps working unchanged. */
  offClasses?: ReadonlySet<string>
  /**
   * Prefix the channel name.
   *
   * Off in a channel's own tab, where every line is that channel and the
   * prefix would be forty repetitions of the same word. On in any view that
   * mixes channels, where "which of these is a thought" is the question.
   */
  showStream?: boolean
  /** A compact receive-time gutter for history, search, and event channels. */
  showTime?: boolean
}) {
  if (line.text === '') return <div className="font-mono text-xs leading-snug"> </div>

  const painted = paint(line.text, highlights, offClasses)
  const pieces = segments(line.text, painted)

  return (
    /* Monospace, because the game aligns things with spaces - the experience
       window is a column layout made of padding, and a proportional font turns
       it into a ragged mess. `whitespace-pre-wrap` for the same reason: runs of
       spaces are meaningful, and long lines still have to wrap rather than
       force a horizontal scrollbar across the pane. */
    <div
      className={cn(
        'whitespace-pre-wrap break-words font-mono text-xs leading-snug text-ink-muted',
        // The game's own emphasis, not ours. It marks room titles and shouts.
        line.bold && 'font-semibold text-ink'
      )}
    >
      {showTime && (
        <time
          dateTime={line.receivedAtMs > 0 ? new Date(line.receivedAtMs).toISOString() : undefined}
          title={formatGameDateTime(line.receivedAtMs)}
          className="mr-2 inline-block min-w-[4.5em] select-none text-right text-ink-faint"
        >
          {formatGameTime(line.receivedAtMs)}
        </time>
      )}
      {showStream && line.stream && (
        <span className="text-ink-faint">[{line.stream}] </span>
      )}
      {pieces.map((piece, i) => (
        <span key={i} style={piece.colour ? { color: piece.colour } : undefined}>
          {piece.text}
        </span>
      ))}
    </div>
  )
})
