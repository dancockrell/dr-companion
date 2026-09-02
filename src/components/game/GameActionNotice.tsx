import { AlertTriangle } from 'lucide-react'
import { useGameActionFailure } from '../../lib/gameActions'

export function GameActionNotice() {
  const failure = useGameActionFailure()
  if (!failure) return null
  return (
    <div
      key={failure.id}
      role="status"
      aria-live="polite"
      className="flex shrink-0 items-center gap-2 border-t border-danger/35 bg-danger/10 px-3 py-1 text-xs text-danger"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="font-semibold">Not sent:</span>
      <span className="min-w-0 truncate">{failure.label} — {failure.message}</span>
    </div>
  )
}
