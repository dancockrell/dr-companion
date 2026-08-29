import { useState } from 'react'
import { StreamTabs } from '../game/StreamTabs'
import { GamePane } from '../game/GamePane'
import { PanelBoundary } from '../shared/PanelBoundary'
import { Splitter } from '../layout/Splitter'
import { useHighlights } from '../../lib/useHighlights'

const SPLIT_KEY = 'drc.game-chat-split.v2'
/** A flat ratio, not pixels - this pane's own width varies with the
 *  dashboard/battle splitters and the window itself, and a ratio survives
 *  both. Bumped to .v2 with the switch from a vertical stack to a
 *  side-by-side layout - a saved height-split ratio under the old key would
 *  otherwise silently get reinterpreted as a width-split, which is a
 *  different number wearing the old one's name. */
const DEFAULT_SHARE = 0.6
const MIN_SHARE = 0.25
const MAX_SHARE = 0.8

/**
 * The game itself, and the channels pulled out of it - side by side.
 *
 * Split out of what used to be `RoomColumn` — the picture and the text were
 * one scrolling stack, competing for the same vertical space at two
 * different reading paces: the room picture is glanced at, this is read
 * continuously. Now it is its own pane, paired under the zone map (see
 * `App.tsx`) rather than under the battle picture, because a map and a
 * conversation log are both things you keep half an eye on while doing
 * something else — the battle picture is not.
 *
 * Side by side rather than stacked (29 Aug 2026, Dan: the two "live in
 * separate and wasted large windows with lots of horizontal space" -
 * stacking gave each one the column's full width for a text log that
 * does not need it, while paying for that width twice over in height. Both
 * are scrolling text feeds at roughly the same reading pace, the same shape
 * as a MUD client's main window next to a tell/gossip window, so a shared
 * row costs one pane's worth of height instead of two - freed straight to
 * the map splitter above this column.
 */
export function GameChatColumn() {
  const { highlights } = useHighlights()

  /**
   * How the row splits between Game and Channels, player-set.
   *
   * Was a flat flex-[3]/flex-[2] ratio with no way to change it - a decision
   * made on the player's behalf every session. Channels wants to be small by
   * default (it is a supplement, not the thing being read) and able to grow
   * the moment speech or combat gets busy enough to want a bigger window on
   * it, without Game losing the room to be usable while that happens.
   */
  const [share, setShareState] = useState<number>(() => {
    const saved = Number(localStorage.getItem(SPLIT_KEY))
    return Number.isFinite(saved) && saved >= MIN_SHARE && saved <= MAX_SHARE ? saved : DEFAULT_SHARE
  })
  const setShare = (v: number) => {
    const next = Math.min(MAX_SHARE, Math.max(MIN_SHARE, v))
    setShareState(next)
    try {
      localStorage.setItem(SPLIT_KEY, String(next))
    } catch {
      // Private mode. Losing a divider position is not worth an error.
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-row gap-2 p-2">
      {/* The game itself, beside the channels rather than above them.
        *
        * This is the pane that turns the app from a companion into a client:
        * every line the game sends, and the line you type back. The channel
        * tabs beside it stay, because speech and combat are worth pulling out
        * of the firehose - but the firehose has to exist first. See
        * docs/ENGINE.md.
        *
        * Given the larger share by default because it is the thing being
        * read continuously - but the splitter beside it lets that change. */}
      <div
        className="flex min-w-0 flex-col overflow-hidden rounded border border-border bg-surface-raised"
        style={{ flexGrow: share, flexBasis: 0 }}
      >
        <PanelBoundary label="Game">
          <GamePane />
        </PanelBoundary>
      </div>

      <Splitter orientation="vertical" value={share} onChange={setShare} min={MIN_SHARE} max={MAX_SHARE} />

      <div
        className="flex min-w-0 flex-col rounded border border-border bg-surface-raised"
        style={{ flexGrow: 1 - share, flexBasis: 0 }}
      >
        <PanelBoundary label="Channels">
          <StreamTabs highlights={highlights} />
        </PanelBoundary>
      </div>
    </div>
  )
}
