import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

/**
 * A box.
 *
 * One border, one padding, a title that is a word rather than a sentence, and
 * a count when a count is the thing you want. Everything on this dashboard
 * that holds cards uses it, so battle, objects and players read as siblings
 * rather than as three separate inventions.
 *
 * No collapse chevron, no drag grip, no pop-out button by default. Those were
 * chrome repeated on every panel until the screen was a grid of frames with
 * headers. A box that needs a control gets that one control.
 */
export function Box({
  title,
  count,
  tone = 'plain',
  action,
  children,
  className,
}: {
  /** Omitted where the content says what it is without help. */
  title?: string
  /** Shown beside the title. Left off when zero is not worth saying. */
  count?: number
  /** Hostile boxes earn a red edge; nothing else does. */
  tone?: 'plain' | 'danger'
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'flex min-h-0 flex-col rounded border bg-surface-raised',
        tone === 'danger' ? 'border-danger/40' : 'border-border',
        className
      )}
    >
      {(title || count !== undefined || action) && (
      <header className="flex shrink-0 items-baseline gap-2 px-2 pt-1.5">
        <h2
          className={cn(
            'text-xs font-medium uppercase tracking-wide',
            tone === 'danger' ? 'text-danger' : 'text-ink-faint'
          )}
        >
          {title}
        </h2>
        {count !== undefined && (
          <span className="text-xs tabular-nums text-ink-faint">{count}</span>
        )}
        {action && <span className="ml-auto">{action}</span>}
      </header>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-2 pt-1.5">{children}</div>
    </section>
  )
}
