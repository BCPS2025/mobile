import type { AppState } from '../state/app'
import { createPhoneNav } from './nav'
import { isImplemented } from './implemented'
import type { Target } from './registry'
import { topOf } from './stack'
import type { Shell, SlotKey } from './types'
import type { PersonaId } from '@domain/types'

// Opening what a notification is about (a banner, a toast or a row of the Notifications list):
// it is marked read, then its payment detail opens on top of the persona's stack. A business
// that was paid opens the navy Received detail; while a flow step is on top the banner is
// informational only and nothing opens over the flow.

const TX: Target = { kind: 'detail', id: 'tx' }
const RECEIVED: Target = { kind: 'detail', id: 'received' }

export interface NotificationRef {
  id: string
  txId: string
  kind: string
}

export function openNotification(
  app: AppState,
  who: { persona: PersonaId; slot: SlotKey; shell: Shell },
  n: NotificationRef,
): void {
  const nav = createPhoneNav(app, who)
  if (topOf(nav.stack()).kind === 'flow') return
  app.actions.markRead(who.persona, n.id)
  const target = n.kind === 'sale.received' && isImplemented(RECEIVED, who.shell) ? RECEIVED : TX
  if (isImplemented(target, who.shell)) nav.open(target, { txId: n.txId })
}
