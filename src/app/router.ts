import { useSyncExternalStore } from 'react'

// Hash routing (relative paths, so the same build runs under any prefix and from file://).
//   #/                 start
//   #/about            about
//   #/pay?v=1&…        payment code landing
// Anything else is a friendly not-found page that links home.

export type Route = { name: 'start' } | { name: 'about' } | { name: 'pay' } | { name: 'notFound' }

export function parseHash(hash: string): Route {
  const path = (hash.replace(/^#/, '').split('?')[0] ?? '').replace(/\/+$/, '')
  const parts = path.split('/').filter(Boolean)
  if (parts.length === 0) return { name: 'start' }
  if (parts.length > 1) return { name: 'notFound' }
  switch (parts[0]) {
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
