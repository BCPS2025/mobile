import { describe, expect, it } from 'vitest'
import { evolve, nextTxId } from '@domain/ledger'
import type { LedgerEvent, PaymentRequest, PendingEvent, SimTime, Tx, UserCommand } from '@domain/types'
import { resolveItems } from '@sim/seed'
import { formatWeekday, resolveLocal } from '@sim/tz'
import { attachEffects } from '@store/effects'
import { type Notification, notificationsFor, unreadCount } from '@store/notifications'
import { markAllRead, markRead } from '@store/sessions'
import { freshUi } from '@store/record'
import { type UiEvents, createUiBus } from '@store/uiBus'
import { headless } from '../support/journey'
import { content, m } from './helpers'

// The notification kinds of requests, links, splits, refunds, top-ups and cash-outs: derived from
// the ledger for the account each concerns, and announced on the uiBus as they happen.

const TZ = content.config.t0.tz
let n = 0
const id = (step = 'review') => `${(++n).toString(16).padStart(16, '0')}:${step}`

function session(epoch = '2026-09-25') {
  const h = headless(epoch)
  const bus = createUiBus()
  const seen: { name: string; payload: unknown }[] = []
  for (const name of ['money-moved', 'notification', 'aria-live'] as const) {
    bus.on(name, (payload: UiEvents[typeof name]) => seen.push({ name, payload }))
  }
  attachEffects(h.node, bus, content)
  const run = (c: UserCommand): LedgerEvent[] => {
    const r = h.node.dispatch(c)
    if (!r.ok) throw new Error(`refused ${r.error.code}`)
    return r.value
  }
  const list = (persona: string): Notification[] => notificationsFor(h.node.getState(), persona, content)
  const kinds = (persona: string) => list(persona).map((x) => x.kind)
  const announced = (persona: string) =>
    seen
      .filter((e) => e.name === 'notification')
      .map((e) => e.payload as UiEvents['notification'])
      .filter((p) => p.persona === persona)
  return { ...h, seen, run, list, kinds, announced }
}
const debit = (amount: number) => (amount + Math.floor((amount + 50) / 100)) as never
const payRequest = (r: PaymentRequest, actor: string, to: string): UserCommand => ({
  type: 'pay',
  actor,
  cmdId: id(),
  to: to as `@${string}`,
  amount: r.amount,
  channel: 'request',
  requestId: r.id,
  expect: { senderDebit: debit(r.amount) },
})

describe('what the starting ledger lists as unread', () => {
  it('Ana: the Lunch request from Marko, ready to pay', () => {
    const s = session()
    const [only, ...rest] = s.list('ana')
    expect(rest).toEqual([])
    expect(only).toMatchObject({
      id: 'request:r_seed_lunch',
      kind: 'request.received',
      persona: 'ana',
      title: '@marko requests 13.20 BCPS',
      line: 'Lunch',
      opens: 'payItem',
      subject: { type: 'request', id: 'r_seed_lunch' },
      txId: null,
      amount: m('13.20'),
      banner: true,
      toast: true,
    })
    expect(s.list('marko')).toEqual([])
  })

  it("Café: Thursday's conversion and the bakery's invoice PZ-0412 (due in seven days)", () => {
    const s = session()
    const list = s.list('cafe')
    expect(list.map((x) => x.kind).sort()).toEqual(['conversion.auto', 'invoice.received'])
    const conversion = list.find((x) => x.kind === 'conversion.auto')
    expect(conversion).toMatchObject({
      title: 'Auto-converted 175.73 BCPS',
      line: '≈ €157.35 to your bank · conversion 2.64',
      opens: 'payouts',
      banner: true,
      toast: false,
    })
    expect(conversion?.id).toMatch(/^tx:BC-/)
    const invoice = list.find((x) => x.kind === 'invoice.received')
    expect(invoice).toMatchObject({
      id: 'request:PZ-0412',
      title: 'New invoice PZ-0412 from Pekarna Zrno',
      line: '52.80 BCPS · due Fri 2 Oct',
      opens: 'invoice',
    })
  })

  it("Kovina Nova has its invoice; the studio's listed entry is not a notification of this build", () => {
    const s = session()
    expect(s.kinds('firm')).toEqual(['invoice.received'])
    expect(s.list('firm')[0]?.title).toBe('New invoice HB-0917 from Hanbit Precision Co.')
    expect(s.kinds('studio')).toEqual([])
  })

  it('a row read, or "Mark all as read", clears the dot; a Reset brings them back', () => {
    const s = session()
    const count = (ui = freshUi()) =>
      unreadCount(s.node.getState(), 'cafe', content, ui.read.get('cafe'), s.seed.t0Date, TZ)
    expect(count()).toBe(2)
    const first = s.list('cafe')[0] as Notification
    expect(count(markRead(freshUi(), 'cafe', first.id))).toBe(1)
    expect(count(markAllRead(freshUi(), 'cafe', s.node.now(), s.seed.t0Date, TZ))).toBe(0)
  })
})

describe('requests', () => {
  it('a request made: the payer hears at once ("@ana requests 13.20 BCPS"), the requester does not', () => {
    const s = session()
    s.run({
      type: 'request.create',
      actor: 'ana',
      cmdId: id(),
      channel: 'username',
      payer: '@marko',
      amount: m('13.20'),
      note: 'Lunch',
    })
    const [note] = s.list('marko')
    expect(note).toMatchObject({
      kind: 'request.received',
      title: '@ana requests 13.20 BCPS',
      line: 'Lunch',
      id: 'request:R-000001',
      subject: { type: 'request', id: 'R-000001' },
    })
    expect(s.kinds('ana')).toEqual(['request.received']) // Ana still has Marko's Lunch request
    const heard = s.announced('marko')
    expect(heard).toHaveLength(1)
    expect(heard[0]).toMatchObject({ kind: 'request.received', banner: true, toast: true, txId: null })
    expect(s.seen.find((e) => e.name === 'aria-live')?.payload).toEqual({
      text: "On Marko Kovač's phone: @ana requests 13.20 BCPS · Lunch",
    })
  })

  it('paid: the requester hears once it settles ("@marko paid your request", "Spendable now")', () => {
    const s = session()
    s.run({
      type: 'request.create',
      actor: 'ana',
      cmdId: id(),
      channel: 'username',
      payer: '@marko',
      amount: m('13.20'),
      note: 'Lunch',
    })
    const r = s.node.getState().requests['R-000001'] as PaymentRequest
    s.run(payRequest(r, 'marko', '@ana'))
    expect(s.kinds('ana')).toEqual(['request.received']) // not while pending
    s.node.settleDue()
    expect(s.list('ana')[0]).toMatchObject({
      kind: 'request.paid',
      title: '@marko paid your request · 13.20 BCPS',
      line: 'Lunch · Spendable now',
      opens: 'tx',
    })
    expect(s.list('ana')[0]?.txId).toMatch(/^BC-/)
    expect(s.kinds('marko')).toEqual(['request.received']) // his outgoing payment has none
    expect(s.announced('ana').at(-1)).toMatchObject({ kind: 'request.paid', banner: true, toast: true })
  })

  it('the seeded Lunch request paid by Ana: Marko hears "@ana paid your request"', () => {
    const s = session()
    s.run(payRequest(s.node.getState().requests.r_seed_lunch as PaymentRequest, 'ana', '@marko'))
    s.node.settleDue()
    expect(s.list('marko')[0]).toMatchObject({ kind: 'request.paid', title: '@ana paid your request · 13.20 BCPS' })
  })

  it('declined: the requester hears, no money moved; cancelled: the payer hears without banner or toast', () => {
    const s = session()
    s.run({ type: 'request.decline', actor: 'ana', cmdId: id('decline'), requestId: 'r_seed_lunch', reason: 'Not now' })
    expect(s.list('marko')[0]).toMatchObject({
      kind: 'request.declined',
      title: '@ana declined your request',
      line: 'Lunch · no money moved',
      opens: 'request',
      banner: true,
      toast: true,
    })
    s.run({
      type: 'request.create',
      actor: 'marko',
      cmdId: id(),
      channel: 'username',
      payer: '@ana',
      amount: m('5.00'),
      note: 'Coffee',
    })
    s.run({ type: 'request.cancel', actor: 'marko', cmdId: id('cancel'), requestId: 'R-000001' })
    const cancelled = s.list('ana').find((x) => x.kind === 'request.cancelled')
    expect(cancelled).toMatchObject({
      title: '@marko cancelled the request',
      line: 'Coffee',
      opens: 'none',
      banner: false,
      toast: false,
      subject: { type: 'none' },
    })
    // Announced too (the app shows a banner or toast only when the entry says so).
    expect(s.announced('ana').at(-1)).toMatchObject({ kind: 'request.cancelled', banner: false, toast: false })
  })

  it('a payment code (no payer) and a request to an off-stage person notify no one on stage', () => {
    const s = session()
    s.run({ type: 'request.create', actor: 'cafe', cmdId: id('items'), channel: 'pos', amount: m('11.00') })
    s.run({
      type: 'request.create',
      actor: 'ana',
      cmdId: id(),
      channel: 'username',
      payer: '@marta_k',
      amount: m('4.00'),
    })
    expect(s.announced('cafe')).toHaveLength(0)
    expect(s.kinds('cafe').sort()).toEqual(['conversion.auto', 'invoice.received'])
    expect(s.seen.filter((e) => e.name === 'notification')).toHaveLength(0)
  })
})

describe('payment links', () => {
  it('sent to Marko he hears ("@ana sent you a payment link"); when he pays, Ana hears', () => {
    const s = session()
    s.run({ type: 'link.create', actor: 'ana', cmdId: id('link'), amount: m('13.20'), note: 'Pizza' })
    expect(s.kinds('marko')).toEqual([]) // made, not sent
    s.run({ type: 'link.share', actor: 'ana', cmdId: id('share'), linkId: 'L-000001', to: '@marko' })
    expect(s.list('marko')).toHaveLength(1)
    expect(s.list('marko')[0]).toMatchObject({
      kind: 'link.received',
      id: 'link:L-000001:marko',
      title: '@ana sent you a payment link',
      line: '13.20 BCPS · Pizza',
      opens: 'link',
      subject: { type: 'link', id: 'L-000001' },
      banner: true,
      toast: true,
    })
    expect(s.announced('marko')).toHaveLength(1)
    s.run({
      type: 'pay',
      actor: 'marko',
      cmdId: id(),
      to: '@ana',
      amount: m('13.20'),
      channel: 'link',
      linkId: 'L-000001',
      expect: { senderDebit: m('13.33') },
    })
    s.node.settleDue()
    expect(s.list('ana')[0]).toMatchObject({
      kind: 'link.paid',
      title: '@marko paid your link · 13.20 BCPS',
      line: 'Pizza',
      opens: 'tx',
    })
  })
})

describe('splits', () => {
  const splitWith = (s: ReturnType<typeof session>, shares: { party: string; amount: string }[], total = '10.00') =>
    s.run({
      type: 'split.create',
      actor: 'ana',
      cmdId: id('split'),
      total: m(total),
      note: 'Pizza night',
      shares: shares.map((x) => ({ party: x.party as `@${string}`, amount: m(x.amount) })),
    })

  it('a share asked: the participant hears "@ana split Pizza night · Your share 3.33 BCPS"', () => {
    const s = session()
    splitWith(s, [
      { party: '@marko', amount: '3.33' },
      { party: '@marta_k', amount: '3.33' },
    ])
    expect(s.list('marko')[0]).toMatchObject({
      kind: 'split.received',
      title: '@ana split Pizza night',
      line: 'Your share 3.33 BCPS',
      opens: 'payItem',
      subject: { type: 'request', id: 'R-000001' },
    })
  })

  it('the owner hears the payment of a split of one person as "everyone paid ✓"', () => {
    const s = session()
    splitWith(s, [{ party: '@marko', amount: '5.00' }])
    s.run(payRequest(s.node.getState().requests['R-000001'] as PaymentRequest, 'marko', '@ana'))
    expect(s.kinds('ana')).toEqual(['request.received']) // not while pending
    s.node.settleDue()
    expect(s.list('ana')[0]).toMatchObject({
      kind: 'split.completed',
      title: 'Pizza night · everyone paid ✓',
      line: '5.00 BCPS collected',
      opens: 'split',
      banner: true,
      toast: false,
    })
    expect(s.announced('ana').filter((x) => x.kind === 'split.completed')).toHaveLength(1)
  })

  it('with several people the owner hears each payment, and "everyone paid ✓" for the last to settle', () => {
    const s = session()
    splitWith(s, [
      { party: '@marko', amount: '3.33' },
      { party: '@marta_k', amount: '3.33' },
    ])
    s.run(payRequest(s.node.getState().requests['R-000001'] as PaymentRequest, 'marko', '@ana'))
    s.node.settleDue()
    expect(s.list('ana')[0]).toMatchObject({ kind: 'request.paid', title: '@marko paid your request · 3.33 BCPS' })
    // Marta (off-stage, so she cannot pay on this device) pays: a payment from her, recorded as events.
    const offstage = s.node.getState()
    const at = (s.node.now() + 60_000) as SimTime
    const tx: Tx = {
      id: nextTxId(offstage),
      kind: 'transfer',
      channel: 'request',
      status: 'pending',
      from: 'sys:offstage',
      to: 'ana',
      amount: m('3.33'),
      fee: {
        policy: 'transfer',
        fee: 3 as never,
        payer: 'sender',
        rule: 'percent',
        senderDebit: m('3.36'),
        recipientCredit: m('3.33'),
      },
      postings: [
        { account: 'sys:offstage', delta: -336 as never, party: '@marta_k' },
        { account: 'ana', delta: 333 as never },
        { account: 'sys:fees', delta: 3 as never },
      ],
      createdAt: at,
      dueAt: (at + 1400) as SimTime,
      party: '@marta_k',
      links: { requestId: 'R-000002' },
    }
    let state = offstage
    const events: PendingEvent[] = [
      { type: 'tx.submitted', tx },
      { type: 'tx.confirmed', txId: tx.id },
    ]
    for (const [i, e] of events.entries()) {
      state = evolve(state, { ...e, seq: state.seq + 1, at: (i === 0 ? at : at + 1400) as SimTime } as LedgerEvent)
    }
    const list = notificationsFor(state, 'ana', content)
    expect(list[0]).toMatchObject({
      kind: 'split.completed',
      line: '6.66 BCPS collected',
      subject: { type: 'tx', id: tx.id },
    })
    expect(list.filter((x) => x.kind === 'request.paid')).toHaveLength(1)
    expect(list.filter((x) => x.kind === 'split.completed')).toHaveLength(1)
  })

  it('cancelled shares tell their payers; a split with a cancelled share never reads "everyone paid"', () => {
    const s = session()
    splitWith(s, [
      { party: '@marko', amount: '3.33' },
      { party: '@marta_k', amount: '3.33' },
    ])
    s.run({ type: 'split.cancel', actor: 'ana', cmdId: id('cancel'), splitId: 'S-000001' })
    expect(s.kinds('marko')).toEqual(['request.cancelled', 'split.received'])
    expect(s.kinds('ana')).toEqual(['request.received'])
  })
})

describe('refunds', () => {
  it('the customer hears "Refund from Café Lipa · 26.40 BCPS" with what was bought', () => {
    const s = session()
    const brunch = Object.values(s.node.getState().txs).find((t) => t.seedMeta?.key === 'cafe-thu-brunch')
    if (!brunch) throw new Error('no brunch')
    s.run({ type: 'refund', actor: 'cafe', cmdId: id('refund'), txId: brunch.id })
    expect(s.kinds('ana')).toEqual(['request.received']) // not while pending
    s.node.settleDue()
    expect(s.list('ana')[0]).toMatchObject({
      kind: 'refund.received',
      title: 'Refund from Café Lipa · 26.40 BCPS',
      line: '2 × brunch',
      opens: 'tx',
      banner: true,
      toast: true,
    })
    expect(s.kinds('cafe').includes('refund.received')).toBe(false)
  })

  it('a refund of a sale with a note names the note; with neither, the line is empty', () => {
    const s = session()
    const items = resolveItems(content, 'cafe', [{ sku: 'flat-white', qty: 2 }])
    s.run({
      type: 'pay',
      actor: 'ana',
      cmdId: id(),
      to: '@cafelipa',
      amount: m('6.60'),
      channel: 'qr',
      items,
      expect: { senderDebit: m('6.60') },
    })
    s.node.settleDue()
    const sale = Object.values(s.node.getState().txs).find((t) => !t.seed && t.kind === 'purchase')
    s.run({ type: 'refund', actor: 'cafe', cmdId: id('refund'), txId: sale?.id ?? '' })
    s.node.settleDue()
    expect(s.list('ana')[0]).toMatchObject({ kind: 'refund.received', line: '2 × flat white' })
  })
})

describe('money in and out', () => {
  it('a card top-up: "Top-up complete · +55.00 BCPS", "Card •• 7719"; the café\'s local one has no card', () => {
    const s = session()
    s.run({ type: 'ramp.on', actor: 'ana', cmdId: id('topup'), method: 'card', eur: 50 })
    expect(s.kinds('ana')).toEqual(['request.received'])
    s.node.settleDue()
    expect(s.list('ana')[0]).toMatchObject({
      kind: 'topup.completed',
      title: 'Top-up complete · +55.00 BCPS',
      line: 'Card •• 7719',
      opens: 'tx',
      banner: true,
      toast: false,
    })
    s.run({ type: 'ramp.on', actor: 'cafe', cmdId: id('topup'), method: 'local-method', eur: 20 })
    s.node.settleDue()
    expect(s.list('cafe')[0]).toMatchObject({ kind: 'topup.completed', line: 'Local payment method' })
  })

  it('a bank transfer: "on its way · €50.00, Expected Fri 14:15", then "Top-up arrived" when it comes', () => {
    const s = session()
    s.run({ type: 'ramp.on', actor: 'ana', cmdId: id('topup'), method: 'bank-transfer', eur: 50 })
    expect(s.list('ana')[0]).toMatchObject({
      kind: 'topup.pending',
      id: 'ramp:RP-000001',
      title: 'Top-up on its way · €50.00',
      line: 'Expected Fri 14:15',
      opens: 'ramp',
      subject: { type: 'ramp', id: 'RP-000001' },
      banner: false,
      toast: false,
    })
    expect(s.announced('ana').at(-1)).toMatchObject({ kind: 'topup.pending', banner: false })
    const arrives = s.node.getState().ramps['RP-000001']?.arrivesAt ?? 0
    expect(formatWeekday(arrives as never, TZ)).toBe('Fri')
    expect(arrives).toBe(resolveLocal(s.seed.t0Date, '14:15', TZ))
    s.node.advanceTo(arrives as never, 'timer')
    s.node.settleDue()
    const [arrived, pending] = s.list('ana')
    expect(arrived).toMatchObject({
      kind: 'topup.arrived',
      title: 'Top-up arrived · +55.00 BCPS',
      line: 'Bank transfer · €50.00',
      banner: true,
      toast: true,
    })
    expect(pending?.kind).toBe('topup.pending')
    expect(s.announced('ana').at(-1)).toMatchObject({ kind: 'topup.arrived' })
  })

  it('a cash-out: "Cash out · ≈ €98.50 on its way", "To SI56 •••• •••• 4821", no banner', () => {
    const s = session()
    s.run({ type: 'ramp.off', actor: 'ana', cmdId: id('cashout'), amount: m('110.00') })
    s.node.settleDue()
    expect(s.list('ana')[0]).toMatchObject({
      kind: 'cashout.sent',
      title: 'Cash out · ≈ €98.50 on its way',
      line: 'To SI56 •••• •••• 4821',
      opens: 'tx',
      banner: false,
      toast: false,
    })
  })
})

describe('derived, not stored', () => {
  it('a replay is silent and derives the same list', () => {
    const s = session()
    s.run({
      type: 'request.create',
      actor: 'ana',
      cmdId: id(),
      channel: 'username',
      payer: '@marko',
      amount: m('13.20'),
      note: 'Lunch',
    })
    s.run({ type: 'link.create', actor: 'ana', cmdId: id('link'), amount: m('13.20') })
    s.run({ type: 'link.share', actor: 'ana', cmdId: id('share'), linkId: 'L-000001', to: '@marko' })
    const before = s.seen.length
    const list = JSON.stringify(s.list('marko'))
    s.node.resetToSeed()
    expect(s.list('marko')).toEqual([])
    expect(s.node.undoReset()).toBe(true)
    expect(s.seen).toHaveLength(before)
    expect(JSON.stringify(s.list('marko'))).toBe(list)
  })

  it('newest first, one row per happening', () => {
    const s = session()
    s.run({
      type: 'request.create',
      actor: 'ana',
      cmdId: id(),
      channel: 'username',
      payer: '@marko',
      amount: m('13.20'),
    })
    s.node.clock.advance(60_000)
    s.run({ type: 'link.create', actor: 'ana', cmdId: id('link'), amount: m('4.00') })
    s.run({ type: 'link.share', actor: 'ana', cmdId: id('share'), linkId: 'L-000001', to: '@marko' })
    expect(s.kinds('marko')).toEqual(['link.received', 'request.received'])
  })
})
