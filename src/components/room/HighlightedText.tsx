import { paint, segments, type Highlight } from '../../lib/highlights.ts'

/**
 * Room text, painted with the player's own highlight config.
 *
 * `paint`/`segments` (lib/highlights.ts) already run on any string — nothing
 * about them is coupled to a live game line, `GameLineRow`'s own caller is
 * just the only one that has existed so far. A room description is exactly
 * the same kind of text the game itself sends on arrival, and a hostile's
 * name in the description deserves the same colour it gets three seconds
 * later when `assess` mentions it again — one config, meaning one thing
 * everywhere it appears, not just in the stream.
 *
 * Sound is deliberately not wired up here. `paint()` returns `.sounds` for
 * whatever matched, and something upstream of `GameLineRow` decides when to
 * actually play one — for a live line, once, when it arrives. A description
 * re-paints on every render of this component, including ones nothing new
 * happened for (a re-render from an unrelated state change), so triggering
 * `.sounds` here would mean an alert chime replaying for text that has been
 * sitting on screen the whole time. Consuming only `.spans`/`.matched` and
 * ignoring `.sounds` entirely is the fix, not a missing feature.
 */
export function HighlightedText({
  text,
  highlights,
  offClasses,
  className,
}: {
  text: string
  highlights: Highlight[]
  offClasses?: ReadonlySet<string>
  className?: string
}) {
  const painted = paint(text, highlights, offClasses)
  const pieces = segments(text, painted)

  return (
    <span className={className}>
      {pieces.map((piece, i) => (
        <span key={i} style={piece.colour ? { color: piece.colour } : undefined}>
          {piece.text}
        </span>
      ))}
    </span>
  )
}
