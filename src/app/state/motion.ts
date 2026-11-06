import { useSyncExternalStore } from 'react'
import { usePrefs } from './AppContext'

// Reduced motion: the Settings switch when it has been used, otherwise the operating system.

const QUERY = '(prefers-reduced-motion: reduce)'

function subscribe(listener: () => void): () => void {
  const mq = window.matchMedia(QUERY)
  mq.addEventListener('change', listener)
  return () => mq.removeEventListener('change', listener)
}

const osPrefers = () => window.matchMedia(QUERY).matches

export function useReducedMotion(): boolean {
  const pref = usePrefs().reduceMotion
  const os = useSyncExternalStore(subscribe, osPrefers, () => false)
  return pref ?? os
}
