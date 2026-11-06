import { describe, expect, it } from 'vitest'
import { formatMinor } from '@domain/money'
import type { UserCommand } from '@domain/types'
import { resolveItems } from '@sim/seed'
import { attachEffects } from '@store/effects'
import { isRead, notificationsFor, unreadCount } from '@store/notifications'
import { freshUi } from '@store/record'
import { markAllRead, markRead } from '@store/sessions'
import { salesToday, sessionCounter } from '@store/selectors'
import { type UiEvents, createUiBus } from '@store/uiBus'
import { headless } from '../support/journey'
import { content, m } from './helpers'

// Notifications are derived from the ledger, never stored: a settled payment into an account
// creates one for that account. The effects put token travel and notifications on the uiBus for
// live batches only.

const TZ = content.config.t0.tz
const items = resolveItems(content, 'cafe', [
  { sku: 'flat-white', qty: 2 },
  { sku: 'croissant', qty: 2 },
])
let n = 0
const cmdId = () => `${(++n).toString(16).padStart(16, '0')}:review`

const sale = (): UserCommand => ({
  type: 'pay',
  actor: 'ana',
  cmdId: cmdId(),
  to: '@cafelipa',
  amount: m('11.00'),
  channel: 'qr',
  items,
  expect: { senderDebit: m('11.00') },
})
const send = (note?: string): UserCommand => ({
  type: 'pay',
  actor: 'ana',
  cmdId: cmdId(),
  to: '@marko',
  amount: m('16.50'),
  channel: 'username',
  ...(note ? { note } : {}),
  expect: { senderDebit: m('16.67') },
})

function session() {
  const h = headless('2026-09-25')
  const bus = createUiBus()
  const seen: { name: string; payload: unknown }[] = []
  for (const name of ['money-moved', 'notification', 'aria-live'] as const) {
    bus.on(name, (payload: UiEvents[typeof name]) => seen.push({ name, payload }))
  }
  attachEffects(h.node, bus, content)
  return { ...h, seen }
}

describe('derived notifications', () => {
  it('a sale settling into the café: "Payment received · 11.00 BCPS", from @ana and the items', () => {
    const { node } = session()
    expect(node.dispatch(sale()).ok).toBe(true)
    const sales = () => notificationsFor(node.getState(), 'cafe', content).filter((x) => x.kind === 'sale.received')
    expect(sales()).toEqual([]) // not while pending
    node.settleDue()
    const list = sales()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      kind: 'sale.received',
      persona: 'cafe',
      title: 'Payment received · 11.00 BCPS',
      line: 'from @ana · 2 × flat white · 2 × croissant',
      opens: 'tx',
      banner: true,
      toast: true,
    })
    expect(list[0]?.id).toMatch(/^tx:BC-/)
    // Outgoing: the receipt is the feedback (Ana keeps only the Lunch request from the start).
    expect(notificationsFor(node.getState(), 'ana', content).map((x) => x.kind)).toEqual(['request.received'])
  })

  it('a P2P payment: "@ana sent you 16.50 BCPS" with the note as the line, or no line', () => {
    const a = session()
    a.node.dispatch(send('Cinema'))
    a.node.settleDue()
    expect(notificationsFor(a.node.getState(), 'marko', content)[0]).toMatchObject({
      kind: 'p2p.received',
      title: '@ana sent you 16.50 BCPS',
      line: 'Cinema',
    })
    const b = session()
    b.node.dispatch(send())
    b.node.settleDue()
    expect(notificationsFor(b.node.getState(), 'marko', content)[0]?.line).toBeNull()
  })

  it('the starting ledger creates only the ones it lists as unread: Ana 1, Café 2, Marko 0', () => {
    const { node } = session()
    const count = (p: string) => unreadCount(node.getState(), p, content, undefined, '2026-09-25', TZ)
    expect([count('ana'), count('cafe'), count('marko'), count('supplier')]).toEqual([1, 2, 0, 0])
  })

  it('read marks: one mark, or "Mark all as read" up to now', () => {
    const { node, seed } = session()
    node.dispatch(sale())
    node.settleDue()
    const first = notificationsFor(node.getState(), 'cafe', content).find((x) => x.kind === 'sale.received')
    if (!first) throw new Error('no notification')
    const count = (ui: ReturnType<typeof freshUi>) =>
      unreadCount(node.getState(), 'cafe', content, ui.read.get('cafe'), seed.t0Date, TZ)
    // The café starts with two unread (Thursday's conversion and an invoice); the sale is a third.
    expect(count(freshUi())).toBe(3)
    expect(count(markRead(freshUi(), 'cafe', first.id))).toBe(2)
    expect(isRead(first, markRead(freshUi(), 'cafe', first.id).read.get('cafe'), seed.t0Date, TZ)).toBe(true)
    const all = markAllRead(freshUi(), 'cafe', node.now(), seed.t0Date, TZ)
    expect(count(all)).toBe(0)
    // A payment after "Mark all as read" is unread again.
    node.clock.advance(60_000)
    node.dispatch(sale())
    node.settleDue()
    expect(count(all)).toBe(1)
  })
})

describe('effects on the uiBus', () => {
  it('a user payment emits money-moved at once and a notification when it settles', () => {
    const { node, seen } = session()
    node.dispatch(sale())
    expect(seen.map((e) => e.name)).toEqual(['money-moved'])
    expect(seen[0]?.payload).toMatchObject({ from: 'ana', to: 'cafe', amount: m('11.00'), origin: 'user' })
    node.settleDue()
    const names = seen.map((e) => e.name)
    expect(names.filter((x) => x === 'notification')).toHaveLength(1)
    const note = seen.find((e) => e.name === 'notification')?.payload as UiEvents['notification']
    expect(note).toMatchObject({ persona: 'cafe', kind: 'sale.received', banner: true, toast: true })
    expect(note.amount).toBe(m('11.00'))
    const live = seen.find((e) => e.name === 'aria-live')?.payload as UiEvents['aria-live']
    expect(live.text).toBe(
      "On Café Lipa's phone: Payment received · 11.00 BCPS · from @ana · 2 × flat white · 2 × croissant",
    )
  })

  it('a payment to an off-stage person names them and notifies no one', () => {
    const { node, seen } = session()
    node.dispatch({
      type: 'pay',
      actor: 'cafe',
      cmdId: cmdId(),
      to: '@pekarnazrno',
      amount: m('8.80'),
      channel: 'username',
      expect: { senderDebit: m('8.89') },
    })
    node.settleDue()
    expect(seen.filter((e) => e.name === 'notification')).toHaveLength(0)
    expect(seen.find((e) => e.name === 'money-moved')?.payload).toMatchObject({ from: 'cafe', to: 'bakery' })
  })

  it('a replay (Reset, Undo, a restored session) is silent', () => {
    const { node, seen } = session()
    node.dispatch(sale())
    node.settleDue()
    const before = seen.length
    node.resetToSeed()
    expect(node.undoReset()).toBe(true)
    expect(seen).toHaveLength(before)
  })
})

describe('sales today and the session counter', () => {
  it('the café starts at 23 payments · 111.38 and counts a sale once it settles', () => {
    const { node } = session()
    const at = () => salesToday(node.getState(), 'cafe', node.now(), TZ)
    expect(at().count).toBe(23)
    expect(formatMinor(at().gross)).toBe('111.38')
    node.dispatch(sale())
    expect(at().count).toBe(23)
    node.settleDue()
    expect(at().count).toBe(24)
    expect(formatMinor(at().gross)).toBe('122.38')
  })

  it('the counter is empty until the first merchant payment, then counts it with its fee', () => {
    const { node } = session()
    expect(sessionCounter(node.getState())).toBeNull()
    node.dispatch(send('Cinema'))
    node.settleDue()
    expect(sessionCounter(node.getState())).toBeNull() // a P2P payment is not a merchant payment
    node.dispatch(sale())
    node.settleDue()
    const c = sessionCounter(node.getState())
    expect(c?.count).toBe(1)
    expect(c && formatMinor(c.fees)).toBe('0.11')
  })
})
