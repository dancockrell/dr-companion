/**
 * One creature or person, as a poker chip rather than a card.
 *
 * "Stackable circular poker chips" was the exact direction, in place of the
 * rectangular cards CreatureCard already draws. The data underneath is the
 * same `RoomCard` `collapse()` already produces — several identical nouns
 * folded into one entry with a count — so "stackable" costs nothing new to
 * compute; it only needed a different shape to draw it in. A stack of three
 * kobolds is drawn as three overlapping rims behind one face, the way three
 * real chips look set on a table, rather than a card with an "x3" printed
 * on it.
 *
 * Art comes from the same `artFor()` lookup CreatureArt uses, cropped to a
 * circle instead of a card's rounded rectangle. The fallback — no art yet —
 * is the noun's initial on the felt colour, which reads as a placeholder
 * chip rather than a broken image, the same reasoning CreatureArt's silhouette
 * follows for cards.
 */
import { useState } from 'react'
import { cn } from '../../lib/cn'
import type { RoomCard } from '../../lib/cards'
import { artFor, noteArtLoaded, noteArtMissing } from '../../lib/creatureArt'
import { Skull, Zap } from 'lucide-react'

/** Ring colour per deck — same red/green/blue language CreatureCard's band uses. */
const RING: Record<RoomCard['deck'], string> = {
  hostile: 'ring-danger',
  allied: 'ring-good',
  people: 'ring-info',
}

export function CreatureChip({
  card,
  size = 56,
  onSelect,
}: {
  card: RoomCard
  /** Diameter in px. Smaller for a crowded table, larger when there is room. */
  size?: number
  onSelect?: () => void
}) {
  const [failed, setFailed] = useState<string | null>(null)
  const art = artFor(card.name, card.noun)
  const source = art && art.key !== failed ? art : undefined
  const dead = card.status === 'dead'
  const stack = Math.min(card.count, 3)

  return (
    <div className="group relative" style={{ width: size, height: size }}>
      {/* The stack: 1-2 rims peeking out behind the face, offset the way a
          real stack of chips leans. Purely decorative — nothing here reads
          a second count, `card.count` is only ever drawn once, on the badge. */}
      {Array.from({ length: stack - 1 }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={cn('absolute rounded-full border-2 border-surface bg-surface-overlay', RING[card.deck], 'ring-1')}
          style={{
            width: size,
            height: size,
            left: (i + 1) * Math.round(size * 0.08),
            top: -(i + 1) * Math.round(size * 0.08),
            zIndex: -i - 1,
          }}
        />
      ))}

      <button
        type="button"
        onClick={onSelect}
        title={`${card.name}${card.count > 1 ? ` x${card.count}` : ''}`}
        className={cn(
          'relative flex items-center justify-center overflow-hidden rounded-full border-2 border-surface ring-2 transition-transform hover:scale-105',
          RING[card.deck],
          dead && 'opacity-50 saturate-50'
        )}
        style={{ width: size, height: size }}
      >
        {source ? (
          <img
            src={source.url}
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
        ) : (
          <span
            className="font-semibold text-ink-faint"
            style={{ fontSize: Math.max(12, Math.round(size * 0.4)) }}
            aria-hidden="true"
          >
            {card.noun.charAt(0).toUpperCase()}
          </span>
        )}

        {card.status === 'stunned' && (
          <Zap
            className="absolute right-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-warn p-0.5 text-surface"
            aria-label="stunned"
          />
        )}
        {dead && (
          <Skull
            className="absolute inset-0 m-auto h-1/2 w-1/2 text-ink-faint"
            aria-label="dead"
          />
        )}
      </button>

      {card.count > 1 && (
        <span
          className="absolute -bottom-1 -right-1 z-10 rounded-full border border-surface bg-surface-overlay px-1 text-xs font-semibold leading-tight text-ink"
          title={`${card.count} of these`}
        >
          {card.count}
        </span>
      )}

      {/* Name, on hover/focus only — the table is the picture, the label is
          the detail you ask for, same split as the Quick Switch ability
          tooltip. */}
      <div
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded border border-border bg-surface-overlay px-1.5 py-0.5 text-xs text-ink opacity-0 shadow transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {card.name}
        {card.count > 1 && ` x${card.count}`}
        {card.lore?.level != null && <span className="text-ink-faint"> · lvl {card.lore.level}</span>}
      </div>
    </div>
  )
}
