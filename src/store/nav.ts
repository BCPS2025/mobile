import { createContext, useContext, useSyncExternalStore } from 'react'

// Screen stacks per key (a phone slot now; a persona from milestone A2). UI state only: it is
// not part of the ledger, and Reset of the ledger does not depend on it.

export type Nav = Record<string, readonly string[]>

export interface NavStore {
  get(): Nav
  stack(key: string): readonly string[]
  set(key: string, stack: readonly string[]): void
  clear(): void
  subscribe(listener: () => void): () => void
}

const EMPTY: readonly string[] = []

export function createNavStore(initial: Nav = {}): NavStore {
  let nav: Nav = { ...initial }
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const l of [...listeners]) l()
  }
  return {
    get: () => nav,
    stack: (key) => nav[key] ?? EMPTY,
    set(key, stack) {
      nav = { ...nav, [key]: [...stack] }
      notify()
    },
    clear() {
      nav = {}
      notify()
    },
    subscribe(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
}

export const NavContext = createContext<NavStore | null>(null)

/** Screen stack of one key; re-renders when navigation changes. */
export function useNav(key: string): readonly string[] {
  const store = useContext(NavContext)
  if (!store) throw new Error('useNav: missing <NavContext.Provider>')
  const nav = useSyncExternalStore(store.subscribe, store.get, store.get)
  return nav[key] ?? EMPTY
}
