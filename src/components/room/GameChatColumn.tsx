import { useState } from 'react'
import { MessageSquareText } from 'lucide-react'
import { StreamTabs } from '../game/StreamTabs'
import { GameCommandBar } from '../game/GameCommandBar'
import { PanelBoundary } from '../shared/PanelBoundary'
import { useHighlights } from '../../lib/useHighlights'
import { TaskFlowPanel } from '../dashboard/TaskFlowPanel'
import { GameConnectionBar } from '../game/GameConnectionBar'

/**
 * The large lower-left workspace is deliberately split, not switched. The
 * game transcript and command entry stay visible while scripts and taskflows
 * occupy a permanent neighbouring pane. A running workflow should never hide
 * the game output a player needs to supervise it.
 */
export function GameChatColumn() {
  const { highlights } = useHighlights()
  const [query, setQuery] = useState('')

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1 p-1" aria-label="Game and automation workspace">
      <section className="flex min-h-0 min-w-0 flex-col gap-2" aria-label="Game workspace">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-border bg-surface-raised">
          <GameConnectionBar />
          <PanelBoundary label="Game and channels">
            <StreamTabs
              highlights={highlights}
              heading={<><MessageSquareText className="h-4 w-4" aria-hidden /><span>Game</span></>}
            />
          </PanelBoundary>
        </div>
        <GameCommandBar query={query} setQuery={setQuery} />
      </section>

      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded border border-border bg-surface-raised" aria-label="Functions and scripts workspace">
        <div className="min-h-0 flex-1 overflow-hidden"><TaskFlowPanel title="Functions & scripts" /></div>
      </section>
    </div>
  )
}
