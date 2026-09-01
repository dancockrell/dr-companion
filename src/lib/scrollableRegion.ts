import type { KeyboardEvent } from 'react'

export type ScrollOrientation = 'vertical' | 'horizontal' | 'both'

/**
 * The shared accessibility contract for an independently scrollable gameplay
 * region. Child controls keep their own arrow keys; scrolling keys act only
 * when the region itself has focus.
 */
export function scrollableRegionProps(label: string, orientation: ScrollOrientation = 'vertical') {
  return {
    tabIndex: 0,
    role: 'region' as const,
    'aria-label': label,
    'data-scrollable-region': orientation,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) return
      const el = event.currentTarget
      const vertical = orientation !== 'horizontal'
      const horizontal = orientation !== 'vertical'
      const pageY = Math.max(40, el.clientHeight * 0.8)
      const pageX = Math.max(40, el.clientWidth * 0.8)
      let handled = true

      if (event.key === 'PageUp') el.scrollBy(vertical ? { top: -pageY, behavior: 'smooth' } : { left: -pageX, behavior: 'smooth' })
      else if (event.key === 'PageDown') el.scrollBy(vertical ? { top: pageY, behavior: 'smooth' } : { left: pageX, behavior: 'smooth' })
      else if (event.key === 'Home') el.scrollTo({ top: 0, left: 0, behavior: 'smooth' })
      else if (event.key === 'End') el.scrollTo({ top: vertical ? el.scrollHeight : 0, left: horizontal ? el.scrollWidth : 0, behavior: 'smooth' })
      else if (event.key === 'ArrowUp' && vertical) el.scrollBy({ top: -40, behavior: 'smooth' })
      else if (event.key === 'ArrowDown' && vertical) el.scrollBy({ top: 40, behavior: 'smooth' })
      else if (event.key === 'ArrowLeft' && horizontal) el.scrollBy({ left: -40, behavior: 'smooth' })
      else if (event.key === 'ArrowRight' && horizontal) el.scrollBy({ left: 40, behavior: 'smooth' })
      else handled = false

      if (handled) event.preventDefault()
    },
  }
}
