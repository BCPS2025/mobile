// Tiny typed emitter for ephemeral UI events (never part of the ledger).

export interface UiEvents {
  /** A toast/notification on a phone (e.g. the off-screen side in phone mode). */
  notify: { phone: string; textKey?: string; text?: string; txId?: string }
  /** Text for the single page-level aria-live region. */
  'aria-live': { text: string }
}

export type UiEventName = keyof UiEvents
type Handler<K extends UiEventName> = (payload: UiEvents[K]) => void

export interface UiBus {
  on<K extends UiEventName>(type: K, handler: Handler<K>): () => void
  emit<K extends UiEventName>(type: K, payload: UiEvents[K]): void
}

export function createUiBus(): UiBus {
  const handlers = new Map<UiEventName, Set<(p: unknown) => void>>()
  return {
    on(type, handler) {
      let set = handlers.get(type)
      if (!set) {
        set = new Set()
        handlers.set(type, set)
      }
      const h = handler as (p: unknown) => void
      set.add(h)
      return () => {
        set.delete(h)
      }
    },
    emit(type, payload) {
      const set = handlers.get(type)
      if (!set) return
      for (const h of [...set]) h(payload)
    },
  }
}
