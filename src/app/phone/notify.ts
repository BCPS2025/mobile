import type { AppState } from '../state/app'
import { createPhoneNav } from './nav'
import { isImplemented } from './implemented'
import type { Target } from './registry'
import { topOf } from './stack'
import type { Shell, SlotKey } from './types'
import { entryOf } from '@domain/ledger'
import type { PersonaId } from '@domain/types'
import type { NotificationSubject } from '@store/notifications'

// Opening what a notification is about (a banner, a toast or a row of the Notifications list):
// it is marked read, then what it is about opens on top of the persona's stack: the payment's
// detail, the check of a request, a payment link or a split share that is to be paid, or the
// detail of a request or split the account made. A business that was paid opens the navy Received
// detail; while a flow step is on top the banner is informational only and nothing opens over the
// flow.

const TX: Target = { kind: 'detail', id: 'tx' }
const RECEIVED: Target = { kind: 'detail', id: 'received' }

export interface NotificationRef {
  id: string
  /** The payment it is about; null for a request, a link or a bank transfer (their screens follow). */
  txId: string | null
  subject: NotificationSubject
  kind: string
}

interface Route {
  target: Target
  params: Record<string, string>
}

/** The screen a notification opens, or null when it has none (yet). */
function routeOf(app: AppState, who: { persona: PersonaId; shell: Shell }, n: NotificationRef): Route | null {
  const s = app.runtime.node.getState()
  const subject = n.subject
  if (subject.type === 'request') {
    // Asked of this account: its check. The requester's own request: its detail (declined).
    if (n.kind === 'request.received' || n.kind === 'split.received')
      return { target: { kind: 'flow', id: 'payItem' }, params: { request: subject.id } }
    if (n.kind === 'request.declined')
      return { target: { kind: 'detail', id: 'request' }, params: { requestId: subject.id } }
    return null
  }
  if (subject.type === 'link') {
    return n.kind === 'link.received' ? { target: { kind: 'flow', id: 'payItem' }, params: { link: subject.id } } : null
  }
  if (n.txId === null) return null
  if (n.kind === 'split.completed') {
    const tx = entryOf(s.txs, n.txId)
    const request = tx?.links?.requestId === undefined ? undefined : entryOf(s.requests, tx.links.requestId)
    if (request?.splitId !== undefined)
      return { target: { kind: 'detail', id: 'split' }, params: { splitId: request.splitId } }
  }
  const target = n.kind === 'sale.received' && isImplemented(RECEIVED, who.shell) ? RECEIVED : TX
  return { target, params: { txId: n.txId } }
}

export function openNotification(
  app: AppState,
  who: { persona: PersonaId; slot: SlotKey; shell: Shell },
  n: NotificationRef,
): void {
  const nav = createPhoneNav(app, who)
  if (topOf(nav.stack()).kind === 'flow') return
  app.actions.markRead(who.persona, n.id)
  const route = routeOf(app, who, n)
  if (route && isImplemented(route.target, who.shell)) nav.open(route.target, route.params)
}

/**
 * A toast for an account that is not on a phone was tapped (the stage's gutter toast, phone
 * mode's [Switch]): that account comes onto the phone, and its notification opens as the banner
 * would open it.
 */
export function openToast(
  app: AppState,
  slot: SlotKey,
  t: {
    id: string
    persona: PersonaId
    notificationId: string
    txId: string | null
    subject: NotificationSubject
    kind: string
  },
): void {
  app.actions.choose(slot, t.persona)
  app.actions.dismissToast(t.id)
  const shell = app.persona(t.persona)?.shell
  if (shell)
    openNotification(
      app,
      { persona: t.persona, slot, shell },
      { id: t.notificationId, txId: t.txId, subject: t.subject, kind: t.kind },
    )
}
