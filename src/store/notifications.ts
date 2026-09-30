import type { Content } from '@content/schema'
import { formatMinor } from '@domain/money'
import type { LedgerState, Minor, PersonaId, SimTime, Tx } from '@domain/types'
import { fillTemplate } from '@domain/counter'
import { type IsoDate, instantOfAt } from '@sim/tz'
import type { ReadMarks } from './record'

// Notifications are derived from the ledger, never stored (content/notifications.yaml): a
// settled payment into an account creates one for that account. Read marks are UI state
// (UiState.read: `readIds` per notification, `readUpTo` for "Mark all as read"). The kinds A2
// produces are p2p.received and sale.received; the others arrive with their features.

export type NotificationKind = 'p2p.received' | 'sale.received'

export interface Notification {
  /** Stable id, also the read mark: `tx:<reference>`. */
  id: string
  kind: NotificationKind
  persona: PersonaId
  /** When the payment settled. */
  at: SimTime
  txId: string
  title: string
  line: string | null
  /** The stage's toast when it is drawn shorter than the banner (null: none of its own). */
  toastTitle: string | null
  toastLine: string | null
  /** The payment amount as the payer sent it (the title's figure). */
  amount: Minor
  /** What tapping it opens (content/notifications.yaml `opens`). */
  opens: 'tx'
  banner: boolean
  toast: boolean
}

/** "2 × flat white · 2 × croissant" (the sale's items; the payment note when there are none). */
export function itemsLine(tx: Tx, content: Content): string {
  if (tx.items && tx.items.length > 0) {
    return tx.items
      .map((it) => fillTemplate(content.copy.tx.items, { qty: it.qty, name: it.name.toLocaleLowerCase('en') }))
      .join(' · ')
  }
  return tx.note ?? ''
}

/** The @handle of the account or off-stage person a payment came from, without the @. */
function payerOf(s: LedgerState, tx: Tx): string {
  const handle = tx.from === 'sys:offstage' ? tx.party : s.directory[tx.from]?.handle
  return (handle ?? '').replace(/^@/, '')
}

/** The kind a settled payment into an account has, or null when it has none (yet). */
function kindOf(tx: Tx): NotificationKind | null {
  if (tx.seed || tx.status !== 'confirmed') return null
  if (tx.kind === 'purchase' && (tx.channel === 'qr' || tx.channel === 'pos')) return 'sale.received'
  if (tx.kind === 'transfer' && tx.from !== 'sys:issuance') return 'p2p.received'
  return null
}

/** The notification a settled transaction creates for `persona`, or null. */
export function notificationOf(s: LedgerState, tx: Tx, persona: PersonaId, content: Content): Notification | null {
  if (tx.to !== persona) return null
  const kind = kindOf(tx)
  if (!kind) return null
  const entry = content.notifications[kind]
  if (!entry) return null
  const values = {
    payer: payerOf(s, tx),
    amount: formatMinor(tx.amount),
    note: tx.note ?? '',
    items: itemsLine(tx, content),
  }
  const line = entry.line ? fillTemplate(entry.line, values).replace(/^[\s·]+|[\s·]+$/g, '') : ''
  return {
    id: `tx:${tx.id}`,
    kind,
    persona,
    at: tx.confirmedAt ?? tx.createdAt,
    txId: tx.id,
    title: fillTemplate(entry.title, values),
    line: line.length > 0 ? line : null,
    toastTitle: entry.toastTitle ? fillTemplate(entry.toastTitle, values) : null,
    toastLine: entry.toastLine ? fillTemplate(entry.toastLine, values) : null,
    amount: tx.amount,
    opens: 'tx',
    banner: entry.banner,
    toast: entry.toast,
  }
}

/** Every notification of an account, newest first. */
export function notificationsFor(s: LedgerState, persona: PersonaId, content: Content): Notification[] {
  const out: Notification[] = []
  for (let i = s.txOrder.length - 1; i >= 0; i--) {
    const tx = s.txs[s.txOrder[i] ?? '']
    if (!tx) continue
    const n = notificationOf(s, tx, persona, content)
    if (n) out.push(n)
  }
  return out.sort((a, b) => b.at - a.at)
}

export function isRead(n: Notification, marks: ReadMarks | undefined, t0Date: IsoDate, tz: string): boolean {
  if (!marks) return false
  if (marks.readIds.includes(n.id)) return true
  return marks.readUpTo !== null && instantOfAt(t0Date, marks.readUpTo, tz) >= n.at
}

/** The number on the bell and in the account menu. */
export function unreadCount(
  s: LedgerState,
  persona: PersonaId,
  content: Content,
  marks: ReadMarks | undefined,
  t0Date: IsoDate,
  tz: string,
): number {
  return notificationsFor(s, persona, content).filter((n) => !isRead(n, marks, t0Date, tz)).length
}
