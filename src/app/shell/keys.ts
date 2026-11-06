import { useEffect } from 'react'

// Presenter keys (document level): F full screen, Z zoom (fit the last-used phone to the window
// and hide the other; Esc shows both again), Esc, ? the shortcut list. Ignored when focus is in
// a text field, inside a keypad region, or when a modifier is held. Space, Enter and "." are
// never intercepted, and there is no P key.

export type KeyAction = 'fullscreen' | 'zoom' | 'escape' | 'help'

export interface KeyLike {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  target?: unknown
}

interface ElementLike {
  tagName?: string
  isContentEditable?: boolean
  closest?: (selector: string) => unknown
}

const FIELDS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/** Whether a key press is meant for a field or a keypad and so is never a presenter key. */
export function keyBelongsToPage(target: unknown): boolean {
  const el = target as ElementLike | null
  if (!el || typeof el !== 'object') return false
  if (el.tagName && FIELDS.has(el.tagName.toUpperCase())) return true
  if (el.isContentEditable) return true
  return typeof el.closest === 'function' && Boolean(el.closest('[data-keypad]'))
}

export function keyAction(e: KeyLike): KeyAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  if (keyBelongsToPage(e.target)) return null
  switch (e.key) {
    case 'f':
    case 'F':
      return 'fullscreen'
    case 'z':
    case 'Z':
      return 'zoom'
    case 'Escape':
      return 'escape'
    case '?':
      return 'help'
    default:
      return null
  }
}

export function usePresenterKeys(handler: (action: KeyAction) => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = keyAction(e)
      if (!action) return
      if (action !== 'escape') e.preventDefault()
      handler(action)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [handler])
}
