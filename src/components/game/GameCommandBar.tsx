/**
 * The one line you type into, spanning the full width under Game and
 * Channels both - not just under Game's own column.
 *
 * Used to live inside GamePane, sized to whatever share of the row Game
 * happened to have that session. Dan's call, 30 Aug 2026: "the text bar
 * should go across both, bottoms" - the box you type a game command into
 * has no reason to be narrower than the two panes above it combined, and a
 * narrow box is a worse target for a long line than a wide one.
 *
 * The scrollback search toggle lives here too, and shares this same input
 * rather than opening a second one beside it - "when we click find it
 * should go to the text bar, changing that to the search bar." One box,
 * two modes: `searchOpen` decides whether it reads as a command field or a
 * filter field, never both. `query`/`setQuery` are lifted to GameChatColumn
 * because StreamTabs needs to read the same value to filter what it shows
 * across every channel - see that file's own header. This used to be
 * GamePane's scroller before that component was deleted (Dan's "kill the
 * middle" layout change); the search toggle itself was left wired to
 * nothing for one PR, which is worth naming rather than pretending it
 * never happened - see StreamTabs.tsx's `query` prop doc.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Send, Search } from 'lucide-react'
import { gameState, sendGame, subscribeGame } from '../../lib/gameLink'
import { useAliases } from '../../lib/useAliases'
import { expandAlias } from '../../lib/aliases'
import { cn } from '../../lib/cn'

export function GameCommandBar({
  query,
  setQuery,
}: {
  query: string
  setQuery: (v: string) => void
}) {
  const link = useSyncExternalStore(subscribeGame, gameState, gameState)
  const { aliases } = useAliases()

  const [command, setCommand] = useState('')

  /**
   * Command history, the way every MUD client has done it since 1990.
   *
   * `index` is a position from the end, so a new command entering the list
   * does not shift where the reader is. -1 means "not browsing".
   */
  const [history, setHistory] = useState<string[]>([])
  const [historyAt, setHistoryAt] = useState(-1)

  /** What the last typed line expanded to, or empty. Cleared by the next send. */
  const [expansion, setExpansion] = useState('')

  /**
   * The search box is a toggle, not a permanent fixture - see this file's
   * header. Closing it clears the query too, so a hidden filter can never
   * silently keep filtering a pane nobody can see is filtered.
   */
  const [searchOpen, setSearchOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (searchOpen) inputRef.current?.focus()
  }, [searchOpen])
  const closeSearch = () => {
    setSearchOpen(false)
    setQuery('')
  }

  const send = () => {
    const text = command.trim()
    if (!text) return

    /**
     * Aliases expand here, at the one place a typed line becomes a game
     * command.
     *
     * Shown, never silent. `appc sword` reaching the game as `appraise sword
     * careful` is the whole point of the feature, and a player who cannot see
     * what was actually sent has no way to find a wrong alias - the game
     * simply does something they did not ask for. So the expansion stays on
     * screen until the next line is typed.
     *
     * `capped` means a cycle or the depth limit. The partly-expanded text
     * still goes out, because refusing to send is a worse surprise than
     * sending something the player can see, but the chain is named so they
     * can find which alias is looping.
     */
    const { text: outgoing, expanded, chain, capped } = expandAlias(text, aliases)
    setExpansion(
      capped
        ? `${text} → ${outgoing} (chain stopped: ${chain.join(' → ')})`
        : expanded
          ? `${text} → ${outgoing}`
          : ''
    )

    void sendGame(outgoing).catch(() => {
      /* The link reports its own failure; a toast here would be a second one. */
    })
    // History keeps what was typed, not what was sent. Up-arrow is for
    // retyping your own line, and handing back the expansion would make the
    // alias unrecoverable after one press.
    setHistory((h) => (h[h.length - 1] === text ? h : [...h, text].slice(-500)))
    setHistoryAt(-1)
    setCommand('')
  }

  const onCommandKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      send()
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!history.length) return
      const next = historyAt < 0 ? history.length - 1 : Math.max(0, historyAt - 1)
      setHistoryAt(next)
      setCommand(history[next])
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyAt < 0) return
      const next = historyAt + 1
      if (next >= history.length) {
        setHistoryAt(-1)
        setCommand('')
      } else {
        setHistoryAt(next)
        setCommand(history[next])
      }
    }
  }

  return (
    <div className="flex shrink-0 flex-col rounded border border-border bg-surface-raised">
      {/* What the last line actually became, when an alias changed it.
          Directly above the input, because that is where the player is
          looking, and it is the only way to tell a wrong alias from the game
          misbehaving. */}
      {expansion && !searchOpen && (
        <div
          className="shrink-0 truncate border-b border-border px-2 py-0.5 font-mono text-xs text-ink-faint"
          title={expansion}
        >
          {expansion}
        </div>
      )}
      <div className="flex shrink-0 items-center gap-1 p-1.5">
        {/* One box, two modes - see this file's header. Never both a command
            field and a search field at once, so there is only ever one
            answer to "what does Enter do right now." */}
        <input
          ref={searchOpen ? inputRef : undefined}
          type={searchOpen ? 'search' : 'text'}
          value={searchOpen ? query : command}
          onChange={(e) => (searchOpen ? setQuery(e.target.value) : setCommand(e.target.value))}
          onKeyDown={
            searchOpen
              ? (e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    closeSearch()
                  }
                }
              : onCommandKey
          }
          // The placeholder here is a status line, not a label - it reads
          // "Not attached" when there is no game. With no aria-label that
          // status becomes the field's accessible NAME, so a screen reader
          // announces the app's main command box as "Not attached", and the
          // name changes under the user when the socket comes up.
          aria-label={searchOpen ? 'Find in scrollback' : 'Game command'}
          placeholder={
            searchOpen ? 'Find in scrollback' : link.connected ? 'Command, then Enter' : 'Not attached'
          }
          title={
            searchOpen
              ? 'Filter the whole scrollback, including lines older than the rendered window. Plain text, not a pattern. Escape closes.'
              : undefined
          }
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 font-mono text-xs text-ink placeholder:text-ink-faint focus:border-accent/60 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
          className={cn(
            'shrink-0 rounded border p-1.5',
            searchOpen
              ? 'border-accent/40 bg-accent/10 text-accent'
              : 'border-border text-ink-faint hover:text-ink'
          )}
          title={searchOpen ? 'Close scrollback search' : 'Find in scrollback'}
        >
          <Search className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={send}
          disabled={searchOpen}
          className="shrink-0 rounded border border-border p-1.5 text-ink-faint hover:text-ink disabled:opacity-30"
          title={searchOpen ? 'Close search to send a command' : 'Send'}
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
