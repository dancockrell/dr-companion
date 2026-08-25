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
        <svg
          width="88"
          height="88"
          viewBox="0 0 100 100"
          aria-hidden="true"
          className="opacity-90"
        >
          <circle
            cx="50"
            cy="50"
            r="29"
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="7.5"
            strokeLinecap="round"
            strokeDasharray="152 30"
            transform="rotate(75 50 50)"
          />
          <rect
            x="46.2"
            y="46"
            width="7.5"
            height="40"
            rx="3"
            fill="var(--color-accent-soft)"
          />
          <circle cx="50" cy="50" r="8.5" fill="var(--color-accent)" />
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
