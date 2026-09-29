import { useSyncExternalStore } from 'react'

// A tiny immutable store with React bindings: the transient UI state of the page (banners,
// toasts, the Welcome screens, the zoomed phone). Nothing in it is persisted.

export interface Store<T> {
  get(): T
  set(next: T): void
  update(patch: (current: T) => T): void
  subscribe(listener: () => void): () => void
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial
  const listeners = new Set<() => void>()
  const set = (next: T) => {
    if (Object.is(next, value)) return
    value = next
    for (const l of [...listeners]) l()
  }
  return {
    get: () => value,
    set,
    update: (patch) => set(patch(value)),
    subscribe(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
}

/** The store's value, or a selection of it (the selector must return a stable value). */
export function useStore<T, S = T>(store: Store<T>, select: (value: T) => S = (v) => v as unknown as S): S {
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.get()),
    () => select(store.get()),
  )
}
