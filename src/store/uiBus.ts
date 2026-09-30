import type { AccountId, Handle, Minor, PersonaId, TxKind } from '@domain/types'

// Tiny typed emitter for ephemeral UI events (never part of the ledger). Cosmetics only: nothing
// that moves money ever happens inside a handler or a timer started from one.

export interface UiEvents {
  /** A toast/notification on a phone (e.g. the off-screen side in phone mode). */
  notify: { phone: string; textKey?: string; text?: string; txId?: string }
  /** Text for the single page-level aria-live region. */
  'aria-live': { text: string }
  /**
   * Money left one account for another (a payment was submitted by the user or a timer). Drives
   * the token travel between the two visible phones, or towards an edge marker when one side is
   * not on a phone. `party` names the off-stage person behind a sys:offstage leg.
   */
  'money-moved': {
    txId: string
    from: AccountId
    to: AccountId
    party?: Handle
    amount: Minor
    kind: TxKind
    /** The batch that produced it: replays never emit. */
    origin: 'user' | 'timer'
  }
  /**
   * A notification arrived for a persona (derived from the ledger when a payment settles). The
   * app decides whether it becomes a banner (the persona is on a phone) or a toast (it is not).
   */
  notification: {
    persona: PersonaId
    /** Stable id of the notification (its read mark). */
    id: string
    kind: string
    txId: string
    title: string
    line: string | null
    /** The stage's toast when it is drawn shorter than the banner (null: none of its own). */
    toastTitle: string | null
    toastLine: string | null
    amount: Minor
    banner: boolean
    toast: boolean
  }
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
