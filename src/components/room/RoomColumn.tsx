import { BattleColumn } from './BattleColumn'
import { GameChatColumn } from './GameChatColumn'

/**
 * `BattleColumn` and `GameChatColumn`, stacked back into one pane.
 *
 * The normal layout (`App.tsx`) renders the two separately — the battle
 * picture gets its own column beside the zone map instead of sharing a
 * scroll stack with the game text. This composed version exists only for
 * the paths that still expect one "the room" panel: freeform placement and
 * the pop-out `game` panel window (`panels.tsx`'s `PANEL_CONTENT.game`).
 * Neither of those has a second slot to put a separate chat pane in, so
 * they get both, stacked, same as before the split.
 */
export function RoomColumn() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <BattleColumn />
      </div>
      <div className="min-h-0 flex-1">
        <GameChatColumn />
      </div>
    </div>
  )
}
