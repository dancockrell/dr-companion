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
 * because GamePane's own scroller needs to read the same value to filter
 * what it shows - see that file's header for why.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Send, Search } from 'lucide-react'
import {
  gameState,
  linkHold,
  linkPhase,
  linkPhasePlaceholder,
  sendGame,
  subscribeGame,
} from '../../lib/gameLink.ts'
import { useAliases } from '../../lib/useAliases.ts'
import { expandAlias } from '../../lib/aliases.ts'
import { cn } from '../../lib/cn.ts'
import {
  freshCommandHistoryCursor,
  historyNext,
  historyPrevious,
} from '../../lib/commandHistory.ts'

export function GameCommandBar({
  query,
  setQuery,
}: {
  query: string
  setQuery: (v: string) => void
}) {
  const link = useSyncExternalStore(subscribeGame, gameState, gameState)
  const { aliases, variables } = useAliases()

  /**
   * The link's state, read from the one place that decides it.
   *
   * This box used to test `link.connected` inline in three places while
   * `GameConnectionBar` and `SafetyFooter` both read `linkPhase` - so during a
   * reconnect the footer said "Reconnecting 3/6" and this box said "Not
   * attached", about the same socket, a few hundred pixels apart. That is what
   * `linkPhase` exists to make impossible, and this file was simply not part
   * of the change that introduced it (issue #501). Every consumer, this one
   * included, now reads the phase rather than the boolean.
   */
  const phase = linkPhase(link)
  const hold = linkHold(link)

  const [command, setCommand] = useState('')

  /**
   * Command history, the way every MUD client has done it since 1990.
   *
   * `index` is a position from the end, so a new command entering the list
   * does not shift where the reader is. -1 means "not browsing".
   */
  const [history, setHistory] = useState<string[]>([])
  const [historyCursor, setHistoryCursor] = useState(freshCommandHistoryCursor)

  /** A failed handoff is local to this line, so report it beside this line. */
  const [sendError, setSendError] = useState('')
  const [sending, setSending] = useState(false)

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

  const send = async () => {
    const typed = command
    const text = typed.trim()
    if (!text) return
    if (sending) return

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
    const {
      text: outgoing,
      expanded,
      chain,
      capped,
      unknownVariables,
    } = expandAlias(text, aliases, { variables })
    // An unresolved `$name` is named rather than left looking like a typo in
    // the alias. The token goes out verbatim, so a literal `$shop` reaches the
    // game; this line says which variable would have answered it.
    const missing = unknownVariables.length
      ? ` (no variable ${unknownVariables.map((v) => `$${v}`).join(', ')})`
      : ''
    setExpansion(
      capped
        ? `${text} → ${outgoing} (chain stopped: ${chain.join(' → ')})${missing}`
        : expanded
          ? `${text} → ${outgoing}${missing}`
          : ''
    )

    setSendError('')

    /**
     * The one state this box refuses on its own, and it refuses to HOLD rather
     * than to reject. Everything else goes to native so the lane's own words
     * come back - see `linkHold` in gameLink.ts for why those two are
     * different decisions and why only this one is made here.
     *
     * The text is left in the box and focus comes back, so a second Enter
     * after the link returns sends exactly what was typed.
     */
    if (hold) {
      setSendError(`Not sent — ${hold}`)
      inputRef.current?.focus()
      return
    }

    setSending(true)
    try {
      // A line disappearing is the player's receipt that native accepted it,
      // not merely that React began asking. No `connected` pre-check: the lane
      // answers "Not attached to a game." and "The connection is closed." for
      // itself, in the one place those sentences are written, and a guard here
      // could only repeat them worse or hide them (issue #501).
      await sendGame(outgoing, 'player')
    } catch (error) {
      const raw = error instanceof Error && error.message ? error.message : String(error)
      // The lane's sentences end in a full stop of their own, and this line
      // used to add a second one: "The connection is closed.. Your command is
      // still here." Trimmed here rather than in Rust, because the words
      // belong to the lane and the punctuation of this line belongs to this
      // line. Only a trailing stop goes; a sentence ending in ? or ! keeps it.
      const detail = (raw || 'the game connection refused it').replace(/\.\s*$/, '')
      setSendError(`Not sent — ${detail}. Your command is still here.`)
      inputRef.current?.focus()
      return
    } finally {
      setSending(false)
    }
    // History keeps what was typed, not what was sent. Up-arrow is for
    // retyping your own line, and handing back the expansion would make the
    // alias unrecoverable after one press.
    setHistory((h) => (h[h.length - 1] === text ? h : [...h, text].slice(-500)))
    setHistoryCursor(freshCommandHistoryCursor())
    // Do not erase text typed while the native handoff was in flight.
    setCommand((current) => (current === typed ? '' : current))
    // And put the caret back in the box.
    //
    // The two failure paths above already do this; the success path did not,
    // because pressing Enter leaves focus in the input by itself. Pressing the
    // Send button does not - focus stays on the button, and the next thing
    // typed goes nowhere. One line, and it makes "type, send, type again"
    // work the same whichever way the command was sent.
    inputRef.current?.focus()
  }

  const onCommandKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      void send()
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!history.length) return
      const next = historyPrevious(history, historyCursor, command)
      setHistoryCursor({ at: next.at, draft: next.draft })
      setCommand(next.command)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = historyNext(history, historyCursor, command)
      setHistoryCursor({ at: next.at, draft: next.draft })
      setCommand(next.command)
    }
  }

  return (
    <div className="flex shrink-0 flex-col rounded border border-border bg-surface-raised" data-gameplay-shortcuts={searchOpen ? 'suspend' : undefined}>
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
      {sendError && !searchOpen && (
        <div
          className="shrink-0 border-b border-danger/30 bg-danger/10 px-2 py-1 text-xs text-danger"
          role="alert"
        >
          {sendError}
        </div>
      )}
      <div className="flex shrink-0 items-center gap-1 p-1.5">
        {/* One box, two modes - see this file's header. Never both a command
            field and a search field at once, so there is only ever one
            answer to "what does Enter do right now." */}
        <input
          ref={inputRef}
          type={searchOpen ? 'search' : 'text'}
          value={searchOpen ? query : command}
          onChange={(e) => {
            if (searchOpen) return setQuery(e.target.value)
            setCommand(e.target.value)
            setSendError('')
            // Editing a recalled line turns it into the new draft. Stored
            // history stays immutable until a successful send.
            if (historyCursor.at >= 0) setHistoryCursor(freshCommandHistoryCursor())
          }}
          onKeyDown={
            searchOpen
              ? (e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    e.stopPropagation()
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
          placeholder={searchOpen ? 'Find in scrollback' : linkPhasePlaceholder(link)}
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
          aria-label={searchOpen ? 'Close scrollback search' : 'Find in scrollback'}
        >
          <Search className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={send}
          /*
           * Not disabled on the link's state any more, deliberately.
           *
           * A disabled button was the same short-circuit as the removed
           * pre-check, wearing a different hat: it made the refusal
           * unreachable, so the one sentence that says what is actually wrong
           * and what to do about it could not be got at. Pressing it while the
           * link is down is now informative rather than forbidden - it holds
           * during a reconnect and reports the lane's own words otherwise, and
           * in neither case does anything reach the game. See issue #501.
           */
          disabled={searchOpen || sending}
          className="shrink-0 rounded border border-border p-1.5 text-ink-faint hover:text-ink disabled:opacity-30"
          title={
            searchOpen
              ? 'Close search to send a command'
              : sending
                ? 'Sending…'
                : phase === 'connected'
                  ? 'Send'
                  : hold
                    ? 'The link is reconnecting. Your draft stays here; press again when it is back.'
                    : 'The link is down. Press to see what the game connection says.'
          }
          aria-label={searchOpen ? 'Close search to send a command' : 'Send'}
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
