import { useState } from 'react'
import { ListTodo, X } from 'lucide-react'
import { StreamTabs } from '../game/StreamTabs'
import { GameCommandBar } from '../game/GameCommandBar'
import { PanelBoundary } from '../shared/PanelBoundary'
import { useHighlights } from '../../lib/useHighlights'
import { TaskFlowPanel } from '../dashboard/TaskFlowPanel'

/**
 * The always-available game stream and one selected channel.
 *
 * Tasks previously occupied half this pane. That made the actual game log a
 * narrow companion to automation controls and violated the primary-client
 * layout: the game stays open, while alternate channels fold into the tab
 * strip with unread badges. Tasks remain reachable from Quick Switch and the
 * command palette without permanently taking play-space from the map.
 */
export function GameChatColumn() {
  const { highlights } = useHighlights()
  const [query, setQuery] = useState('')
  const [tasksOpen, setTasksOpen] = useState(false)

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-border bg-surface-raised">
        <PanelBoundary label="Game and channels">
          <StreamTabs highlights={highlights} />
        </PanelBoundary>
        <button
          type="button"
          onClick={() => setTasksOpen(true)}
          title="Open tasks and scripts over the game stream"
          aria-label="Open tasks and scripts"
          className="absolute right-2 top-1.5 z-20 grid h-7 w-7 place-items-center rounded border border-border bg-surface/90 text-ink-faint hover:bg-surface-overlay hover:text-ink"
        >
          <ListTodo className="h-4 w-4" />
        </button>
        {tasksOpen && (
          <div className="absolute inset-0 z-30 flex flex-col bg-surface-overlay/98 backdrop-blur-sm">
            <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Tasks &amp; scripts</span>
              <button type="button" onClick={() => setTasksOpen(false)} aria-label="Close tasks and scripts" className="rounded p-1 text-ink-faint hover:bg-surface-raised hover:text-ink"><X className="h-4 w-4" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden"><TaskFlowPanel /></div>
          </div>
        )}
      </div>
      <GameCommandBar query={query} setQuery={setQuery} />
    </div>
  )
}
