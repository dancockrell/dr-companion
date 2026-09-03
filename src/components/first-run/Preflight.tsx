/**
 * Title screen. Checks the machine while there is something to look at.
 *
 * Lich is hard to onboard onto, and the usual failure is a wall of prose about
 * Ruby versions before you have seen the thing you came for. So: brand, check
 * quietly, and only interrupt if there is a real decision to make.
 */
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

export function Preflight({
  note,
  onSkip,
}: {
  note?: string
  onSkip?: () => void
}) {
  // The check is usually instant. Showing a spinner for 80ms then flashing to
  // the next screen reads as a glitch, so hold briefly and let it land.
  const [showSkip, setShowSkip] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setShowSkip(true), 2500)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="min-h-full flex flex-col items-center justify-center p-8 gap-6 text-center">
      <div className="relative">
        {/* A compass rose, not the old ring-and-stem placeholder shape (that
         * one also happened to be the app icon before it was replaced with a
         * proper mark - this is the same brand carried into the one screen
         * that doesn't load a PNG). Cardinal points in the accent gold,
         * intercardinal points a shade back in accent-soft, same two-tone
         * split the original used. Ties this title screen to the map board
         * elsewhere in the app, which is the one thing a DragonRealms player
         * already associates with a compass. */}
        <svg
          width="88"
          height="88"
          viewBox="0 0 100 100"
          aria-hidden="true"
          className="opacity-90"
        >
          <circle cx="50" cy="50" r="46" fill="none" stroke="var(--color-border)" strokeWidth="1.5" />
          <g fill="var(--color-accent-soft)">
            <path d="M 50.00 50.00 L 52.94 45.95 L 69.09 30.91 L 54.05 47.06 Z" />
            <path d="M 50.00 50.00 L 54.05 52.94 L 69.09 69.09 L 52.94 54.05 Z" />
            <path d="M 50.00 50.00 L 47.06 54.05 L 30.91 69.09 L 45.95 52.94 Z" />
            <path d="M 50.00 50.00 L 45.95 47.06 L 30.91 30.91 L 47.06 45.95 Z" />
          </g>
          <g fill="var(--color-accent)">
            <path d="M 50.00 50.00 L 48.78 43.11 L 50.00 8.00 L 51.22 43.11 Z" />
            <path d="M 50.00 50.00 L 56.89 48.78 L 92.00 50.00 L 56.89 51.22 Z" />
            <path d="M 50.00 50.00 L 51.22 56.89 L 50.00 92.00 L 48.78 56.89 Z" />
            <path d="M 50.00 50.00 L 43.11 51.22 L 8.00 50.00 L 43.11 48.78 Z" />
          </g>
          <circle cx="50" cy="50" r="6" fill="var(--color-surface)" stroke="var(--color-accent)" strokeWidth="2.5" />
        </svg>
      </div>

      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          DR Companion
        </h1>
        <p className="text-xs text-ink-faint">
          A control panel for DragonRealms
        </p>
      </div>

      <div className="flex items-center gap-2 text-sm text-ink-muted">
        <Loader2 className="w-4 h-4 animate-spin text-info" />
        <span>{note ?? 'Checking what you already have…'}</span>
      </div>

      {showSkip && onSkip && (
        <button
          type="button"
          onClick={onSkip}
          className="text-xs text-ink-faint hover:text-ink-muted underline-offset-2 hover:underline"
        >
          Taking a while — skip to the demo
        </button>
      )}
    </div>
  )
}
