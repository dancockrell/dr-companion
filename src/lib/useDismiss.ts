import { useEffect } from 'react'

/**
 * Escape closes a modal sheet. CommandPalette already did this
 * (its own inline `if (e.key === 'Escape') setOpen(false)`); Settings,
 * Report a problem and the Highlights/Aliases manager did not, so Escape
 * worked in exactly one of the app's four overlay-style sheets. A shared
 * hook rather than four copies of the same effect, since the four are
 * supposed to agree and a hand-copied version is exactly what drifts.
 *
 * Pair with `onClick={onClose}` on the backdrop and `onClick={(e) =>
 * e.stopPropagation()}` on the panel inside it for backdrop-click-to-close
 * too - that part is one line each and not worth hiding behind a hook.
 */
export function useDismiss(onClose: () => void, active = true) {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.ctrlKey && e.shiftKey)) {
        e.preventDefault()
        e.stopImmediatePropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active, onClose])
}
