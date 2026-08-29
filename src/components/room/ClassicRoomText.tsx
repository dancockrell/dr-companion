import { HighlightedText } from './HighlightedText'
import { useDragScroll } from '../../lib/useDragScroll'
import type { Highlight } from '../../lib/highlights'

/**
 * The room, read the way the game itself hands it to a player — a
 * bracketed title, the prose, then the two summary lines DragonRealms
 * always sends after it: what's lying around, and who else is here. Real
 * clients colour these four pieces differently on sight (title, body,
 * objects, people), and this box does the same rather than the one flat
 * paragraph this app used to draw, because that coding is not decoration —
 * it is how a player already reads a room line at a glance without parsing
 * the words.
 *
 * Every line here is built from data this app already had; nothing new is
 * scraped or invented to fill it in. A line whose data is absent (no
 * exits known yet, an empty room) does not print a claim it cannot back —
 * it just does not render, the same "silence over a guess" rule the rest
 * of this app follows.
 *
 * Bounded and scrollable by grab-and-drag (`useDragScroll`) rather than
 * left to push the rest of the pane down — a full classic room line with
 * a crowded object list and a dozen names in it can run long, and a fixed
 * box with its own scroll keeps the actions bar and the rest of the
 * column from jumping every time the character walks somewhere new.
 */

const listFormatter = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' })

const MAX_HEIGHT_PX = 190

export function ClassicRoomText({
  title,
  text,
  items,
  players,
  exits,
  highlights,
  offClasses,
}: {
  title?: string | null
  text?: string | null
  /** The floor — same feed the battle board's item corner reads. */
  items?: string[]
  /** Same feed the battle board's PCs corner reads. */
  players?: string[]
  /** Real compass directions ("north", "out"), from the live stream's own
   * compass tag (`StreamCharacterState.compass`) — not `MapRoom.exits`,
   * which is a list of Lich room ids the cartographer drew a link to, and
   * printed "2, 335, 7" instead of a direction the one time this line
   * pulled from it by mistake. */
  exits?: string[]
  highlights: Highlight[]
  offClasses?: ReadonlySet<string>
}) {
  const drag = useDragScroll()

  return (
    <div
      ref={drag.ref}
      onPointerDown={drag.onPointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerUp}
      onPointerCancel={drag.onPointerCancel}
      className="no-scrollbar cursor-grab touch-none overflow-y-auto active:cursor-grabbing"
      style={{ maxHeight: MAX_HEIGHT_PX }}
    >
      {title && <p className="text-xs font-semibold text-warn">[{title}]</p>}

      {text ? (
        <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
          <HighlightedText text={text} highlights={highlights} offClasses={offClasses} />
        </p>
      ) : (
        <p className="mt-0.5 text-xs text-ink-faint">No description for this room.</p>
      )}

      {items && items.length > 0 && (
        <p className="mt-1 text-xs leading-relaxed text-ink-faint">
          You also see {listFormatter.format(items)}.
        </p>
      )}

      {players && players.length > 0 && (
        <p className="mt-1 text-xs leading-relaxed text-info">Also here: {listFormatter.format(players)}.</p>
      )}

      {exits && exits.length > 0 && (
        <p className="mt-1 text-xs leading-relaxed text-ink-faint">
          Obvious paths: {listFormatter.format(exits)}.
        </p>
      )}
    </div>
  )
}
