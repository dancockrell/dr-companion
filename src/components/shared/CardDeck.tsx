import { useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/cn'
import { CreatureCard } from './CreatureCard'
import type { DeckPref } from '../../lib/layout'
import {
  DECK_LABEL,
  DECK_STYLE,
  fanSliver,
  collapse,
  sortCards,
  tierFor,
  type Deck,
  type RoomCard,
  type Tier,
} from '../../lib/cards'

/**
 * One deck of cards, compressing to fit whatever width it is given.
 *
 * Measured with a ResizeObserver rather than a media query: the panel is
 * resizable and can be torn into its own window, so the viewport says nothing
 * useful about the space this deck actually has. See DESIGN.md S6.
 */
export function CardDeck({
  deck,
  cards,
  pref = 'auto',
  onCyclePref,
}: {
  deck: Deck
  cards: RoomCard[]
  /** A density the player pinned. Auto lets the width decide. */
  pref?: DeckPref
  onCyclePref?: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  // Kept per deck and across resizes: collapsing a card visually should not
  // forget that it was open, or widening the panel would silently reset it.
  const [open, setOpen] = useState<Set<string>>(new Set())

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // An empty deck renders nothing at all. A header over no cards is exactly
  // the wasted space this panel exists to avoid.
  if (cards.length === 0) return null

  const items = sortCards(collapse(cards))
  const total = items.reduce((n, c) => n + c.count, 0)
  // A pinned density wins over the measured one. Auto is right almost always,
  // but overruling someone who deliberately pinned a deck is how a tool loses
  // the players who use it most.
  const tier: Tier = pref === 'auto' ? tierFor(width, items.length) : pref
  const style = DECK_STYLE[deck]
  // Fans tighten as cards are added; below MIN_SLIVER the deck scrolls.
  const sliver = fanSliver(width, items.length)

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div ref={ref} className="w-full">
      <div className="mb-1 flex items-baseline gap-2">
        <span className={cn('text-xs font-semibold uppercase tracking-wide', style.text)}>
          {DECK_LABEL[deck]}
        </span>
        <span className="text-xs text-ink-faint">{total}</span>

        {onCyclePref && (
          <button
            type="button"
            onClick={onCyclePref}
            title={
              pref === 'auto'
                ? `density: auto (now ${tier}). Click to pin.`
                : `density: pinned to ${pref}. Click for the next.`
            }
            className={cn(
              'ml-auto rounded px-1 text-[10px] leading-4 transition-colors',
              pref === 'auto'
                ? 'text-ink-faint hover:text-ink-muted'
                : 'bg-surface-overlay text-accent'
            )}
          >
            {pref === 'auto' ? 'auto' : pref}
          </button>
        )}
      </div>

      {tier === 'count' ? (
        // The floor. However cramped it gets, the deck and its size stay on
        // screen: hiding the fact that six things are attacking you is the one
        // unforgivable failure.
        <button
          type="button"
          onClick={() => setOpen(new Set(items.map((c) => c.id)))}
          className={cn(
            'flex w-full items-center gap-2 border border-border bg-surface-raised px-2 py-1',
            style.corner
          )}
        >
          <span className={cn('h-3 w-1', style.band)} />
          <span className="text-sm text-ink">
            {total} {DECK_LABEL[deck].toLowerCase()}
          </span>
        </button>
      ) : tier === 'row' ? (
        <div className="flex flex-col gap-1">
          {items.map((c) => (
            <CreatureCard
              key={c.id}
              card={c}
              tier="row"
              expanded={open.has(c.id)}
              onToggle={() => toggle(c.id)}
            />
          ))}
        </div>
      ) : tier === 'fan' ? (
        // Overlapped like a hand of cards. Each card sits on top of the one
        // after it, so the exposed sliver is always the left edge.
        <div className="relative h-[132px] overflow-x-auto">
          {items.map((c, i) => (
            <div
              key={c.id}
              className="absolute top-0"
              style={{
                left: i * sliver,
                zIndex: items.length - i,
              }}
            >
              <CreatureCard
                card={c}
                tier={open.has(c.id) ? 'full' : 'fan'}
                expanded={open.has(c.id)}
                onToggle={() => toggle(c.id)}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((c) => (
            <CreatureCard
              key={c.id}
              card={c}
              tier={tier}
              expanded={open.has(c.id)}
              onToggle={() => toggle(c.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
