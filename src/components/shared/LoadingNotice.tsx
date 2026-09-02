import { Loader2 } from 'lucide-react'

export function LoadingNotice({ children = 'Loading…' }: { children?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 py-6 text-sm text-ink-faint"
    >
      <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
      {children}
    </div>
  )
}
