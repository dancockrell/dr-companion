import { Zap } from 'lucide-react'
import { cn } from '../../lib/cn'
import {
  BODY_PARTS,
  PRETTY,
  SEVERITY_LABEL,
  type BodyPart,
  type Injury,
  type Severity,
} from '../../lib/body'

export type { BodyPart, Injury, Severity } from '../../lib/body'

/**
 * The paperdoll, at a size that does not cost a column.
 *
 * Sixteen parts (S2), each carrying a wound 0-3 and a scar 0-3. Severity
 * labels are ours, not Lich's: 1 minor, 2 serious, 3 severe.
 *
 * Three things carry severity so none of them carries it alone:
 *
 *   - **colour**, warn then danger
 *   - **opacity and outline weight**, so it survives a colour deficiency
 *   - **the number**, shown on the part once it is serious
 *
 * Scars are drawn as a hatch rather than a fill. A scar is history and a wound
 * is now, and the doll should never make you look twice to tell them apart.
 *
 * Nothing is labelled on the doll. At this size text would break the 12px
 * floor in S1.5, so the part name lives in the title attribute.
 */
/** Boxes on a 60x100 grid. Crude on purpose: it reads as a body at 90px tall. */
const LAYOUT: Record<Exclude<BodyPart, 'nsys'>, [number, number, number, number]> = {
  head: [24, 2, 12, 11],
  leftEye: [26, 5, 3, 3],
  rightEye: [31, 5, 3, 3],
  neck: [27, 14, 6, 4],
  chest: [21, 19, 18, 16],
  back: [21, 19, 18, 16],
  abdomen: [22, 36, 16, 12],
  leftArm: [12, 20, 8, 18],
  rightArm: [40, 20, 8, 18],
  leftHand: [12, 40, 8, 7],
  rightHand: [40, 40, 8, 7],
  leftLeg: [22, 49, 7, 30],
  rightLeg: [31, 49, 7, 30],
  leftFoot: [22, 80, 7, 6],
  rightFoot: [31, 80, 7, 6],
}

function tone(wound: Severity) {
  if (wound >= 3) return { fill: 'var(--color-danger)', opacity: 0.95 }
  if (wound === 2) return { fill: 'var(--color-danger)', opacity: 0.6 }
  if (wound === 1) return { fill: 'var(--color-warn)', opacity: 0.55 }
  return { fill: 'var(--color-surface-overlay)', opacity: 1 }
}

export function Paperdoll({
  injuries,
  height = 100,
  /** Absent is not uninjured. Before the first parse this says so. */
  known = true,
}: {
  injuries: Partial<Record<BodyPart, Injury>>
  height?: number
  known?: boolean
}) {
  const nsys = injuries.nsys ?? { wound: 0 as Severity, scar: 0 as Severity }
  const worst = Math.max(0, ...BODY_PARTS.map((p) => injuries[p]?.wound ?? 0))

  return (
    <div className="flex items-start gap-1.5">
      <svg
        viewBox="0 0 60 90"
        style={{ height }}
        className={cn('shrink-0', !known && 'opacity-40')}
        role="img"
        aria-label={known ? `worst injury ${SEVERITY_LABEL[worst as Severity]}` : 'injuries unknown'}
      >
        {(Object.keys(LAYOUT) as Array<keyof typeof LAYOUT>).map((part) => {
          const inj = injuries[part] ?? { wound: 0 as Severity, scar: 0 as Severity }
          const t = tone(inj.wound)
          const pretty = PRETTY[part] ?? part
          const [x, y, w, h] = LAYOUT[part]
          return (
            <g key={part}>
              <title>
                {`${pretty}: ${SEVERITY_LABEL[inj.wound]}` +
                  (inj.scar > 0 ? `, ${SEVERITY_LABEL[inj.scar]} scar` : '')}
              </title>
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                rx={1.5}
                fill={t.fill}
                fillOpacity={t.opacity}
                stroke="var(--color-border)"
                strokeWidth={inj.wound >= 2 ? 1 : 0.4}
              />
              {/* Scars hatch rather than fill: history, not now. */}
              {inj.scar > 0 && (
                <line
                  x1={x + 1}
                  y1={y + h - 1}
                  x2={x + w - 1}
                  y2={y + 1}
                  stroke="var(--color-ink-faint)"
                  strokeWidth={0.6}
                  strokeDasharray="1.5 1.5"
                />
              )}
            </g>
          )
        })}
      </svg>

      {/* The nervous system has nowhere to sit on a body, so it gets its own
        * mark - but only when there is something to report.
        *
        * It used to render always, as a bare lowercase "n" beside an empty
        * circle, with the word "nervous system" reachable only by hovering.
        * On an uninjured character that is a stray letter and a dot floating
        * next to the doll, and it was read as a rendering artifact rather than
        * as information - which is the correct reading, because an indicator
        * that permanently says "nothing is wrong" carries none.
        *
        * So it appears when it means something: a wound or a scar. The letter
        * is now an icon, because at this size a word breaks the 12px floor the
        * rest of this component is built around (see the header comment) and a
        * single letter is not a label, it is a puzzle. */}
      {known && (nsys.wound > 0 || nsys.scar > 0) && (
      <div
        className="flex flex-col items-center gap-0.5"
        title={`nervous system: ${SEVERITY_LABEL[nsys.wound]}`}
      >
        <Zap
          className={cn(
            'h-3 w-3',
            nsys.wound >= 2 ? 'text-danger' : nsys.wound === 1 ? 'text-warn' : 'text-ink-faint'
          )}
          aria-hidden
        />
        <span
          className={cn(
            'h-3 w-3 rounded-full border',
            nsys.wound >= 3
              ? 'border-danger bg-danger'
              : nsys.wound === 2
                ? 'border-danger bg-danger/60'
                : nsys.wound === 1
                  ? 'border-warn bg-warn/50'
                  // Reachable when the nerves are scarred but unwounded, which
                  // is why this branch stays rather than being folded away with
                  // the always-on rendering.
                  : 'border-border bg-surface-overlay'
          )}
        />
      </div>
      )}
    </div>
  )
}
