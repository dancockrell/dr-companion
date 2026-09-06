/**
 * The one question this app asks on the way out. Issue #488 §3.
 *
 * It appears only when closing would abandon a Lich this app started and that
 * is still running, and it has exactly the two answers Rust exposes. Every
 * decision behind it - when to show, which command each button sends, that the
 * window closes either way - lives in `src/lib/lichLifetime.ts` so it can be
 * tested without a DOM. This file is the two buttons.
 *
 * Wording is deliberate. "Leave it running" is first and is the default,
 * because it is what a crash, a kill, or an unanswered prompt all produce
 * anyway, and because the character is in the game either way. "Stop Lich"
 * says what it does rather than "Quit" or "Close": the app is closing
 * regardless, and the only thing in question is the character's session.
 */
import { useEffect, useState } from 'react'
import {
  leaveLichRunningAndClose,
  onLichClosePrompt,
  shouldPromptOnClose,
  stopLichAndClose,
  type OwnedLich,
} from '../../lib/lichLifetime.ts'

export function LichClosePrompt() {
  const [owned, setOwned] = useState<OwnedLich | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => onLichClosePrompt(setOwned), [])

  if (!shouldPromptOnClose(owned)) return null

  const answer = (run: () => Promise<unknown>) => {
    setBusy(true)
    void run().finally(() => setBusy(false))
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Lich is still running"
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
    >
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface-raised p-4">
        <h2 className="text-sm font-medium text-ink">Lich is still running your character</h2>
        <p className="mt-2 text-xs leading-snug text-ink-muted">
          This app started Lich. Closing the app does not sign your character out
          unless you say so.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            autoFocus
            disabled={busy}
            onClick={() => answer(leaveLichRunningAndClose)}
            className="rounded border border-accent/40 bg-accent/10 px-2 py-1 text-xs text-accent disabled:opacity-40"
          >
            Leave it running
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => answer(stopLichAndClose)}
            className="rounded border border-border px-2 py-1 text-xs text-ink-muted hover:text-ink disabled:opacity-40"
          >
            Stop Lich
          </button>
        </div>
      </div>
    </div>
  )
}
