import type { Content } from '@content/schema'
import { fillTemplate } from '@domain/counter'
import type { LedgerEvent, LedgerState, PersonaId } from '@domain/types'
import type { LedgerNode } from './node'
import {
  type Notification,
  linkNotification,
  notificationOf,
  rampNotification,
  requestNotification,
} from './notifications'
import type { UiBus } from './uiBus'

// Effects of applied event batches on the uiBus: token travel (`money-moved`) when a payment is
// submitted, and one `notification` (plus an aria-live line) for each account that something
// reaches: a payment that settles into it (or out to its bank), a request made of it, declined or
// withdrawn, a payment link sent to it, a bank transfer on its way. They are cosmetics: derived
// from `user` and `timer` batches only; a replay (boot, Undo, a session taken over from another
// tab) is silent, and nothing here commits money.

export function attachEffects(node: LedgerNode, bus: UiBus, content: Content): () => void {
  const onStage = new Set<PersonaId>(content.personas.personas.filter((p) => p.onStage).map((p) => p.id))
  const nameOf = (s: LedgerState, id: PersonaId) => s.directory[id]?.displayName ?? id

  const announce = (n: Notification, s: LedgerState) => {
    bus.emit('notification', {
      persona: n.persona,
      id: n.id,
      kind: n.kind,
      txId: n.txId,
      subject: n.subject,
      title: n.title,
      line: n.line,
      toastTitle: n.toastTitle,
      toastLine: n.toastLine,
      amount: n.amount,
      banner: n.banner,
      toast: n.toast,
    })
    const what = n.line ? `${n.title} · ${n.line}` : n.title
    bus.emit('aria-live', {
      text: fillTemplate(content.copy.phoneMode.toast, { name: nameOf(s, n.persona), what }),
    })
  }

  const notify = (s: LedgerState, make: (persona: PersonaId) => Notification | null) => {
    for (const persona of onStage) {
      const n = make(persona)
      if (n) announce(n, s)
    }
  }

  const settled = (e: Extract<LedgerEvent, { type: 'tx.confirmed' }>, s: LedgerState) => {
    const tx = s.txs[e.txId]
    if (tx) notify(s, (persona) => notificationOf(s, tx, persona, content))
  }

  return node.onBatch((batch, s) => {
    if (batch.origin !== 'user' && batch.origin !== 'timer') return
    for (const e of batch.events) {
      switch (e.type) {
        case 'tx.submitted': {
          const tx = e.tx
          bus.emit('money-moved', {
            txId: tx.id,
            from: tx.from,
            to: tx.to,
            ...(tx.party ? { party: tx.party } : {}),
            amount: tx.amount,
            kind: tx.kind,
            origin: batch.origin,
          })
          break
        }
        case 'tx.confirmed':
          settled(e, s)
          break
        case 'request.created': {
          const request = s.requests[e.request.id]
          if (request) notify(s, (persona) => requestNotification(s, request, persona, content, 'created'))
          break
        }
        case 'request.status': {
          const request = s.requests[e.requestId]
          if (request && (e.status === 'declined' || e.status === 'cancelled')) {
            notify(s, (persona) =>
              requestNotification(s, request, persona, content, e.status as 'declined' | 'cancelled'),
            )
          }
          break
        }
        case 'link.shared': {
          const link = s.links[e.linkId]
          if (link) {
            const index = link.sharedWith.length - 1
            notify(s, (persona) => linkNotification(s, link, index, persona, content))
          }
          break
        }
        case 'ramp.requested': {
          const ramp = s.ramps[e.ramp.id]
          if (ramp) {
            const n = rampNotification(ramp, content)
            if (n && onStage.has(n.persona)) announce(n, s)
          }
          break
        }
        default:
          break
      }
    }
  })
}
