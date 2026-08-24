import { cn } from '../../lib/cn'

interface Props {
  label: string
  value: number
  max: number
  tone?: 'health' | 'spirit' | 'fatigue' | 'default'
}

export function VitalBar({ label, value, max, tone = 'default' }: Props) {
  const pct = Math.max(0, Math.min(100, Math.round((value / max) * 100)))
  const color =
    tone === 'health'
      ? pct < 30
        ? 'bg-danger'
        : pct < 60
          ? 'bg-warn'
          : 'bg-good'
      : tone === 'spirit'
        ? 'bg-info'
        : tone === 'fatigue'
          ? 'bg-accent'
          : 'bg-ink-muted'

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-ink-muted">
        <span>{label}</span>
        <span>
          {value}/{max} ({pct}%)
        </span>
      </div>
      <div className="h-2 rounded-full bg-surface overflow-hidden border border-border/60">
        <div
          className={cn('h-full rounded-full transition-all duration-500', color)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
