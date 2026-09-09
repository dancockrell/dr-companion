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
  clearGame,
  DEFAULT_ATTACH_PORT,
  detachGame,
  gameDropped,
  gameState,
  lichNote,
  linkPhase,
  linkPhaseLabel,
  subscribeGame,
} from '../../lib/gameLink.ts'
// Not `attachGame`. Attaching ends the demo, and that decision lives in one
// place so six buttons cannot each hold a different half of it - see
// `src/store/sessionSwitch.ts` and issue #525.
import { useAppStore } from '../../store/useAppStore.ts'
import { useSyncExternalStore } from 'react'
import { isTauri } from '../../lib/tauri.ts'
import { useHighlights } from '../../lib/useHighlights.ts'
import { useAliases } from '../../lib/useAliases.ts'
import { cn } from '../../lib/cn.ts'
import { writeText } from '../../lib/storage.ts'

/**
 * The port the attach box starts on. (N6.)
 *
 * One derivation, in `gameLink.ts`, because #488 gave the sign-in screen an
 * "Attach to it" offer that needs the same number and a second copy would
 * drift. The reasoning for deriving it at all lives with the constant.
 */
const DEFAULT_PORT = DEFAULT_ATTACH_PORT
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

  // Four states, from one place. Read here rather than tested inline so this
  // bar and the SafetyFooter cannot come to different conclusions about the
  // same LinkState - which is what a second `link.connected ? ... : ...` in
  // each of them would guarantee eventually. See `linkPhase` in gameLink.ts.
  const phase = linkPhase(link)
  const phaseLabel = linkPhaseLabel(link)

  return (
    <div className="flex min-w-0 shrink-0 items-center gap-2 border-b border-border px-2 py-1 text-xs">
      <span
        className={cn(
          'flex shrink-0 items-center',
          phase === 'connected'
            ? 'text-good'
            : phase === 'reconnecting'
              ? 'text-warn'
              : 'text-ink-faint'
        )}
        title={
          phase === 'connected'
            ? 'Attached'
            : link.note || `Not attached (${link.host}:${link.port})`
        }
      >
        {/* The reconnecting icon is the *unplugged* one, deliberately, and
            the word beside it carries the difference. A third icon would be a
            third thing to learn, and the state that matters here is "nothing
            is getting through", which the unplugged plug already says. */}
        {phase === 'connected' ? <PlugZap className="h-3 w-3" /> : <Plug className="h-3 w-3" />}
      </span>

      {/* Reconnecting and gave-up, with the count. Shown ahead of the Lich
          probe's note because it is the more immediate fact: whether to wait
          at all comes before what to do if waiting does not work. */}
      {phaseLabel && (
        <span
          className={cn(
            'shrink-0 tabular-nums',
            phase === 'reconnecting' ? 'text-warn' : 'text-danger'
          )}
          title={link.note}
          role="status"
          aria-live="polite"
        >
          {phaseLabel}
        </span>
      )}

      {phase !== 'connected' && lichNote(link.lich) && (
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
        {/* Detach covers reconnecting as well as connected, and Attach is
            deliberately not offered during a reconnect: a dial is already
            under way, and a second one would race it - `game_attach` refuses
            for that reason, so offering the button would only produce an
            error. Detach is what a player wants there anyway: it is how you
            stop a reconnect you have decided is not going to work. */}
        {phase === 'connected' || phase === 'reconnecting' ? (
          <button
            type="button"
            className="rounded border border-border p-1 text-ink-muted hover:text-ink"
            onClick={() => void detachGame()}
            title={phase === 'reconnecting' ? 'Stop reconnecting' : 'Detach'}
            aria-label={phase === 'reconnecting' ? 'Stop reconnecting' : 'Detach'}
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
              onClick={() => void useAppStore.getState().connectToGame(Number(port))}
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
