import { useCallback, useEffect, useState, type RefObject } from 'react'

/**
 * Which edges of a scroller still have something past them.
 *
 * # Why this exists rather than a fade in each component
 *
 * Two horizontal strips in this app hide most of their content and say so
 * differently. MacroBar hides its scrollbar on purpose - "a scrollbar under a
 * row of 28px buttons is furniture taller than the thing it scrolls" - and
 * pays for that with edge fades. MapToolRail hides two thirds of the pin
 * palette behind an overlay scrollbar Windows only paints while you are
 * touching it, and says "grab to scroll" in a `title` you have to hover to
 * read.
 *
 * Measured on the real app at an 1180px window: the tool rail was 404px wide
 * around 1328px of content. Nine of its buttons were past the right edge.
 *
 * The fade is the affordance this app already chose. What it needed was to be
 * true, and to be in one place: a fade that is always lit says "there is more"
 * when there is not, which is the same amount of information as no fade at
 * all, and that is exactly the bug MacroBar shipped with before this hook
 * existed. One implementation, so the next strip cannot get a third answer.
 *
 * Takes an existing ref rather than making its own, because both callers
 * already have one - MacroBar for its scroller, MapToolRail from
 * `useDragScroll`.
 */
export function useScrollEdges(ref: RefObject<HTMLElement | null>) {
  const [edges, setEdges] = useState({ start: false, end: false })

  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    // A pixel of slack: fractional layout leaves scrollLeft a hair under max,
    // which would otherwise light the end fade forever at the far end.
    setEdges((prev) => {
      const next = { start: el.scrollLeft > 1, end: el.scrollLeft < max - 1 }
      return prev.start === next.start && prev.end === next.end ? prev : next
    })
  }, [ref])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    measure()
    // Resize, because the strip's width changes with its column, and content,
    // because the number of macros or pins changes without a resize.
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    const mo = new MutationObserver(measure)
    mo.observe(el, { childList: true, subtree: true })
    return () => {
      ro.disconnect()
      mo.disconnect()
    }
  }, [ref, measure])

  return { edges, onScroll: measure, remeasure: measure }
}
