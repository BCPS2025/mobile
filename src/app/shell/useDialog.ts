import { type RefObject, useEffect } from 'react'

// Focus handling for the presenter's dialogs: focus moves in when one opens, Tab stays inside,
// Escape closes it (before the page's own keys see it) and focus returns to where it was.

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'

export function useDialog(ref: RefObject<HTMLElement | null>, onClose: () => void, opts: { trap: boolean }): void {
  const { trap } = opts
  useEffect(() => {
    const root = ref.current
    const before = document.activeElement as HTMLElement | null
    const first = root?.querySelector<HTMLElement>('[data-autofocus]') ?? root?.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (!trap || e.key !== 'Tab' || !root) return
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
      const head = items[0]
      const last = items[items.length - 1]
      if (!head || !last) return
      if (e.shiftKey && document.activeElement === head) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        head.focus()
      } else if (!root.contains(document.activeElement)) {
        e.preventDefault()
        head.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      if (before?.isConnected) before.focus({ preventScroll: true })
    }
  }, [ref, onClose, trap])
}
