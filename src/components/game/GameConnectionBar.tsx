/**
 * Attach, detach, and the connection's own status - without the scrolling
 * text log GamePane used to show alongside it.
 *
 * Not decoration to keep for old times' sake: Channels (StreamTabs) and the
 * command bar (GameCommandBar) both read the exact same underlying
 * connection this controls - `useGameLines()`/`sendGame()` in `gameLink.ts`.
 * GamePane's own header row was the *only* place in the app that could ever
 * attach that connection in the first place. Removing GamePane's scrolling
 * log entirely (Dan's call - it read as a dead box when nothing was
 * attached) would have taken this control down with it, and with it the
 * only way Channels or the command bar could ever have anything to show -
 * which is a functional loss neither of those was supposed to take, since
 * both were asked to stay. So the control moves; only the log itself goes.
 */
import { useState } from 'react'
import { Plug, PlugZap, Info, Trash2, Link2, Unlink } from 'lucide-react'
import {
  attachGame,
  clearGame,
  detachGame,
  gameDropped,
  gameState,
  lichNote,
  subscribeGame,
} from '../../lib/gameLink'
import { useSyncExternalStore } from 'react'
import { isTauri } from '../../lib/tauri'
import { useHighlights } from '../../lib/useHighlights'
import { useAliases } from '../../lib/useAliases'
import { cn } from '../../lib/cn'
import { writeText } from '../../lib/storage'

const DEFAULT_PORT = '11024'
const PORT_KEY = 'drc.attach-port.v2'

function validPort(v: string): boolean {
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 && n <= 65535
}

function loadPort(): string {
  try {
    const saved = localStorage.getItem(PORT_KEY)
    return saved && validPort(saved) ? saved : DEFAULT_PORT
  } catch {
    return DEFAULT_PORT
  }
}

export function GameConnectionBar() {
  const link = useSyncExternalStore(subscribeGame, gameState, gameState)
  const dropped = useSyncExternalStore(subscribeGame, gameDropped, gameDropped)
  const { note: hlNote } = useHighlights()
  const { aliases, note: aliasNote } = useAliases()

  const [port, setPortState] = useState<string>(loadPort)
  const setPort = (v: string) => {
    setPortState(v)
    if (validPort(v)) writeText(PORT_KEY, v)
  }

  return (
    <div className="flex min-w-0 shrink-0 items-center gap-2 border-b border-border px-2 py-1 text-xs">
      <span
        className={cn('flex shrink-0 items-center', link.connected ? 'text-good' : 'text-ink-faint')}
        title={link.connected ? 'Attached' : link.note || `Not attached (${link.host}:${link.port})`}
      >
        {link.connected ? <PlugZap className="h-3 w-3" /> : <Plug className="h-3 w-3" />}
      </span>

      {!link.connected && lichNote(link.lich) && (
        <span
          className={cn(link.lich === 'gone' ? 'text-warn' : 'text-ink-faint')}
          title="Checked by probing the port, not inferred from the disconnect"
        >
          {lichNote(link.lich)}
        </span>
      )}

      {(hlNote || aliasNote) && (
        <span
          className="flex shrink-0 items-center text-ink-faint"
          title={[hlNote, aliasNote ? `${aliases.length} aliases` : null].filter(Boolean).join(' · ')}
        >
          <Info className="h-3 w-3" />
        </span>
      )}

      {dropped > 0 && (
        <span className="text-warn" title="Scrollback is capped at 20,000 lines">
          {dropped} older lines dropped
        </span>
      )}

      <span className="ml-auto flex shrink-0 items-center gap-1">
        <button
          type="button"
          className="rounded p-1 text-ink-faint hover:text-ink"
          onClick={() => {
            if (confirm('Clear all game scrollback? This cannot be undone. The live connection will stay attached.')) clearGame()
          }}
          title="Clear the scrollback. The connection is untouched."
          aria-label="Clear the scrollback"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
        {link.connected ? (
          <button
            type="button"
            className="rounded border border-border p-1 text-ink-muted hover:text-ink"
            onClick={() => void detachGame()}
            title="Detach"
            aria-label="Detach"
          >
            <Unlink className="h-3.5 w-3.5" />
          </button>
        ) : isTauri() ? (
          <>
            <input
              type="text"
              inputMode="numeric"
              value={port}
              onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
              className="w-14 rounded border border-border bg-surface px-1 py-0.5 text-center tabular-nums text-ink-muted"
              title="The port Lich opened with --detachable-client. 11024 is what this app uses when it launches Lich itself."
            />
            <button
              type="button"
              className="rounded border border-accent/40 bg-accent/10 p-1 text-accent disabled:opacity-40"
              onClick={() => void attachGame(Number(port))}
              title={`Attach to a Lich running with --detachable-client=${port}`}
              aria-label="Attach"
              disabled={!validPort(port)}
            >
              <Link2 className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <span className="px-1 text-xs text-ink-muted" title="Game attachment is available in the desktop app">
            Browser preview
          </span>
        )}
      </span>
    </div>
  )
}
