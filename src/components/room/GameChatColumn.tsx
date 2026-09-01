import { useState } from 'react'
import { MessageSquareText, Workflow } from 'lucide-react'
import { StreamTabs } from '../game/StreamTabs'
import { GameCommandBar } from '../game/GameCommandBar'
import { PanelBoundary } from '../shared/PanelBoundary'
import { useHighlights } from '../../lib/useHighlights'
import { TaskFlowPanel } from '../dashboard/TaskFlowPanel'

/**
 * The large lower-right workspace has two deliberate modes. Game remains the
 * default; Functions & scripts gets the whole useful pane when selected rather
 * than duplicating a cramped row of mystery icons beneath battle commands.
 */
export function GameChatColumn() {
  const { highlights } = useHighlights()
  const [query, setQuery] = useState('')
  const [paneMode, setPaneMode] = useState<'game' | 'functions'>('game')

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-border bg-surface-raised">
        <div className="flex shrink-0 gap-1 border-b border-border bg-surface px-2 py-1.5" aria-label="Workspace mode">
          <button type="button" onClick={() => setPaneMode('game')} aria-pressed={paneMode === 'game'} className={`flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium ${paneMode === 'game' ? 'bg-accent/15 text-accent' : 'text-ink-faint hover:bg-surface-overlay hover:text-ink'}`}>
            <MessageSquareText className="h-4 w-4" aria-hidden /> Game
          </button>
          <button type="button" onClick={() => setPaneMode('functions')} aria-pressed={paneMode === 'functions'} className={`flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium ${paneMode === 'functions' ? 'bg-accent/15 text-accent' : 'text-ink-faint hover:bg-surface-overlay hover:text-ink'}`}>
            <Workflow className="h-4 w-4" aria-hidden /> Functions &amp; scripts
          </button>
        </div>
        {paneMode === 'game' ? (
          <PanelBoundary label="Game and channels"><StreamTabs highlights={highlights} /></PanelBoundary>
        ) : (
          <div className="min-h-0 flex-1 overflow-hidden"><TaskFlowPanel /></div>
        )}
      </div>
      {paneMode === 'game' && <GameCommandBar query={query} setQuery={setQuery} />}
    </div>
  )
}
