import { useState } from 'react'
import { cn } from '../../lib/cn'
import type { RoomCard } from '../../lib/cards'
import { artFor, noteArtLoaded, noteArtMissing } from '../../lib/creatureArt'

/**
 * The picture on a card, and what stands in for it before the pack exists.
 *
 * The whole point of this component is the second half. The art pack is
 * hundreds of images generated centrally (S4) and it lands long after the
 * cards do, so the no-image state is the normal state, not an error state. A
 * grey box reads as something that failed to load and makes the app look
 * broken for months; the same box with the creature's shape in it reads as a
 * deliberate silhouette and actually answers a question, because "quadruped,
 * large" is a different fight from "insect, little".
 *
 * The unknown case follows the paperdoll in S2: draw the real thing, dimmed,
 * and say plainly that it is a guide rather than a portrait.
 */

/**
 * Body types collapsed into the shapes worth drawing at this size.
 *
 * The wiki's casing is inconsistent and its vocabulary is long-tailed, so this
 * is a lowercase lookup with a fallback rather than an exhaustive map. A shape
 * that is merely close is fine here; a shape that is wrong is not, which is
 * why anything unrecognised falls through to the initial instead of guessing.
 */
type Shape = 'upright' | 'quadruped' | 'serpentine' | 'winged' | 'manylegs' | 'amorphous' | 'plant' | 'fish'

const SHAPE: Record<string, Shape> = {
  biped: 'upright',
  bipedal: 'upright',
  humanoid: 'upright',
  skeletal: 'upright',
  ghoul: 'upright',
  corporal: 'upright',
  quadruped: 'quadruped',
  ophidian: 'serpentine',
  worm: 'serpentine',
  avian: 'winged',
  insect: 'manylegs',
  arachnid: 'manylegs',
  crustacean: 'manylegs',
  amorphous: 'amorphous',
  ghost: 'amorphous',
  plant: 'plant',
  fish: 'fish',
}

/** How much of the frame the silhouette fills. The size cue is the scale. */
const SCALE: Record<string, number> = {
  tiny: 0.5,
  little: 0.62,
  small: 0.74,
  medium: 0.88,
  large: 1,
  'very large': 1.12,
  huge: 1.2,
}

const FILL = 'var(--color-ink-faint)'

function Silhouette({ shape }: { shape: Shape }) {
  if (shape === 'quadruped') {
    return (
      <>
        <ellipse cx={28} cy={30} rx={16} ry={9} fill={FILL} />
        <circle cx={46} cy={23} r={6} fill={FILL} />
        <rect x={16} y={36} width={4} height={16} rx={2} fill={FILL} />
        <rect x={23} y={36} width={4} height={16} rx={2} fill={FILL} />
        <rect x={33} y={36} width={4} height={16} rx={2} fill={FILL} />
        <rect x={40} y={36} width={4} height={16} rx={2} fill={FILL} />
        <path d="M12 27 L4 17" stroke={FILL} strokeWidth={3} strokeLinecap="round" />
      </>
    )
  }

  if (shape === 'serpentine') {
    return (
      <path
        d="M8 50 Q30 46 25 33 Q20 20 40 15 Q53 12 52 23"
        fill="none"
        stroke={FILL}
        strokeWidth={8}
        strokeLinecap="round"
      />
    )
  }

  if (shape === 'winged') {
    return (
      <>
        <path d="M24 28 L3 18 L23 40 Z" fill={FILL} />
        <path d="M36 28 L57 18 L37 40 Z" fill={FILL} />
        <ellipse cx={30} cy={34} rx={7} ry={12} fill={FILL} />
        <circle cx={30} cy={17} r={5} fill={FILL} />
      </>
    )
  }

  if (shape === 'manylegs') {
    return (
      <>
        <ellipse cx={30} cy={33} rx={11} ry={8} fill={FILL} />
        <circle cx={30} cy={19} r={5} fill={FILL} />
        {[-1, 1].map((side) =>
          [0, 1, 2].map((i) => (
            <path
              key={`${side}-${i}`}
              d={`M${30 + side * 9} ${28 + i * 5} L${30 + side * 24} ${22 + i * 9}`}
              stroke={FILL}
              strokeWidth={2.5}
              strokeLinecap="round"
            />
          ))
        )}
      </>
    )
  }

  if (shape === 'amorphous') {
    return (
      <path
        d="M30 8 C46 8 53 23 50 35 C47 47 39 53 30 53 C21 53 13 47 10 35 C7 23 14 8 30 8 Z"
        fill={FILL}
      />
    )
  }

  if (shape === 'plant') {
    return (
      <>
        <rect x={28} y={24} width={4} height={30} rx={2} fill={FILL} />
        <ellipse cx={19} cy={30} rx={10} ry={5} fill={FILL} />
        <ellipse cx={41} cy={38} rx={10} ry={5} fill={FILL} />
        <circle cx={30} cy={16} r={9} fill={FILL} />
      </>
    )
  }

  if (shape === 'fish') {
    return (
      <>
        <ellipse cx={33} cy={31} rx={17} ry={9} fill={FILL} />
        <path d="M17 31 L5 20 L5 42 Z" fill={FILL} />
      </>
    )
  }

  return (
    <>
      <circle cx={30} cy={13} r={7} fill={FILL} />
      <rect x={23} y={21} width={14} height={21} rx={3} fill={FILL} />
      <rect x={16} y={22} width={4} height={17} rx={2} fill={FILL} />
      <rect x={40} y={22} width={4} height={17} rx={2} fill={FILL} />
      <rect x={24} y={42} width={5} height={14} rx={2} fill={FILL} />
      <rect x={31} y={42} width={5} height={14} rx={2} fill={FILL} />
    </>
  )
}

export function CreatureArt({
  name,
  noun,
  lore,
  height,
  className,
}: {
  name: string
  noun: string
  lore?: RoomCard['lore']
  /** Driven by the card tier, because full and compact want different art. */
  height: number
  className?: string
}) {
  // Keyed by art key rather than a bare boolean, so a manifest entry that
  // will not decode falls through to the next candidate on the following
  // render instead of pinning this card to a broken image.
  const [failed, setFailed] = useState<string | null>(null)

  const art = artFor(name, noun)
  const source = art && art.key !== failed ? art : undefined

  const frame = cn('relative w-full overflow-hidden rounded bg-surface-overlay', className)

  if (source) {
    return (
      <div className={frame} style={{ height }}>
        <img
          src={source.url}
          // Empty on purpose: the card prints the name immediately below this,
          // and a screen reader should not read it twice.
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onLoad={() => noteArtLoaded(source.key)}
          onError={() => {
            noteArtMissing(source.key)
            setFailed(source.key)
          }}
        />
      </div>
    )
  }

  const shape = lore?.bodyType ? SHAPE[lore.bodyType.toLowerCase()] : undefined
  const scale = SCALE[lore?.bodySize?.toLowerCase() ?? ''] ?? 0.88
  // Lowercased because the wiki's casing is arbitrary and "large Quadruped"
  // in a tooltip reads as a bug rather than as data.
  const label = [lore?.bodySize, lore?.bodyType].filter(Boolean).join(' ').toLowerCase()

  return (
    <div
      className={cn(frame, 'flex items-center justify-center')}
      style={{ height }}
      title={shape ? `no picture yet: ${label}` : 'no picture yet'}
    >
      {shape ? (
        <svg
          viewBox="0 0 60 60"
          className="h-full opacity-40"
          style={{ aspectRatio: '1 / 1' }}
          role="img"
          aria-label={`${label}, silhouette only`}
        >
          <g transform={`translate(30 30) scale(${scale}) translate(-30 -30)`}>
            <Silhouette shape={shape} />
          </g>
        </svg>
      ) : (
        <span
          // leading-[1.2] rather than leading-none. `leading-none` sets the
          // line box to exactly the font size, which is less than the glyph
          // needs: at 24px the letter wanted 28px, and the difference came off
          // the top and bottom of the character. Small, and invisible unless
          // something goes looking - tools/look.mjs reported "28px of text in
          // 24px" at this element.
          className="text-2xl font-semibold leading-[1.2] text-ink-faint opacity-60"
          aria-hidden="true"
        >
          {/* The noun, not the name: every second creature in the game is
              called "a something", and a panel of cards all marked A is worse
              than no letter at all. */}
          {noun.charAt(0).toUpperCase()}
        </span>
      )}
    </div>
  )
}
