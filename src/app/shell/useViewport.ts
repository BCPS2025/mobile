import { useSyncExternalStore } from 'react'

// Window size as an external store (re-renders on resize).

let cached = { w: 0, h: 0 }
function read() {
  const w = window.innerWidth
  const h = window.innerHeight
  if (w !== cached.w || h !== cached.h) cached = { w, h }
  return cached
}
function subscribe(cb: () => void) {
  window.addEventListener('resize', cb)
  return () => window.removeEventListener('resize', cb)
}

export function useViewport(): { w: number; h: number } {
  return useSyncExternalStore(subscribe, read, read)
}

export const supportsZoom = typeof CSS !== 'undefined' && CSS.supports('zoom', '1')

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
