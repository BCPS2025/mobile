import { useSyncExternalStore } from 'react'

// What kind of device the page is on. A touch device has its own status bar and safe areas, so
// phone mode drops the in-app status bar there.

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const mq = window.matchMedia(query)
      mq.addEventListener('change', listener)
      return () => mq.removeEventListener('change', listener)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** A touch phone or tablet: the primary pointer is coarse. */
export const useTouchDevice = (): boolean => useMediaQuery('(pointer: coarse)')
