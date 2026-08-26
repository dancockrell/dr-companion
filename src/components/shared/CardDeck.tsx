import { useCallback, useRef, useState } from 'react'
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
  const [open, setOpen] = useState<Set<string>>(new Set())

  /**
   * A callback ref rather than an effect, because the element is not always
   * there on the first render.
   *
   * The deck returns null while the room is empty, so a `useEffect(..., [])`
   * ran once against a ref that was still null, gave up, and never ran again.
   * The measured width stayed at zero for the life of the component and every
   * tier decision was made against it: a 306px deck fanned its cards down to
   * single letters, and a 208px one collapsed to a count chip.
   *
   * A callback ref fires whenever the node attaches or detaches, which is
   * exactly the event that matters here.
   */
  const [width, setWidth] = useState(0)
  const observer = useRef<ResizeObserver | null>(null)

  const measure = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect()
    if (!el) return
    setWidth(el.getBoundingClientRect().width)
    observer.current = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.current.observe(el)
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
    // The measured width and the tier it produced, on the element itself.
    // A component whose entire job is reacting to its own width should be able
    // to tell you what width it thinks it has, rather than being reverse
    // engineered from the classes it happened to render.
    <div ref={measure} className="w-full" data-deck={deck} data-width={Math.round(width)} data-tier={tier}>
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
              'ml-auto rounded px-1 text-xs leading-4 transition-colors',
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
        <div className="relative h-[104px] overflow-x-auto">
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
        <div className="grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(--spacing(18),1fr))]">
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
