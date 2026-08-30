import { useState } from 'react'
import { StreamTabs } from '../game/StreamTabs'
import { GameConnectionBar } from '../game/GameConnectionBar'
import { GameCommandBar } from '../game/GameCommandBar'
import { TaskFlowPanel } from '../dashboard/TaskFlowPanel'
import { PanelBoundary } from '../shared/PanelBoundary'
import { Splitter } from '../layout/Splitter'
import { useHighlights } from '../../lib/useHighlights'

const SPLIT_KEY = 'drc.chat-functions-split.v1'
const DEFAULT_SHARE = 0.5
const MIN_SHARE = 0.25
const MAX_SHARE = 0.8

/**
 * Channels, and what to run - side by side, under the map.
 *
 * Used to be Game (a scrolling raw text log) beside Channels, with the
 * command bar under both. The Game pane read as a dead box the moment
 * nothing was attached to it - which is most sessions, for anyone using
 * this app as a companion beside Genie rather than as their primary client
 * (Dan's own case) - and it was spending the width Functions actually
 * needed. What Game's connection controls and background effects (alert
 * sounds, ambient zone music) did that had nothing to do with displaying
 * text moved to GameConnectionBar.tsx and GameSignals.tsx respectively;
 * only the scrolling log itself is gone.
 *
 * Functions is Tasks & Scripts, the panel a player presses most, moved here
 * from the old middle dashboard column - see App.tsx's own comment on why
 * that column no longer exists at all.
 */
export function GameChatColumn() {
  const { highlights } = useHighlights()
  const [query, setQuery] = useState('')

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
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <GameConnectionBar />

      <div className="flex min-h-0 flex-1 flex-row gap-2">
        <div
          className="flex min-w-0 flex-col rounded border border-border bg-surface-raised"
          style={{ flexGrow: share, flexBasis: 0 }}
        >
          <PanelBoundary label="Channels">
            <StreamTabs highlights={highlights} />
          </PanelBoundary>
        </div>

        <Splitter orientation="vertical" value={share} onChange={setShare} min={MIN_SHARE} max={MAX_SHARE} />

        <div
          className="flex min-w-0 flex-col overflow-hidden rounded border border-border bg-surface-raised"
          style={{ flexGrow: 1 - share, flexBasis: 0 }}
        >
          <PanelBoundary label="Tasks &amp; scripts">
            <TaskFlowPanel />
          </PanelBoundary>
        </div>
      </div>

      <GameCommandBar query={query} setQuery={setQuery} />
    </div>
  )
}
