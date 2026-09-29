import { useSyncExternalStore } from 'react'

// Hash routing (relative paths, so the same build runs under any prefix and from file://).
//   #/                     landing
//   #/stage                two phones side by side
//   #/phone                one phone with an account switcher
//   #/phone/:persona       the same, logging that account in
//   #/about                About BCPS
//   #/pay?…                a payment code or link: opens phone mode on Welcome
// In-phone navigation is state, not URL. Anything else is a friendly not-found page.

export type Route =
  | { name: 'landing' }
  | { name: 'stage' }
  | { name: 'phone'; persona?: string }
  | { name: 'about' }
  | { name: 'pay' }
  | { name: 'notFound' }

export function parseHash(hash: string): Route {
  const path = (hash.replace(/^#/, '').split('?')[0] ?? '').replace(/\/+$/, '')
  const parts = path.split('/').filter(Boolean)
  if (parts.length === 0) return { name: 'landing' }
  const [head, second] = parts
  if (head === 'phone') {
    if (parts.length === 1) return { name: 'phone' }
    if (parts.length === 2 && second) return { name: 'phone', persona: decodeURIComponent(second) }
    return { name: 'notFound' }
  }
  if (parts.length > 1) return { name: 'notFound' }
  switch (head) {
    case 'stage':
      return { name: 'stage' }
    case 'about':
      return { name: 'about' }
    case 'pay':
      return { name: 'pay' }
    default:
      return { name: 'notFound' }
  }
}

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}
const readHash = () => location.hash

export function useHash(): string {
  return useSyncExternalStore(subscribe, readHash, readHash)
}

/** The stage needs room for two phones side by side: 768 px or more, in landscape. */
export function fitsStage(w: number, h: number): boolean {
  return w >= 768 && w > h
}

/** Where [Open BCPS] goes for a window of this size. */
export const openTarget = (w: number, h: number): '#/stage' | '#/phone' => (fitsStage(w, h) ? '#/stage' : '#/phone')
