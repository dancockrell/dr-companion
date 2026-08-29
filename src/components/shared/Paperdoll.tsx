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
 * All sixteen parts (S2) get a real place on the doll now, including the
 * two that used to be missing one. `back` used to share `chest`'s exact
 * box — drawn on top of it, at the same coordinates, so a back wound was
 * never visually distinguishable from a chest one no matter how the data
 * looked. It now runs as its own strip down the side of the torso. `nsys`
 * (the nervous system) used to have no position on the doll at all — a
 * floating icon beside it, shown only when something was actually wrong,
 * because an indicator with nowhere to live and nothing to say felt like a
 * rendering glitch on an uninjured character. It now runs as the spine,
 * down the center of the torso, and reads exactly like every other part:
 * present always, plain when unhurt, coloured when it isn't. Eyes were
 * always there — two small circles set into the head — just easy to miss
 * at a glance; they're bigger and better separated from the skull outline
 * now.
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
 *
 * A soft silhouette sits behind the parts — a head halo and a torso glow —
 * so sixteen independent shapes read as one body at a glance instead of a
 * loose cluster of boxes. It carries no data of its own and never changes
 * colour; it is stage lighting, not a seventeenth part.
 */
/** What the doll is doing right now — driven by the character's own
 * situation flags (prone/sitting/kneeling), not a choice this component
 * makes. Standing is the layout this doll has always drawn. Sitting folds
 * the legs into a cross-legged pose, same idea DR itself uses for "sit
 * indian style" — knees out, feet tucked under, everything else untouched.
 * Lying reuses the *standing* shapes verbatim, rotated 90° as a whole (see
 * the render below) rather than a fourth hand-drawn layout: a body on its
 * back is the same shapes, on their side. */
export type Pose = 'standing' | 'sitting' | 'lying'

/** Rounded boxes (and two circles for the head) on a 60x100 grid. Crude on
 * purpose: it reads as a body at 90px tall, not an anatomy chart. */
const LAYOUT_STANDING: Record<Exclude<BodyPart, 'head' | 'leftEye' | 'rightEye'>, [number, number, number, number]> = {
  neck: [27, 15, 6, 4],
  chest: [21, 19, 15, 15],
  back: [17, 19, 3, 27],
  abdomen: [22, 34, 13, 11],
  nsys: [29, 20, 2, 24],
  leftArm: [11, 20, 5, 17],
  rightArm: [38, 20, 6, 17],
  leftHand: [11, 38, 5, 6],
  rightHand: [38, 38, 6, 6],
  leftLeg: [23, 46, 6, 28],
  rightLeg: [31, 46, 6, 28],
  leftFoot: [22, 75, 7, 6],
  rightFoot: [31, 75, 7, 6],
}

/** Cross-legged: torso, arms and hands stay exactly where standing put
 * them (nothing above the waist changes when you sit down), only the legs
 * and feet fold — wide at the knee, tucked in near the centre at the
 * ankle, which is what "indian style" actually looks like from the front. */
const LAYOUT_SITTING: typeof LAYOUT_STANDING = {
  ...LAYOUT_STANDING,
  leftLeg: [5, 50, 21, 11],
  rightLeg: [34, 50, 21, 11],
  leftFoot: [15, 63, 10, 7],
  rightFoot: [35, 63, 10, 7],
}

function layoutFor(pose: Pose): typeof LAYOUT_STANDING {
  return pose === 'sitting' ? LAYOUT_SITTING : LAYOUT_STANDING
}

const HEAD = { cx: 30, cy: 9, r: 7 }
const EYES: Record<'leftEye' | 'rightEye', [number, number]> = {
  leftEye: [27.3, 7.5],
  rightEye: [32.7, 7.5],
}
const EYE_R = 1.5

/** Corner rounding, per part — the spine and the eyes want to read as a
 * line and a dot, not a rounded rectangle, so they get their own radius
 * rather than the one every limb and the torso share. */
function radiusFor(part: keyof typeof LAYOUT_STANDING, w: number, h: number): number {
  if (part === 'nsys') return Math.min(w, h) / 2
  if (part === 'back') return 1.2
  return 1.8
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
  /** standing (default), sitting cross-legged, or lying down — see the
   * `Pose` type above for what each actually draws. */
  pose = 'standing',
}: {
  injuries: Partial<Record<BodyPart, Injury>>
  height?: number
  known?: boolean
  pose?: Pose
}) {
  const worst = Math.max(0, ...BODY_PARTS.map((p) => injuries[p]?.wound ?? 0))
  const layout = layoutFor(pose)

  const injuryOf = (part: BodyPart) => injuries[part] ?? { wound: 0 as Severity, scar: 0 as Severity }
  const titleFor = (part: BodyPart) => {
    const inj = injuryOf(part)
    const pretty = PRETTY[part] ?? part
    return `${pretty}: ${SEVERITY_LABEL[inj.wound]}` + (inj.scar > 0 ? `, ${SEVERITY_LABEL[inj.scar]} scar` : '')
  }

  return (
    <svg
      viewBox="0 0 60 100"
      style={{ height }}
      className={cn('shrink-0', !known && 'opacity-40')}
      role="img"
      aria-label={
        (known ? `worst injury ${SEVERITY_LABEL[worst as Severity]}` : 'injuries unknown') +
        (pose !== 'standing' ? `, ${pose}` : '')
      }
    >
      {/* Lying reuses the standing (upright) shapes wholesale, rotated as a
          whole about the doll's own centre — a body on its back is the same
          sixteen parts, on their side, not a seventeenth layout to draw and
          keep in sync with the other two. Sitting gets its own real layout
          above instead, since folded legs are a genuinely different shape,
          not a rotation of a standing one. */}
      <g transform={pose === 'lying' ? 'rotate(90 30 50)' : undefined}>
      {/* Stage lighting, not a part: a head halo and a torso glow so the
          sixteen independent shapes below read as one body at a glance. */}
      <g aria-hidden opacity={0.5}>
        <circle cx={HEAD.cx} cy={HEAD.cy} r={HEAD.r + 2} fill="var(--color-ink-faint)" opacity={0.08} />
        <rect x={14} y={16} width={32} height={32} rx={10} fill="var(--color-ink-faint)" opacity={0.06} />
      </g>

      {/* The head, drawn separately from the rest of LAYOUT because it is a
          circle, not a box — the one part of this doll a rectangle never
          looked right for. */}
      <g>
        <title>{titleFor('head')}</title>
        <circle
          cx={HEAD.cx}
          cy={HEAD.cy}
          r={HEAD.r}
          fill={tone(injuryOf('head').wound).fill}
          fillOpacity={tone(injuryOf('head').wound).opacity}
          stroke="var(--color-border)"
          strokeWidth={injuryOf('head').wound >= 2 ? 1 : 0.4}
        />
        {injuryOf('head').scar > 0 && (
          <line
            x1={HEAD.cx - HEAD.r + 1.5}
            y1={HEAD.cy + HEAD.r - 1.5}
            x2={HEAD.cx + HEAD.r - 1.5}
            y2={HEAD.cy - HEAD.r + 1.5}
            stroke="var(--color-ink-faint)"
            strokeWidth={0.6}
            strokeDasharray="1.5 1.5"
          />
        )}
      </g>

      {/* Eyes — always present, bigger and better separated from the skull
          outline than a first pass had them, so "the eyes are on this doll"
          is true at a glance and not just true in the data. */}
      {(['leftEye', 'rightEye'] as const).map((part) => {
        const [cx, cy] = EYES[part]
        const inj = injuryOf(part)
        const t = tone(inj.wound)
        return (
          <g key={part}>
            <title>{titleFor(part)}</title>
            <circle
              cx={cx}
              cy={cy}
              r={EYE_R}
              fill={t.fill}
              fillOpacity={t.opacity}
              stroke="var(--color-surface)"
              strokeWidth={0.4}
            />
          </g>
        )
      })}

      {(Object.keys(layout) as Array<keyof typeof LAYOUT_STANDING>).map((part) => {
        const inj = injuryOf(part)
        const t = tone(inj.wound)
        const pretty = PRETTY[part] ?? part
        const [x, y, w, h] = layout[part]
        const rx = radiusFor(part, w, h)
        return (
          <g key={part}>
            <title>{`${pretty}: ${SEVERITY_LABEL[inj.wound]}${inj.scar > 0 ? `, ${SEVERITY_LABEL[inj.scar]} scar` : ''}`}</title>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              rx={rx}
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
      </g>
    </svg>
  )
}
