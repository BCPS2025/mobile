import type { Content } from '@content/schema'
import { fillTemplate } from '@domain/counter'
import type { LedgerEvent, LedgerState, PersonaId } from '@domain/types'
import type { LedgerNode } from './node'
import { notificationOf } from './notifications'
import type { UiBus } from './uiBus'

// Effects of applied event batches on the uiBus: token travel (`money-moved`) when a payment is
// submitted, and one `notification` (plus an aria-live line) for each account that a payment
// settles into. They are cosmetics: derived from `user` and `timer` batches only; a replay
// (boot, Undo, a session taken over from another tab) is silent, and nothing here commits money.

export function attachEffects(node: LedgerNode, bus: UiBus, content: Content): () => void {
  const onStage = new Set<PersonaId>(content.personas.personas.filter((p) => p.onStage).map((p) => p.id))
  const nameOf = (s: LedgerState, id: PersonaId) => s.directory[id]?.displayName ?? id

  const settled = (e: Extract<LedgerEvent, { type: 'tx.confirmed' }>, s: LedgerState) => {
    const tx = s.txs[e.txId]
    if (!tx) return
    for (const persona of onStage) {
      const n = notificationOf(s, tx, persona, content)
      if (!n) continue
      bus.emit('notification', {
        persona,
        id: n.id,
        kind: n.kind,
        txId: n.txId,
        title: n.title,
        line: n.line,
        toastTitle: n.toastTitle,
        toastLine: n.toastLine,
        amount: n.amount,
        banner: n.banner,
        toast: n.toast,
      })
      const what = n.line ? `${n.title} · ${n.line}` : n.title
      bus.emit('aria-live', { text: fillTemplate(content.copy.phoneMode.toast, { name: nameOf(s, persona), what }) })
    }
  }

  return node.onBatch((batch, s) => {
    if (batch.origin !== 'user' && batch.origin !== 'timer') return
    for (const e of batch.events) {
      if (e.type === 'tx.submitted') {
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
      } else if (e.type === 'tx.confirmed') {
        settled(e, s)
      }
    }
  })
}
