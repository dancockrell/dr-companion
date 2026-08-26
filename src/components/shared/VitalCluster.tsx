import { cn } from '../../lib/cn'

/**
 * Vitals in as little room as they can honestly occupy.
 *
 * The old VitalBar spent a label row, a full panel width and two lines of
 * height on each vital, so four of them cost eight lines and the whole column.
 * Vitals do not need width. They need to be readable at a glance while
 * something is eating you.
 *
 * So: one narrow column each, filling from the bottom like a mixer, the number
 * under it, a single letter over it. Three channels carry the same fact at
 * once, which is the point:
 *
 *   - **height** of the fill, readable peripherally without focusing
 *   - **colour**, which crosses to red as it gets dangerous
 *   - **the number**, because "how close am I to dying" is a quantity and
 *     players who have been doing this for twenty years read the number
 *
 * Colour never carries anything alone. At low levels the column also gains a
 * notch at the danger line, so a player who cannot separate the reds still
 * sees the shape change.
 *
 * Nothing here drops below 12px. The first version used 10px to save width and
 * failed the type-floor check, which is exactly the audience this floor exists
 * for: mid-forties to sixties, reading a number that tells them whether they
 * are about to die.
 */
export interface Vital {
  key: string
  /** One glyph. Anything longer starts costing width again. */
  glyph: string
  label: string
  value: number
  max: number
  tone: 'health' | 'mana' | 'stamina' | 'spirit' | 'concentration'
}

const TONE: Record<Vital['tone'], string> = {
  health: 'bg-good',
  mana: 'bg-info',
  stamina: 'bg-accent',
  spirit: 'bg-ink-muted',
  concentration: 'bg-warn',
}

/** Below this share, the fill turns and the notch appears. */
const DANGER = 0.3
const LOW = 0.6

export function VitalCluster({
  vitals,
  height = 44,
}: {
  vitals: Vital[]
  height?: number
}) {
  return (
    <div className="flex gap-1.5">
      {vitals.map((v) => {
        const share = v.max > 0 ? Math.max(0, Math.min(1, v.value / v.max)) : 0
        const pct = Math.round(share * 100)
        const danger = share < DANGER
        const low = share < LOW

        const fill =
          v.tone === 'health' && danger
            ? 'bg-danger'
            : v.tone === 'health' && low
              ? 'bg-warn'
              : TONE[v.tone]

        return (
          <div
            key={v.key}
            className="flex w-7 flex-col items-center gap-0.5"
            title={`${v.label} ${v.value} of ${v.max} (${pct}%)`}
          >
            <span className="text-xs leading-none text-ink-faint">{v.glyph}</span>

            <div
              className="relative w-full overflow-hidden rounded-sm border border-border bg-surface"
              style={{ height }}
            >
              <div
                className={cn('absolute inset-x-0 bottom-0 transition-[height] duration-300', fill)}
                style={{ height: `${pct}%` }}
              />
              {/* The danger line. A shape change, so it survives colour blindness
                  and a badly calibrated monitor. */}
              {danger && (
                <span
                  className="absolute inset-x-0 border-t border-dashed border-ink"
                  style={{ bottom: `${DANGER * 100}%` }}
                />
              )}
            </div>

            <span
              className={cn(
                'text-xs font-medium leading-none tabular-nums',
                danger ? 'text-danger' : 'text-ink-muted'
              )}
            >
              {pct}
            </span>
          </div>
        )
      })}
    </div>
  )
}
