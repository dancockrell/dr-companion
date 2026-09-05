import { cn } from '../../lib/cn.ts'

export function Badge({
  children,
  tone = 'default',
}: {
  children: React.ReactNode
  tone?: 'default' | 'good' | 'warn' | 'danger' | 'info' | 'accent'
}) {
  const tones = {
    default: 'bg-surface-overlay text-ink-muted border-border',
    good: 'bg-good/15 text-good border-good/30',
    warn: 'bg-warn/15 text-warn border-warn/30',
    danger: 'bg-danger/15 text-danger border-danger/30',
    info: 'bg-info/15 text-info border-info/30',
    accent: 'bg-accent/15 text-accent border-accent/30',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border',
        tones[tone]
      )}
    >
      {children}
    </span>
  )
}
