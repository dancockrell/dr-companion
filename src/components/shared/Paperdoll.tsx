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
 * Fifteen parts get a real place on the doll — every injurable part except
 * `nsys` (the nervous system), which has no box here at all. It used to:
 * first a floating icon shown only when hurt, then a spine down the torso
 * center. Neither read as intended — a spine thin enough not to compete
 * with the chest for attention was too thin to read as anything, and wide
 * enough to read was a bar, not a spine. Nerve damage now lives entirely
 * in the status icon beside the doll (CombatRadar.tsx's `nsysTone`), which
 * can carry graduated severity through colour and icon shape at a size
 * that's actually legible; the doll draws the fifteen parts a body-shaped
 * box genuinely suits. `back` used to share `chest`'s exact box — drawn on
 * top of it, at the same coordinates, so a back wound was never visually
 * distinguishable from a chest one no matter how the data looked. It now
 * runs as its own strip down the side of the torso. Eyes are two small
 * circles set into the head.
 *
 * Three things carry wound severity so none of them carries it alone:
 * colour (warn then danger), opacity and outline weight (so it survives a
 * colour deficiency), and the title attribute's own severity word — text
 * on the doll itself would break the 12px floor (DESIGN.md S1.5) at this
 * size, so nothing is labelled directly; hovering or focusing a part is
 * how its name and severity are actually read.
 *
 * Two more facts get their own mark, distinct from the fill colour that
 * already carries wound severity: a **scar** (history, not now) stamps
 * three short parallel strokes in a part's top-right corner, like
 * stitches; **active bleeding** comes from the bridge's separate bleeding
 * report and stamps a small drop in the bottom-right. Wound severity must
 * never invent bleeding: a serious wound may already be clotted.
 *
 * A soft silhouette sits behind the parts — a head halo and a torso glow —
 * so the independent shapes read as one body at a glance instead of a
 * loose cluster of boxes. It carries no data of its own and never changes
 * colour; it is stage lighting, not another part.
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

/** Compact anatomical regions on a 60x84 grid. Limbs are capsules and the
 * torso is broad enough to read as a person rather than a stack of boxes.
 *
 * `nsys` (nervous system) has no box here — it did, once, as a spine down
 * the torso, and no width short of competing with the chest for attention
 * ever read as a spine rather than a bar or a hairline. Nerve damage now
 * lives entirely in the status icon next to the doll (CombatRadar.tsx),
 * which can actually carry severity through colour and shape at a size
 * that's legible; the doll draws the fifteen parts a body-shaped box
 * genuinely suits. */
const LAYOUT_STANDING: Record<
  Exclude<BodyPart, 'head' | 'leftEye' | 'rightEye' | 'nsys'>,
  [number, number, number, number]
> = {
  neck: [26, 15, 8, 5],
  chest: [20, 19, 18, 17],
  back: [16.5, 21, 3, 25],
  abdomen: [21.5, 36, 15, 11],
  leftArm: [10.5, 20, 7, 20],
  rightArm: [39.5, 20, 7, 20],
  leftHand: [10, 40, 8, 7],
  rightHand: [39, 40, 8, 7],
  leftLeg: [21, 47, 8, 26],
  rightLeg: [31, 47, 8, 26],
  leftFoot: [18.5, 73, 11, 7],
  rightFoot: [30.5, 73, 11, 7],
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

/** Corner rounding, per part — the back wants to read as a strip, not a
 * rounded rectangle, so it gets its own radius rather than the one every
 * limb and the torso share. */
function radiusFor(part: keyof typeof LAYOUT_STANDING): number {
  if (part === 'back') return 1.2
  if (/Arm|Hand|Leg|Foot/.test(part)) return 4
  return 2.5
}

function tone(wound: Severity) {
  if (wound >= 3) return { fill: 'var(--color-danger)', opacity: 1 }
  if (wound === 2) return { fill: 'var(--color-danger)', opacity: 0.72 }
  if (wound === 1) return { fill: 'var(--color-warn)', opacity: 0.7 }
  return { fill: 'var(--color-ink-muted)', opacity: 0.22 }
}

/** A scar, stamped rather than drawn as one line across the box — three
 * short parallel strokes, like stitches, read as "healed tissue" at a
 * glance in a way one diagonal dash (indistinguishable from a stray line
 * at this size) never quite did. Anchored to a box's own top-right corner
 * and sized the same regardless of how big the box is, so a scar on a
 * hand reads the same mark as one on the chest. */
function ScarStamp({ x, y }: { x: number; y: number }) {
  return (
    <g stroke="var(--color-accent)" strokeWidth={0.55} strokeLinecap="round" opacity={0.95}>
      <line x1={x} y1={y + 1.6} x2={x + 1.6} y2={y} />
      <line x1={x + 0.9} y1={y + 2.5} x2={x + 2.5} y2={y + 0.9} />
      <line x1={x + 1.8} y1={y + 3.4} x2={x + 3.4} y2={y + 1.8} />
    </g>
  )
}

/** A wound bleeding now, stamped as a small drop rather than folded into
 * the fill colour — the fill already says how hurt the part is; this says
 * the separate fact that the bridge currently reports active blood loss.
 * Anchored to a box's own bottom-right corner, opposite the scar stamp, so
 * a part carrying both at once shows both without overlapping. */
function BloodStamp({ x, y }: { x: number; y: number }) {
  return (
    <path
      d={`M${x} ${y - 2.2} C${x + 1.3} ${y - 0.7} ${x + 1.3} ${y + 0.6} ${x} ${y + 1.2} C${x - 1.3} ${y + 0.6} ${x - 1.3} ${y - 0.7} ${x} ${y - 2.2} Z`}
      fill="var(--color-danger)"
      opacity={0.95}
    />
  )
}

export function Paperdoll({
  injuries,
  bleeding,
  height = 100,
  /** Absent is not uninjured. Before the first parse this says so. */
  known = true,
  /** standing (default), sitting cross-legged, or lying down — see the
   * `Pose` type above for what each actually draws. */
  pose = 'standing',
}: {
  injuries: Partial<Record<BodyPart, Injury>>
  bleeding?: Array<{ part: BodyPart | null; rate: string }>
  height?: number
  known?: boolean
  pose?: Pose
}) {
  const worst = Math.max(0, ...BODY_PARTS.map((p) => injuries[p]?.wound ?? 0))
  const layout = layoutFor(pose)

  const bleedFor = (part: BodyPart) => bleeding?.find((entry) => entry.part === part)
  const isActiveBleed = (part: BodyPart) => {
    const rate = bleedFor(part)?.rate.trim()
    return Boolean(rate && !/^(?:clotted|tended|none|stopped|not bleeding)$/i.test(rate))
  }

  const injuryOf = (part: BodyPart) => injuries[part] ?? { wound: 0 as Severity, scar: 0 as Severity }
  const titleFor = (part: BodyPart) => {
    const inj = injuryOf(part)
    const pretty = PRETTY[part] ?? part
    const bleed = bleedFor(part)?.rate
    return `${pretty}: ${SEVERITY_LABEL[inj.wound]}` +
      (inj.scar > 0 ? `, ${SEVERITY_LABEL[inj.scar]} scar` : '') +
      (bleed ? `, bleeding: ${bleed}` : '')
  }

  return (
    <svg
      // Trimmed to the body's own real extent on both axes, rather than the
      // round "0 0 60 100" this doll drew on before: vertically, head at
      // y=2 to feet at y=81 (was 100 - a fifth of the frame was dead space
      // below the feet on every render); horizontally, x=3 to x=57 - wide
      // enough for the sitting pose's spread legs (its widest single case,
      // x=5..55) plus a couple of units of margin, standing's narrower
      // arm-to-arm span sits comfortably inside the same box. No explicit
      // `width` is set below, so the SVG's rendered width follows this
      // viewBox's aspect ratio automatically - narrower here means a
      // narrower doll at the same `height`, not a doll cropped at the
      // edges. `height` still sets the actual pixel height the caller
      // asked for.
      viewBox="5 0 50 82"
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
      <g transform={pose === 'lying' ? 'rotate(90 30 42)' : undefined}>
      {/* A crisp anatomical outline binds the independently coloured injury
          regions into one body. It carries no state of its own. */}
      <g aria-hidden fill="var(--color-surface-overlay)" fillOpacity={0.34} stroke="var(--color-ink-faint)" strokeWidth={0.65} opacity={0.7}>
        <circle cx={HEAD.cx} cy={HEAD.cy} r={HEAD.r + 1.5} />
        <path d="M24 17 Q30 14 36 17 Q42 19 44 25 L48 43 Q48 47 44 48 Q40 48 39 43 L37 47 L40 78 Q40 81 36 81 Q32 81 30 75 Q28 81 24 81 Q20 81 20 77 L23 47 L20 42 Q19 48 15 48 Q11 48 11 44 L16 24 Q18 19 24 17 Z" />
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
          stroke="var(--color-ink-faint)"
          strokeWidth={injuryOf('head').wound >= 2 ? 1 : 0.4}
        />
        {injuryOf('head').scar > 0 && <ScarStamp x={HEAD.cx + HEAD.r - 4.5} y={HEAD.cy - HEAD.r + 0.5} />}
        {isActiveBleed('head') && <BloodStamp x={HEAD.cx} y={HEAD.cy + HEAD.r - 0.5} />}
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
              stroke="var(--color-ink)"
              strokeWidth={0.4}
            />
          </g>
        )
      })}

      {(Object.keys(layout) as Array<keyof typeof LAYOUT_STANDING>).map((part) => {
        const inj = injuryOf(part)
        const t = tone(inj.wound)
        const [x, y, w, h] = layout[part]
        const rx = radiusFor(part)
        return (
          <g key={part}>
            <title>{titleFor(part)}</title>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              rx={rx}
              fill={t.fill}
              fillOpacity={t.opacity}
              stroke="var(--color-ink-faint)"
              strokeWidth={inj.wound >= 2 ? 1 : 0.4}
            />
            {/* Scars stamp rather than fill: history, not now. Blood stamps
                the separate, current fact of active bleeding — the fill
                colour alone said "how hurt", not "is it bleeding right
                now", and a part can be both scarred and freshly bleeding
                at once, which is exactly why each gets its own corner. */}
            {inj.scar > 0 && <ScarStamp x={x + w - 4.2} y={y + 0.6} />}
            {isActiveBleed(part) && <BloodStamp x={x + w - 1.6} y={y + h - 1.4} />}
          </g>
        )
      })}
      </g>
    </svg>
  )
}
