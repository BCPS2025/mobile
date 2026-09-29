import { createContext, useContext, useSyncExternalStore } from 'react'

// Screen stacks per key (a persona in the phone runtime: a stack survives account switching for
// the page session). UI state only: it is not part of the ledger. The element type is the app's
// screen union (the store never looks inside a screen); only `home` and `home › hub` are
// mirrored into the persisted UI state, by the app (see src/app/state).

export type Nav<T = string> = Record<string, readonly T[]>

export interface NavStore<T = string> {
  get(): Nav<T>
  stack(key: string): readonly T[]
  set(key: string, stack: readonly T[]): void
  /** Replaces every stack at once (Reset, Undo, a session taken over from another tab). */
  replaceAll(next: Nav<T>): void
  clear(): void
  subscribe(listener: () => void): () => void
}

export function createNavStore<T = string>(initial: Nav<T> = {}): NavStore<T> {
  const empty: readonly T[] = []
  let nav: Nav<T> = { ...initial }
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const l of [...listeners]) l()
  }
  return {
    get: () => nav,
    stack: (key) => nav[key] ?? empty,
    set(key, stack) {
      nav = { ...nav, [key]: [...stack] }
      notify()
    },
    replaceAll(next) {
      nav = { ...next }
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

export const NavContext = createContext<NavStore<unknown> | null>(null)

const EMPTY: readonly never[] = []

/** Screen stack of one key; re-renders when navigation changes. */
export function useNav<T = string>(key: string): readonly T[] {
  const store = useContext(NavContext) as NavStore<T> | null
  if (!store) throw new Error('useNav: missing <NavContext.Provider>')
  const nav = useSyncExternalStore(store.subscribe, store.get, store.get)
  return nav[key] ?? EMPTY
}
