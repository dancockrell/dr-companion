import { useEffect, useEffectEvent, useRef, type RefObject } from 'react'

const FOCUSABLE = 'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
const stack: Array<RefObject<HTMLElement | null>> = []

/** Shared focus, background, scroll, Escape, and restoration contract for modal UI. */
export function useModalDialog(onClose: () => void, active = true): RefObject<HTMLDivElement | null> {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const close = useEffectEvent(onClose)

  useEffect(() => {
    if (!active) return
    const ref = dialogRef as RefObject<HTMLElement | null>
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const oldOverflow = document.body.style.overflow
    const inerted: Array<[HTMLElement, boolean]> = []
    stack.push(ref)
    document.body.style.overflow = 'hidden'

    const dialog = dialogRef.current
    if (!dialog) return
    for (let node: HTMLElement | null = dialog; node?.parentElement && node.parentElement !== document.body; node = node.parentElement) {
      for (const sibling of Array.from(node.parentElement.children)) {
        if (sibling !== node && sibling instanceof HTMLElement) {
          inerted.push([sibling, sibling.inert])
          sibling.inert = true
        }
      }
    }
    requestAnimationFrame(() => {
      const current = dialogRef.current
      if (!current) return
      const autofocus = current.querySelector<HTMLElement>('[autofocus]')
      const first = current.querySelector<HTMLElement>(FOCUSABLE)
      ;(autofocus ?? first ?? current).focus()
    })

    const onKey = (event: KeyboardEvent) => {
      if (stack.at(-1) !== ref) return
      if (event.key === 'Escape' && !(event.ctrlKey && event.shiftKey)) {
        event.preventDefault()
        event.stopImmediatePropagation()
        close()
        return
      }
      if (event.key !== 'Tab') return
      const current = dialogRef.current
      if (!current) return
      const focusable = Array.from(current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hidden)
      if (focusable.length === 0) {
        event.preventDefault()
        current.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      const at = stack.lastIndexOf(ref)
      if (at >= 0) stack.splice(at, 1)
      for (const [element, prior] of inerted) element.inert = prior
      if (stack.length === 0) document.body.style.overflow = oldOverflow
      requestAnimationFrame(() => {
        if (opener?.isConnected) opener.focus()
      })
    }
  }, [active])

  return dialogRef
}
