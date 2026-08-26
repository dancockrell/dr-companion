import { Check, X, Minus } from 'lucide-react'
import { cn } from '../../lib/cn'

/**
 * What the check found, at a glance.
 *
 * This is the reason the first screen exists, so it should be the thing you
 * see, and it should read as status rather than as a paragraph about status.
 * One row per dependency: a mark, a name, and where it is.
 *
 * Three states, and the third is the one that usually gets fudged. Present and
 * missing are obvious. **Unknown** is what a browser gets, because nothing here
 * can look at the disk — and saying so plainly is honest where a green tick
 * would be a lie and a red cross would be a false alarm.
 */
export type DepState = 'present' | 'missing' | 'unknown'

export interface Dep {
  id: string
  label: string
  state: DepState
  detail?: string
}

const MARK: Record<DepState, { icon: typeof Check; className: string }> = {
  present: { icon: Check, className: 'text-good' },
  missing: { icon: X, className: 'text-danger' },
  unknown: { icon: Minus, className: 'text-ink-faint' },
}

export function DependencyStrip({ deps }: { deps: Dep[] }) {
  if (!deps.length) return null

  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {deps.map((d) => {
        const { icon: Icon, className } = MARK[d.state]
        return (
          <li key={d.id} className="flex items-center gap-2.5 px-3 py-2">
            <Icon className={cn('h-4 w-4 shrink-0', className)} />
            <span className="shrink-0 text-sm text-ink">{d.label}</span>
            {d.detail && (
              <span className="truncate text-xs text-ink-faint" title={d.detail}>
                {d.detail}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
