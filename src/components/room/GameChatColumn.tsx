import { useState } from 'react'
import { MessageSquareText } from 'lucide-react'
import { StreamTabs } from '../game/StreamTabs'
import { GameCommandBar } from '../game/GameCommandBar'
import { PanelBoundary } from '../shared/PanelBoundary'
import { useHighlights } from '../../lib/useHighlights'
import { GameConnectionBar } from '../game/GameConnectionBar'

/**
 * The transcript: what the game said, and the line you type back.
 *
 * This used to be half of a two-column workspace, with `TaskFlowPanel`
 * (Functions & scripts) permanently beside it. That split was right and its
 * reason still holds - a running workflow must never hide the game output a
 * player needs to supervise it - but the approved frame
 * (`docs/mockups/dr-companion-isometric-mvp.html`) makes the same
 * arrangement one level further out: the console row is `228px | 1fr |
 * 250px`, scripts occupy its left cell and this occupies the middle. Both
 * are still on screen at once, which was the entire point; they are arranged
 * by the frame now rather than by a grid inside this component, so the
 * transcript gets the width the row gives it instead of exactly half.
 *
 * `GameConnectionBar` stays mounted in here. It is not decoration - it owns
 * attaching to Lich - and `tools/game-connection-owner-test.mjs` exists to
 * stop it acquiring a second home.
 */
export function GameChatColumn() {
  const { highlights } = useHighlights()
  const [query, setQuery] = useState('')

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col gap-1 p-1"
      aria-label="Game workspace"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-border bg-surface-raised">
        <GameConnectionBar />
        <PanelBoundary label="Game and channels">
          <StreamTabs
            highlights={highlights}
            query={query}
            heading={<><MessageSquareText className="h-4 w-4" aria-hidden /><span>Game</span></>}
          />
        </PanelBoundary>
      </div>
      <GameCommandBar query={query} setQuery={setQuery} />
    </section>
  )
}
