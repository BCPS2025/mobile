import { describe, expect, it } from 'vitest'
import { formatHundredths } from '@domain/money'
import type { LedgerState, Minor, SimTime, Tx, UserCommand } from '@domain/types'
import { resolveItems } from '@sim/seed'
import { formatTime, localDateOf, resolveLocal } from '@sim/tz'
import {
  CAFE_FILTERS,
  PEOPLE_FILTERS,
  SHOWN_QR_WINDOW_MS,
  type ShownQr,
  activity,
  autoConvertPreview,
  badges,
  bankOf,
  counterMerchants,
  csvCell,
  daySummary,
  feePayerExamples,
  hasBank,
  invoiceTag,
  invoices,
  linksOf,
  maxCashOut,
  myRequests,
  noteShownQr,
  nextAutoConvert,
  payItems,
  payoutsOf,
  quoteCashOut,
  rampByCmdId,
  refundableSales,
  salesCsv,
  salesCsvFile,
  salesDashboard,
  scanCandidates,
  splitCandidates,
  splitsOf,
  topUpAmount,
  topUpForShortfall,
  topUpMethods,
  txDetail,
} from '@store/selectors'
import { type Headless, headless } from '../support/journey'
import { content, m } from './helpers'

// The selectors of everyday money, money in and out, and the café's business tools, against the
// starting ledger and small sessions on top of it.

const TZ = content.config.t0.tz
const VALIDITY = content.config.posCodeValidityMin * 60_000
let n = 0
const id = (step = 'review') => `${(++n).toString(16).padStart(16, '0')}:${step}`

const run = (h: Headless, c: UserCommand) => {
  const r = h.node.dispatch(c)
  if (!r.ok) throw new Error(`refused ${r.error.code}`)
  return r.value
}
const fresh = () => headless('2026-09-25')
const state = (h: Headless): LedgerState => h.node.getState()
const money = (n: number) => formatHundredths(n)
const seedTx = (h: Headless, key: string): Tx => {
  const tx = Object.values(state(h).txs).find((t) => t.seedMeta?.key === key)
  if (!tx) throw new Error(`no row ${key}`)
  return tx
}
const elevenSale = (h: Headless, note?: string): Tx => {
  const items = resolveItems(content, 'cafe', [
    { sku: 'flat-white', qty: 2 },
    { sku: 'croissant', qty: 2 },
  ])
  const cmdId = id()
  run(h, {
    type: 'pay',
    actor: 'ana',
    cmdId,
    to: '@cafelipa',
    amount: m('11.00'),
    channel: 'qr',
    ...(note ? { note } : {}),
    items,
    expect: { senderDebit: m('11.00') },
  })
  h.node.settleDue()
  return Object.values(state(h).txs).find((t) => t.cmdId === cmdId) as Tx
}
const ask = (h: Headless, actor: string, payer: string, amount: string, note = 'Lunch') =>
  run(h, {
    type: 'request.create',
    actor,
    cmdId: id('request'),
    channel: 'username',
    payer: payer as never,
    amount: m(amount),
    note,
  })

describe('to pay, waiting and badges', () => {
  it('fresh: Ana has the Lunch request to pay; the café the bakery invoice; Marko nothing', () => {
    const h = fresh()
    const ana = payItems(state(h), 'ana')
    expect(ana).toHaveLength(1)
    expect(ana[0]).toMatchObject({ kind: 'request', id: 'r_seed_lunch', from: { id: 'marko' } })
    const cafe = payItems(state(h), 'cafe')
    expect(cafe.map((i) => [i.kind, i.id])).toEqual([['invoice', 'PZ-0412']])
    expect(payItems(state(h), 'marko')).toEqual([])
    expect(badges(state(h), 'ana')).toEqual({ toPay: 1, invoicesToPay: 0, escrowAction: 0 })
    expect(badges(state(h), 'cafe')).toEqual({ toPay: 0, invoicesToPay: 1, escrowAction: 0 })
    expect(badges(state(h), 'marko')).toEqual({ toPay: 0, invoicesToPay: 0, escrowAction: 0 })
  })

  it('requests, links sent to me and open split shares count; paid, declined and cancelled ones do not', () => {
    const h = fresh()
    ask(h, 'ana', '@marko', '13.20')
    run(h, { type: 'link.create', actor: 'ana', cmdId: id('link'), amount: m('4.00'), note: 'Pizza' })
    run(h, { type: 'link.share', actor: 'ana', cmdId: id('share'), linkId: 'L-000001', to: '@marko' })
    run(h, {
      type: 'split.create',
      actor: 'ana',
      cmdId: id('split'),
      total: m('10.00'),
      note: 'Pizza night',
      shares: [{ party: '@marko', amount: m('3.33') }],
    })
    const items = payItems(state(h), 'marko')
    expect(items.map((i) => i.kind).sort()).toEqual(['link', 'request', 'split'])
    expect(badges(state(h), 'marko').toPay).toBe(3)
    expect(items.find((i) => i.kind === 'split')).toMatchObject({ split: { id: 'S-000001' }, from: { id: 'ana' } })
    // Marko declines the request and the split share: two fewer.
    run(h, { type: 'request.decline', actor: 'marko', cmdId: id('decline'), requestId: 'R-000001' })
    run(h, { type: 'request.decline', actor: 'marko', cmdId: id('decline'), requestId: 'R-000002' })
    expect(payItems(state(h), 'marko').map((i) => i.kind)).toEqual(['link'])
    // The link is paid: none left.
    run(h, {
      type: 'pay',
      actor: 'marko',
      cmdId: id(),
      to: '@ana',
      amount: m('4.00'),
      channel: 'link',
      linkId: 'L-000001',
      expect: { senderDebit: m('4.04') },
    })
    expect(badges(state(h), 'marko').toPay).toBe(0)
    // The owner never has her own link to pay.
    expect(payItems(state(h), 'ana').map((i) => i.kind)).toEqual(['request'])
  })

  it('invoices: DUE until the end of the due day, then OVERDUE', () => {
    const h = fresh()
    const [row] = invoices(state(h), 'cafe', 'toPay')
    expect(row).toMatchObject({ number: 'PZ-0412', description: 'Weekly bread order', amount: m('52.80') })
    expect(row?.issuer?.displayName).toBe('Pekarna Zrno')
    const request = row?.request
    if (!request) throw new Error('no invoice')
    expect(invoiceTag(request, h.node.now(), TZ)).toBe('due')
    const dueDay = localDateOf(row?.dueAt as SimTime, TZ)
    expect(invoiceTag(request, resolveLocal(dueDay, '23:59', TZ), TZ)).toBe('due')
    expect(invoiceTag(request, (resolveLocal(dueDay, '23:59', TZ) + 60_000) as SimTime, TZ)).toBe('overdue')
    expect(invoices(state(h), 'firm', 'toPay').map((r) => r.number)).toEqual(['HB-0917'])
    expect(invoices(state(h), 'cafe', 'sent')).toEqual([])
    // Once paid it is no longer to pay.
    run(h, {
      type: 'pay',
      actor: 'cafe',
      cmdId: id(),
      to: '@pekarnazrno',
      amount: m('52.80'),
      channel: 'request',
      requestId: 'PZ-0412',
      expect: { senderDebit: m('53.33') },
    })
    expect(invoices(state(h), 'cafe', 'toPay')).toEqual([])
    expect(badges(state(h), 'cafe').invoicesToPay).toBe(0)
    expect(invoices(state(h), 'supplier', 'sent').map((r) => r.number)).toEqual(['HB-0917'])
  })

  it('what I asked: open requests and their outcomes, newest change first; a paid one has its payment', () => {
    const h = fresh()
    expect(myRequests(state(h), 'marko').map((r) => r.request.id)).toEqual(['r_seed_lunch'])
    expect(myRequests(state(h), 'ana')).toEqual([])
    ask(h, 'ana', '@marko', '13.20')
    h.node.clock.advance(60_000)
    ask(h, 'ana', '@marta_k', '5.00', 'Taxi')
    const mine = myRequests(state(h), 'ana')
    expect(mine.map((r) => r.request.id)).toEqual(['R-000002', 'R-000001'])
    expect(mine[0]?.payer?.displayName).toBe('Marta K.')
    run(h, { type: 'request.cancel', actor: 'ana', cmdId: id('cancel'), requestId: 'R-000002' })
    h.node.clock.advance(1000)
    run(h, {
      type: 'pay',
      actor: 'marko',
      cmdId: id(),
      to: '@ana',
      amount: m('13.20'),
      channel: 'request',
      requestId: 'R-000001',
      expect: { senderDebit: m('13.33') },
    })
    const after = myRequests(state(h), 'ana')
    expect(after.map((r) => r.request.status)).toEqual(['paid', 'cancelled'])
    expect(after[0]?.tx?.amount).toBe(1320)
  })

  it('links: newest first with who paid; splits: progress, collected and open', () => {
    const h = fresh()
    run(h, { type: 'link.create', actor: 'ana', cmdId: id('link'), amount: m('13.20'), note: 'Pizza' })
    h.node.clock.advance(1000)
    run(h, { type: 'link.create', actor: 'ana', cmdId: id('link'), amount: m('2.00') })
    run(h, { type: 'link.share', actor: 'ana', cmdId: id('share'), linkId: 'L-000001', to: '@marko' })
    run(h, {
      type: 'pay',
      actor: 'marko',
      cmdId: id(),
      to: '@ana',
      amount: m('13.20'),
      channel: 'link',
      linkId: 'L-000001',
      expect: { senderDebit: m('13.33') },
    })
    const links = linksOf(state(h), 'ana')
    expect(links.map((l) => l.link.id)).toEqual(['L-000002', 'L-000001'])
    expect(links[0]).toMatchObject({ payment: undefined, paidBy: undefined })
    expect(links[1]?.paidBy?.handle).toBe('@marko')
    expect(links[1]?.sharedWith.map((p) => p.id)).toEqual(['marko'])

    const brunch = seedTx(h, 'cafe-thu-brunch')
    run(h, {
      type: 'split.create',
      actor: 'ana',
      cmdId: id('split'),
      sourceTxId: brunch.id,
      total: brunch.amount,
      note: 'Brunch for two',
      shares: [
        { party: '@marko', amount: m('8.80') },
        { party: '@marta_k', amount: m('8.80') },
      ],
    })
    const [split] = splitsOf(state(h), 'ana')
    expect(split).toMatchObject({ paid: 0, count: 2, status: 'open', source: { id: brunch.id } })
    expect(money(split?.collected ?? 0)).toBe('0.00')
    expect(money(split?.open ?? 0)).toBe('17.60')
    run(h, {
      type: 'pay',
      actor: 'marko',
      cmdId: id(),
      to: '@ana',
      amount: m('8.80'),
      channel: 'request',
      requestId: 'R-000001',
      expect: { senderDebit: m('8.89') },
    })
    const half = splitsOf(state(h), 'ana')[0]
    expect(half).toMatchObject({ paid: 1, count: 2, status: 'open' })
    expect(money(half?.collected ?? 0)).toBe('8.80')
    expect(money(half?.open ?? 0)).toBe('8.80')
    expect(half?.shares.map((x) => [x.party?.handle, x.status])).toEqual([
      ['@marko', 'paid'],
      ['@marta_k', 'open'],
    ])
    run(h, { type: 'split.cancel', actor: 'ana', cmdId: id('cancel'), splitId: 'S-000001' })
    expect(splitsOf(state(h), 'ana')[0]).toMatchObject({ paid: 1, status: 'closed' })
    expect(splitsOf(state(h), 'marko')).toEqual([])
  })

  it('a split completes when every share is paid', () => {
    const h = fresh()
    run(h, {
      type: 'split.create',
      actor: 'ana',
      cmdId: id('split'),
      total: m('10.00'),
      note: 'Pizza',
      shares: [{ party: '@marko', amount: m('5.00') }],
    })
    run(h, {
      type: 'pay',
      actor: 'marko',
      cmdId: id(),
      to: '@ana',
      amount: m('5.00'),
      channel: 'request',
      requestId: 'R-000001',
      expect: { senderDebit: m('5.05') },
    })
    expect(splitsOf(state(h), 'ana')[0]).toMatchObject({ paid: 1, count: 1, status: 'complete' })
  })
})

describe('the payments a bill can be split from', () => {
  it('Ana fresh: brunch, espresso and the pizza, newest first; no top-ups', () => {
    const h = fresh()
    const list = splitCandidates(state(h), 'ana')
    expect(list.map((t) => t.seedMeta?.key)).toEqual(['cafe-thu-brunch', 'cafe-tue-espresso', 'ana-pizza'])
  })

  it('at most ten; without payments that are split, refunded, a share of a split or a refund', () => {
    const h = fresh()
    const brunch = seedTx(h, 'cafe-thu-brunch')
    run(h, {
      type: 'split.create',
      actor: 'ana',
      cmdId: id('split'),
      sourceTxId: brunch.id,
      total: brunch.amount,
      note: 'Brunch',
      shares: [{ party: '@marko', amount: m('13.20') }],
    })
    expect(splitCandidates(state(h), 'ana').map((t) => t.seedMeta?.key)).toEqual(['cafe-tue-espresso', 'ana-pizza'])
    run(h, { type: 'refund', actor: 'cafe', cmdId: id('refund'), txId: seedTx(h, 'cafe-tue-espresso').id })
    h.node.settleDue()
    expect(splitCandidates(state(h), 'ana').map((t) => t.seedMeta?.key)).toEqual(['ana-pizza'])
    // Marko pays his share of Ana's split: that payment is a share, not a bill to split again.
    run(h, {
      type: 'pay',
      actor: 'marko',
      cmdId: id(),
      to: '@ana',
      amount: m('13.20'),
      channel: 'request',
      requestId: 'R-000001',
      expect: { senderDebit: m('13.33') },
    })
    expect(splitCandidates(state(h), 'marko').some((t) => t.links?.requestId === 'R-000001')).toBe(false)
    // Ten payments and no more.
    const many = fresh()
    for (let i = 0; i < 12; i++) {
      run(many, {
        type: 'pay',
        actor: 'ana',
        cmdId: id(),
        to: '@marko',
        amount: m('1.00'),
        channel: 'username',
        expect: { senderDebit: m('1.01') },
      })
      many.node.clock.advance(1000)
    }
    expect(splitCandidates(state(many), 'ana')).toHaveLength(10)
  })
})

describe('History: filters, search and groups (Ana from a fresh start)', () => {
  const rowsOf = (h: Headless, persona: string, opts: Parameters<typeof activity>[4]) =>
    activity(state(h), persona, h.node.now(), TZ, opts).flatMap((g) => g.rows.map((r) => r.tx.seedMeta?.key ?? r.tx.id))
  const statusOf = (h: Headless, persona: string, opts: Parameters<typeof activity>[4]) =>
    activity(state(h), persona, h.node.now(), TZ, opts).flatMap((g) =>
      g.status.map((r) => `${r.kind}:${r.id}:${r.status}`),
    )

  it('All: 7 payments and the Lunch request, waiting for Ana to pay', () => {
    const h = fresh()
    expect(rowsOf(h, 'ana', { filter: 'all' })).toHaveLength(7)
    expect(statusOf(h, 'ana', { filter: 'all' })).toEqual([])
    expect(statusOf(h, 'ana', { filter: 'all', status: true })).toEqual(['request:r_seed_lunch:open'])
  })

  it('Money in 4, Money out 3, Shops 2, People 3, Top-ups & cash-outs 2, Requests 1', () => {
    const h = fresh()
    const count = (filter: (typeof PEOPLE_FILTERS)[number]) => rowsOf(h, 'ana', { filter }).length
    expect([
      count('in'),
      count('out'),
      count('shops'),
      count('people'),
      count('topupsCashouts'),
      count('requests'),
    ]).toEqual([4, 3, 2, 3, 2, 0])
    expect(statusOf(h, 'ana', { filter: 'requests' })).toEqual(['request:r_seed_lunch:open'])
    expect(rowsOf(h, 'ana', { filter: 'shops' })).toEqual(['cafe-thu-brunch', 'cafe-tue-espresso'])
    expect(rowsOf(h, 'ana', { filter: 'people' })).toEqual(['concert-tickets', 'ana-pizza', 'taxi-share'])
    expect(rowsOf(h, 'ana', { filter: 'in' })).toEqual([
      'concert-tickets',
      'ana-topup-card',
      'taxi-share',
      'ana-topup-bank',
    ])
    expect(PEOPLE_FILTERS).toEqual(['all', 'in', 'out', 'shops', 'people', 'topupsCashouts', 'requests'])
  })

  it('the Requests chip lists every outcome, paid ones too; All hides a paid request (its payment is the row)', () => {
    const h = fresh()
    ask(h, 'ana', '@marko', '13.20')
    run(h, { type: 'request.decline', actor: 'marko', cmdId: id('decline'), requestId: 'R-000001' })
    ask(h, 'ana', '@marko', '5.00')
    run(h, {
      type: 'pay',
      actor: 'marko',
      cmdId: id(),
      to: '@ana',
      amount: m('5.00'),
      channel: 'request',
      requestId: 'R-000002',
      expect: { senderDebit: m('5.05') },
    })
    run(h, { type: 'link.create', actor: 'ana', cmdId: id('link'), amount: m('1.00') })
    expect(statusOf(h, 'ana', { filter: 'requests' }).sort()).toEqual([
      'link:L-000001:open',
      'request:R-000001:declined',
      'request:R-000002:paid',
      'request:r_seed_lunch:open',
    ])
    expect(statusOf(h, 'ana', { filter: 'all', status: true }).sort()).toEqual([
      'link:L-000001:open',
      'request:R-000001:declined',
      'request:r_seed_lunch:open',
    ])
    // Marko sees the requests made of him as to pay, and his own Lunch request as waiting.
    const marko = activity(state(h), 'marko', h.node.now(), TZ, { filter: 'requests' }).flatMap((g) => g.status)
    expect(marko.find((r) => r.id === 'r_seed_lunch')).toMatchObject({ direction: 'waiting', status: 'open' })
    expect(marko.find((r) => r.id === 'R-000001')).toMatchObject({ direction: 'to-pay', status: 'declined' })
  })

  it('search finds people, notes, items, references and amounts: "pizza" finds Pizza', () => {
    const h = fresh()
    expect(rowsOf(h, 'ana', { query: 'pizza' })).toEqual(['ana-pizza'])
    expect(rowsOf(h, 'ana', { query: ' PIZZA ' })).toEqual(['ana-pizza'])
    expect(rowsOf(h, 'ana', { query: 'cafe' })).toEqual(['cafe-thu-brunch', 'cafe-tue-espresso']) // "Café Lipa", accent-free
    expect(rowsOf(h, 'ana', { query: '@marko' })).toEqual(['concert-tickets', 'taxi-share'])
    expect(rowsOf(h, 'ana', { query: 'brunch' })).toEqual(['cafe-thu-brunch'])
    expect(rowsOf(h, 'ana', { query: '26.40' })).toEqual(['cafe-thu-brunch'])
    expect(rowsOf(h, 'ana', { query: seedTx(h, 'ana-pizza').id.toLowerCase() })).toEqual(['ana-pizza'])
    expect(rowsOf(h, 'ana', { query: 'zzz' })).toEqual([])
    expect(statusOf(h, 'ana', { filter: 'requests', query: 'lunch' })).toEqual(['request:r_seed_lunch:open'])
    expect(statusOf(h, 'ana', { filter: 'requests', query: 'pizza' })).toEqual([])
    // A filter and a search together.
    expect(rowsOf(h, 'ana', { filter: 'shops', query: 'espresso' })).toEqual(['cafe-tue-espresso'])
    expect(rowsOf(h, 'ana', { filter: 'in', query: 'pizza' })).toEqual([])
  })

  it('groups: Yesterday, This week (this Monday on) and Earlier; by day the default', () => {
    const h = fresh()
    const groups = activity(state(h), 'ana', h.node.now(), TZ, { grouping: 'period' })
    expect(groups.map((g) => [g.key, g.rows.map((r) => r.tx.seedMeta?.key)])).toEqual([
      ['yesterday', ['cafe-thu-brunch']],
      ['thisWeek', ['concert-tickets', 'cafe-tue-espresso', 'ana-topup-card']],
      ['earlier', ['ana-pizza', 'taxi-share', 'ana-topup-bank']],
    ])
    expect(activity(state(h), 'ana', h.node.now(), TZ).map((g) => g.key)).toEqual([
      'yesterday',
      '2026-09-23',
      '2026-09-22',
      '2026-09-21',
      '2026-09-20',
      '2026-09-19',
      '2026-08-26',
    ])
    // A payment today comes first; a status row today opens Today even without a payment.
    ask(h, 'ana', '@marko', '1.00')
    const withStatus = activity(state(h), 'ana', h.node.now(), TZ, { grouping: 'period', status: true })
    expect(withStatus[0]?.key).toBe('today')
    expect(withStatus[0]?.rows).toEqual([])
    expect(withStatus[0]?.status.map((r) => r.id)).toEqual(['R-000001', 'r_seed_lunch'])
  })

  it('the café: Sales, Refunds, Suppliers, Payouts, Top-ups', () => {
    const h = fresh()
    const count = (filter: (typeof CAFE_FILTERS)[number]) => rowsOf(h, 'cafe', { filter }).length
    expect(CAFE_FILTERS).toEqual(['all', 'sales', 'refunds', 'suppliers', 'payouts', 'topups'])
    expect([count('sales'), count('refunds'), count('suppliers'), count('payouts'), count('topups')]).toEqual([
      8, 0, 0, 6, 0,
    ])
    run(h, {
      type: 'pay',
      actor: 'cafe',
      cmdId: id(),
      to: '@pekarnazrno',
      amount: m('8.80'),
      channel: 'username',
      expect: { senderDebit: m('8.89') },
    })
    run(h, { type: 'refund', actor: 'cafe', cmdId: id('refund'), txId: seedTx(h, 'cafe-thu-brunch').id })
    run(h, { type: 'ramp.on', actor: 'cafe', cmdId: id('topup'), method: 'local-method', eur: 10 })
    expect([count('sales'), count('refunds'), count('suppliers'), count('payouts'), count('topups')]).toEqual([
      8, 1, 1, 6, 1,
    ])
    // A café has no request rows.
    expect(statusOf(h, 'cafe', { filter: 'all', status: true })).toEqual([])
  })

  it('a bank transfer on its way is a row of its own until it arrives, then the payment is the row', () => {
    const h = fresh()
    run(h, { type: 'ramp.on', actor: 'ana', cmdId: id('topup'), method: 'bank-transfer', eur: 50 })
    const rampRows = (
      persona: string,
      filter: (typeof PEOPLE_FILTERS)[number] | (typeof CAFE_FILTERS)[number],
      q = '',
    ) => activity(state(h), persona, h.node.now(), TZ, { filter, query: q }).flatMap((g) => g.ramps)
    for (const f of ['all', 'in', 'topupsCashouts'] as const)
      expect(
        rampRows('ana', f).map((r) => r.ramp.id),
        f,
      ).toEqual(['RP-000001'])
    for (const f of ['out', 'shops', 'people', 'requests'] as const) expect(rampRows('ana', f), f).toEqual([])
    const [today] = activity(state(h), 'ana', h.node.now(), TZ)
    expect(today?.key).toBe('today')
    const row = today?.ramps[0]
    expect(row && [money(row.signed), row.at, row.arrivesAt - row.at]).toEqual(['55.00', h.node.now(), 2 * 3_600_000])
    expect(rampRows('ana', 'all', 'bank')).toHaveLength(1)
    expect(rampRows('ana', 'all', '55.00')).toHaveLength(1)
    expect(rampRows('ana', 'all', 'pizza')).toEqual([])
    // Someone else's transfer is not Ana's row, and a transfer is no sale for the café's chips.
    expect(rampRows('marko', 'all')).toEqual([])
    run(h, { type: 'ramp.on', actor: 'cafe', cmdId: id('topup'), method: 'bank-transfer', eur: 10 })
    expect(rampRows('cafe', 'topups').map((r) => money(r.signed))).toEqual(['11.00'])
    expect(rampRows('cafe', 'sales')).toEqual([])
    // It arrives: the row goes and the payment takes its place.
    h.node.advanceTo(state(h).ramps['RP-000001']?.arrivesAt as SimTime, 'timer')
    h.node.settleDue()
    expect(rampRows('ana', 'all')).toEqual([])
    expect(rowsOf(h, 'ana', { filter: 'topupsCashouts' })).toHaveLength(3)
  })

  it('every chip has its label and the lists read as the screens show them', () => {
    const label = (f: (typeof PEOPLE_FILTERS)[number]) => content.copy.history.filters[f]
    expect(PEOPLE_FILTERS.map(label)).toEqual([
      'All',
      'Money in',
      'Money out',
      'Shops',
      'People',
      'Top-ups & cash-outs',
      'Requests',
    ])
    expect(CAFE_FILTERS.map(label)).toEqual(['All', 'Sales', 'Refunds', 'Supplier payments', 'Payouts', 'Top-ups'])
    expect(content.copy.history.searchPeople).toBe('Search people, shops, notes')
    expect(content.copy.history.searchBusiness).toBe('Search sales, customers, references')
  })

  it('a pending payment is a row too, and history keeps its per-day default for the screens that exist', () => {
    const h = fresh()
    run(h, {
      type: 'pay',
      actor: 'ana',
      cmdId: id(),
      to: '@marko',
      amount: m('16.50'),
      channel: 'username',
      expect: { senderDebit: m('16.67') },
    })
    const [today] = activity(state(h), 'ana', h.node.now(), TZ)
    expect(today?.key).toBe('today')
    expect(today?.rows[0]).toMatchObject({ pending: true, direction: 'out', signed: -1650 })
  })
})

describe('the sales dashboard', () => {
  const dash = (h: Headless, range: 'today' | '7d') => salesDashboard(state(h), 'cafe', range, h.node.now(), content)
  const figures = (d: ReturnType<typeof dash>) => [d.sales, money(d.gross), money(d.fees), money(d.net)]

  it('fresh: Today 23 · 111.38 · fees 1.11 · net 110.27; 7 days 180 · 1,221.22 · 12.20 · 1,209.02', () => {
    const h = fresh()
    expect(figures(dash(h, 'today'))).toEqual([23, '111.38', '1.11', '110.27'])
    expect(figures(dash(h, '7d'))).toEqual([180, '1,221.22', '12.20', '1,209.02'])
    expect(dash(h, 'today').refunds).toEqual({ count: 0, amount: 0 })
    expect(dash(h, 'today').rows.map((r) => [r.kind, r.count])).toEqual([['summary', 23]])
  })

  it('an 11.00 sale: Today 24 · 122.38 · 1.22 · 121.16, the live sale above the seeded row', () => {
    const h = fresh()
    const sale = elevenSale(h)
    const d = dash(h, 'today')
    expect(figures(d)).toEqual([24, '122.38', '1.22', '121.16'])
    expect(d.rows.map((r) => r.kind)).toEqual(['sale', 'summary'])
    expect(d.rows[0]).toMatchObject({ count: 1, refunded: false, payer: { handle: '@ana' }, tx: { id: sale.id } })
    expect(money(d.rows[0]?.net ?? 0)).toBe('10.89')
    expect(figures(dash(h, '7d'))).toEqual([181, '1,232.22', '12.31', '1,219.91'])
  })

  it('a refund shows as a "Refunds −11.00" line: gross stays, net after refunds drops', () => {
    const h = fresh()
    const sale = elevenSale(h)
    run(h, { type: 'refund', actor: 'cafe', cmdId: id('refund'), txId: sale.id })
    h.node.settleDue()
    const d = dash(h, 'today')
    expect(d.refunds).toEqual({ count: 1, amount: 1100 })
    expect(figures(d)).toEqual([24, '122.38', '1.22', '110.16'])
    expect(money(d.received)).toBe('121.16')
    expect(d.rows[0]?.refunded).toBe(true)
  })

  it('a sale the customer pays the fee on: the café receives the full price, no fee of its own', () => {
    const h = fresh()
    run(h, { type: 'merchant.settings', actor: 'cafe', cmdId: id(), patch: { feePayer: 'sender' } })
    run(h, {
      type: 'pay',
      actor: 'ana',
      cmdId: id(),
      to: '@cafelipa',
      amount: m('13.20'),
      channel: 'qr',
      expect: { senderDebit: m('13.33') },
    })
    h.node.settleDue()
    const d = dash(h, 'today')
    expect(figures(d)).toEqual([24, '124.58', '1.11', '123.47'])
    expect(d.rows[0]?.fee).toBe(13)
    expect(money(d.rows[0]?.net ?? 0)).toBe('13.20')
  })

  it('the chart: seven days Saturday to Friday, Sunday closed, today last', () => {
    const h = fresh()
    const days = dash(h, '7d').days
    expect(days.map((d) => d.date)).toEqual([
      '2026-09-19',
      '2026-09-20',
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
    ])
    expect(days.map((d) => d.weekday)).toEqual([6, 0, 1, 2, 3, 4, 5])
    expect(days.map((d) => d.closed)).toEqual([false, true, false, false, false, false, false])
    expect(days.map((d) => d.today)).toEqual([false, false, false, false, false, false, true])
    expect(days.map((d) => d.count)).toEqual([48, 0, 26, 22, 19, 42, 23])
    expect(days.map((d) => money(d.gross))).toEqual([
      '334.58',
      '0.00',
      '179.16',
      '145.22',
      '141.08',
      '309.80',
      '111.38',
    ])
    // The chart is the same on Today.
    expect(dash(h, 'today').days).toEqual(days)
  })

  it('who pays the fee: on an 11.00 sale the customer pays 11.00 and the café receives 10.89, or 11.11 and 11.00', () => {
    const h = fresh()
    const e = feePayerExamples(state(h), m('11.00'))
    const line = (x: (typeof e)['recipient']) => [money(x.customerPays), money(x.merchantReceives), money(x.fee)]
    expect(line(e.recipient)).toEqual(['11.00', '10.89', '0.11'])
    expect(line(e.sender)).toEqual(['11.11', '11.00', '0.11'])
    // Round half up, no minimum: below 0.50 there is no fee.
    expect(line(feePayerExamples(state(h), m('0.49')).sender)).toEqual(['0.49', '0.49', '0.00'])
    expect(line(feePayerExamples(state(h), m('13.20')).sender)).toEqual(['13.33', '13.20', '0.13'])
  })

  it('the studio sells every day: no closed day on its chart', () => {
    const h = fresh()
    const d = salesDashboard(state(h), 'studio', '7d', h.node.now(), content)
    expect(d.days.map((x) => x.closed)).toEqual(Array(7).fill(false))
    expect(d.sales).toBeGreaterThan(0)
  })

  it('a sale asked for and not yet settled is not counted', () => {
    const h = fresh()
    run(h, {
      type: 'pay',
      actor: 'ana',
      cmdId: id(),
      to: '@cafelipa',
      amount: m('11.00'),
      channel: 'qr',
      expect: { senderDebit: m('11.00') },
    })
    expect(dash(h, 'today').sales).toBe(23)
  })

  it("the day changes: yesterday's sales leave Today and the range moves on", () => {
    const h = fresh()
    h.node.advanceTo(resolveLocal('2026-09-26', '09:00', TZ), 'timer')
    expect(figures(dash(h, 'today'))).toEqual([0, '0.00', '0.00', '0.00'])
    const week = dash(h, '7d')
    expect(week.from).toBe('2026-09-20')
    expect(week.sales).toBe(180 - 48)
  })
})

describe('refundable sales', () => {
  it('fresh: the Brunch (Thursday) then the Espresso (Tuesday); no summary rows; each once', () => {
    const h = fresh()
    const list = refundableSales(state(h), 'cafe')
    expect(list.map((t) => t.seedMeta?.key)).toEqual(['cafe-thu-brunch', 'cafe-tue-espresso'])
    run(h, { type: 'refund', actor: 'cafe', cmdId: id('refund'), txId: list[0]?.id ?? '' })
    h.node.settleDue()
    expect(refundableSales(state(h), 'cafe').map((t) => t.seedMeta?.key)).toEqual(['cafe-tue-espresso'])
    const sale = elevenSale(h)
    expect(refundableSales(state(h), 'cafe').map((t) => t.id)[0]).toBe(sale.id)
    expect(refundableSales(state(h), 'ana')).toEqual([])
  })

  it('the studio: named sales of the day (off-stage buyers included), not the daily rows', () => {
    const h = fresh()
    const keys = refundableSales(state(h), 'studio').map((t) => t.seedMeta?.key)
    expect(keys).toContain('studio-luka-gems')
    expect(keys).toContain('studio-tue-skin')
    expect(keys).not.toContain('studio-thu')
  })

  it('a named subscription charge is refundable too, and the payment detail agrees with the list', () => {
    const h = fresh()
    const charge = seedTx(h, 'studio-renewal-eva')
    expect(charge.kind).toBe('subscription-charge')
    expect(refundableSales(state(h), 'studio').map((t) => t.id)).toContain(charge.id)
    expect(txDetail(state(h), charge.id, 'studio', content)?.refundState).toBe('refundable')
    // Everything the list offers reads as refundable in the detail, and nothing else does.
    for (const merchant of ['cafe', 'studio']) {
      const offered = new Set(refundableSales(state(h), merchant).map((t) => t.id))
      for (const t of Object.values(state(h).txs)) {
        const detail = txDetail(state(h), t.id, merchant, content)
        if (detail?.refundState === 'refundable') expect(offered.has(t.id), `${merchant} ${t.id}`).toBe(true)
      }
      expect(offered.size).toBeGreaterThan(0)
    }
  })
})

describe('payouts', () => {
  it('fresh café: six payouts, 1,020.61 BCPS converted, conversion 15.32, ≈ €913.89', () => {
    const h = fresh()
    const p = payoutsOf(state(h), 'cafe', h.node.now(), TZ)
    expect(p.rows).toHaveLength(6)
    expect(p.week).toMatchObject({ count: 6, from: '2026-09-19', to: '2026-09-25' })
    expect([money(p.week.amount), money(p.week.fee), money(p.week.eur)]).toEqual(['1,020.61', '15.32', '913.89'])
    expect(p.rows.map((r) => [money(r.amount), money(r.eur), r.auto, r.sharePct])).toEqual([
      ['175.73', '157.35', true, 50],
      ['44.75', '40.07', true, 50],
      ['220.00', '197.00', false, undefined],
      ['169.83', '152.07', true, 50],
      ['195.89', '175.41', true, 50],
      ['214.41', '191.99', true, 50],
    ])
  })

  it('a cash-out now is the newest row and joins the week', () => {
    const h = fresh()
    run(h, { type: 'ramp.off', actor: 'cafe', cmdId: id('cashout'), amount: m('110.00') })
    h.node.settleDue()
    const p = payoutsOf(state(h), 'cafe', h.node.now(), TZ)
    expect(p.rows[0]).toMatchObject({ auto: false, amount: 11000, fee: 165, eur: 9850 })
    expect(p.week.count).toBe(7)
    expect(money(p.week.amount)).toBe('1,130.61')
    expect(money(p.week.eur)).toBe('1,012.39')
  })

  it('the studio has one payout; a person cashing out has their own; the bakery none', () => {
    const h = fresh()
    expect(payoutsOf(state(h), 'studio', h.node.now(), TZ).rows).toHaveLength(1)
    expect(payoutsOf(state(h), 'ana', h.node.now(), TZ).rows).toEqual([])
    expect(payoutsOf(state(h), 'bakery', h.node.now(), TZ).week.count).toBe(0)
  })
})

describe('the day summary', () => {
  it("Saturday: 48 sales, gross 334.58, fees 3.35, net 331.23, first sale 07:38, busiest hour 12:00, the day's conversion", () => {
    const h = fresh()
    const d = daySummary(state(h), 'cafe-sat', TZ)
    if (!d) throw new Error('no day summary')
    expect([d.count, money(d.gross), money(d.fees), money(d.net), d.date]).toEqual([
      48,
      '334.58',
      '3.35',
      '331.23',
      '2026-09-19',
    ])
    expect(d.firstSale?.party?.displayName).toBe('Marta K.')
    expect(d.firstSale?.sku).toBe('flat-white')
    expect(formatTime(d.firstSale?.at as SimTime, TZ)).toBe('07:38')
    expect(formatTime(d.busiest?.from as SimTime, TZ)).toBe('12:00')
    expect(d.busiest?.count).toBe(9)
    expect(d.conversions.map((t) => t.seedMeta?.key)).toEqual(['cafe-autoconvert-sat'])
  })

  it("Wednesday has a cash-out and a conversion; today's row has none yet; other rows have no summary", () => {
    const h = fresh()
    expect(daySummary(state(h), 'cafe-wed', TZ)?.conversions.map((t) => t.seedMeta?.key)).toEqual([
      'cafe-cashout-wed',
      'cafe-autoconvert-wed',
    ])
    const today = daySummary(state(h), 'cafe-today', TZ)
    expect([today?.count, money(today?.net ?? 0)]).toEqual([23, '110.27'])
    expect(today?.conversions).toEqual([])
    expect(daySummary(state(h), 'cafe-thu-brunch', TZ)).toBeUndefined()
    expect(daySummary(state(h), 'nothing', TZ)).toBeUndefined()
  })

  it('the studio has no day fields: the summary is there without a first sale or busiest hour', () => {
    const h = fresh()
    const d = daySummary(state(h), 'studio-thu', TZ)
    expect(d?.count).toBe(27)
    expect(d?.firstSale).toBeUndefined()
    expect(d?.busiest).toBeUndefined()
  })
})

describe('the sales CSV', () => {
  it('a cell that would run as a formula gets an apostrophe; every cell is quoted; quotes are doubled', () => {
    expect(csvCell('@ana')).toBe('"\'@ana"')
    expect(csvCell('=SUM(1)')).toBe('"\'=SUM(1)"')
    expect(csvCell('+1')).toBe('"\'+1"')
    expect(csvCell('-2')).toBe('"\'-2"')
    expect(csvCell('plain')).toBe('"plain"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('')).toBe('""')
    expect(csvCell('a=b')).toBe('"a=b"')
  })

  it('Today: header, then the seeded row and the sale, oldest first, amounts without grouping', () => {
    const h = fresh()
    const sale = elevenSale(h)
    const d = salesDashboard(state(h), 'cafe', 'today', h.node.now(), content)
    const text = salesCsv(d.rows, content, TZ)
    const lines = text.trimEnd().split('\n')
    expect(lines[0]).toBe('date,time,reference,payer,items,gross,fee,net')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toBe(
      `"2026-09-25","12:10","${seedTx(h, 'cafe-today').id}","","Today so far · 23 payments","111.38","1.11","110.27"`,
    )
    expect(lines[2]).toBe(
      `"2026-09-25","12:15","${sale.id}","'@ana","2 × Flat white, 2 × Croissant","11.00","0.11","10.89"`,
    )
    expect(text.endsWith('\n')).toBe(true)
  })

  it('7 days: a line for each of the days and each named sale; large figures have no comma', () => {
    const h = fresh()
    const d = salesDashboard(state(h), 'cafe', '7d', h.node.now(), content)
    const lines = salesCsv(d.rows, content, TZ).trimEnd().split('\n')
    expect(lines).toHaveLength(1 + 8)
    expect(lines.some((l) => l.includes('"334.58","3.35","331.23"'))).toBe(true)
    expect(lines.some((l) => l.includes(',') && /"\d{1,3},\d{3}\.\d\d"/.test(l))).toBe(false)
    // Oldest first: Saturday's summary comes first.
    expect(lines[1]).toContain('"2026-09-19"')
  })

  it('a note that starts like a formula is neutralised', () => {
    const h = fresh()
    run(h, {
      type: 'pay',
      actor: 'ana',
      cmdId: id(),
      to: '@cafelipa',
      amount: m('3.30'),
      channel: 'qr',
      note: '=1+1',
      expect: { senderDebit: m('3.30') },
    })
    h.node.settleDue()
    const d = salesDashboard(state(h), 'cafe', 'today', h.node.now(), content)
    expect(salesCsv(d.rows, content, TZ)).toContain('"\'=1+1"')
  })

  it('the file is named for the business and the day: cafe-lipa-sales-2026-09-25.csv', () => {
    const h = fresh()
    const d = salesDashboard(state(h), 'cafe', 'today', h.node.now(), content)
    const file = salesCsvFile(state(h), 'cafe', d.rows, h.node.now(), content)
    expect(file.fileName).toBe('cafe-lipa-sales-2026-09-25.csv')
    expect(file.text).toBe(salesCsv(d.rows, content, TZ))
    expect(salesCsvFile(state(h), 'studio', [], h.node.now(), content).fileName).toBe(
      'lintvern-games-sales-2026-09-25.csv',
    )
    // A day summary's export is named for that day, not for today.
    const saturday = seedTx(h, 'cafe-sat')
    expect(salesCsvFile(state(h), 'cafe', [], saturday.createdAt, content).fileName).toBe(
      'cafe-lipa-sales-2026-09-19.csv',
    )
  })
})

describe('what Scan can lock onto', () => {
  const codeIn = (h: Headless, merchant = 'cafe') =>
    run(h, {
      type: 'request.create',
      actor: merchant,
      cmdId: id('items'),
      channel: 'pos',
      amount: m('11.00'),
      note: 'Table 4',
    })
  const opts = { counterMerchants: counterMerchants(content) }

  it('the merchants with a counter code are the tills: the café', () => {
    expect(counterMerchants(content)).toEqual(['cafe'])
  })

  it("phone mode: the café's open code first, then the counter code; never one's own", () => {
    const h = fresh()
    codeIn(h)
    const now = h.node.now()
    const list = scanCandidates(state(h), 'ana', null, now, VALIDITY, opts)
    expect(list.map((c) => c.kind)).toEqual(['pos', 'counter'])
    expect(list[0]).toMatchObject({ merchant: 'cafe', amount: 1100, note: 'Table 4' })
    expect(list[1]).toEqual({ kind: 'counter', merchant: 'cafe' })
    // Without an open code the counter is all there is; the café itself sees neither.
    const idle = fresh()
    expect(scanCandidates(state(idle), 'ana', null, idle.node.now(), VALIDITY, opts).map((c) => c.kind)).toEqual([
      'counter',
    ])
    expect(scanCandidates(state(h), 'cafe', null, now, VALIDITY, opts)).toEqual([])
    // A code that ran out is gone.
    expect(
      scanCandidates(state(h), 'ana', null, (now + VALIDITY) as SimTime, VALIDITY, opts).map((c) => c.kind),
    ).toEqual(['counter'])
  })

  it('on the stage: only what the phone next to it shows; no counter code, no strangers', () => {
    const h = fresh()
    codeIn(h)
    const now = h.node.now()
    expect(scanCandidates(state(h), 'ana', 'cafe', now, VALIDITY, opts).map((c) => c.kind)).toEqual(['pos'])
    expect(scanCandidates(state(h), 'ana', 'marko', now, VALIDITY, opts)).toEqual([])
    const shown: ShownQr[] = [{ persona: 'marko', kind: 'code', at: now }]
    expect(scanCandidates(state(h), 'ana', 'marko', now, VALIDITY, { ...opts, shown }).map((c) => c.kind)).toEqual([
      'person',
    ])
    expect(scanCandidates(state(h), 'ana', 'cafe', now, VALIDITY, { ...opts, shown }).map((c) => c.kind)).toEqual([
      'pos',
    ])
  })

  it("a QR shown in the last ten minutes: Marko's code and Ana's link, newest first, never the viewer's own", () => {
    const h = fresh()
    run(h, { type: 'link.create', actor: 'marko', cmdId: id('link'), amount: m('7.00'), note: 'Tickets' })
    const t0 = h.node.now()
    let shown: ShownQr[] = []
    shown = noteShownQr(shown, { persona: 'marko', kind: 'code', at: t0 })
    shown = noteShownQr(shown, { persona: 'marko', kind: 'link', linkId: 'L-000001', at: (t0 + 60_000) as SimTime })
    shown = noteShownQr(shown, { persona: 'ana', kind: 'code', at: (t0 + 90_000) as SimTime })
    const at = (t0 + 120_000) as SimTime
    const list = scanCandidates(state(h), 'ana', null, at, VALIDITY, { ...opts, shown })
    expect(list.map((c) => c.kind)).toEqual(['link', 'person', 'counter'])
    expect(list[0]).toMatchObject({ linkId: 'L-000001', owner: 'marko', amount: 700, note: 'Tickets' })
    expect(list[1]).toMatchObject({ persona: 'marko', handle: '@marko' })
    // Marko himself is offered Ana's code, not his own.
    expect(scanCandidates(state(h), 'marko', null, at, VALIDITY, { ...opts, shown }).map((c) => c.kind)).toEqual([
      'person',
      'counter',
    ])
    // After ten minutes they are gone; a link that was paid is gone at once.
    const late = (t0 + SHOWN_QR_WINDOW_MS + 61_000) as SimTime
    expect(scanCandidates(state(h), 'ana', null, late, VALIDITY, { ...opts, shown }).map((c) => c.kind)).toEqual([
      'counter',
    ])
    run(h, {
      type: 'pay',
      actor: 'ana',
      cmdId: id(),
      to: '@marko',
      amount: m('7.00'),
      channel: 'link',
      linkId: 'L-000001',
      expect: { senderDebit: m('7.07') },
    })
    expect(
      scanCandidates(state(h), 'ana', null, (h.node.now() + 1000) as SimTime, VALIDITY, { ...opts, shown }).map(
        (c) => c.kind,
      ),
    ).toEqual(['person', 'counter'])
  })

  it('noting a QR again only refreshes it; entries older than the window drop out; a business shows no personal code', () => {
    const t0 = 1_000_000 as SimTime
    let shown = noteShownQr([], { persona: 'marko', kind: 'code', at: t0 })
    shown = noteShownQr(shown, { persona: 'marko', kind: 'code', at: (t0 + 5000) as SimTime })
    expect(shown).toHaveLength(1)
    expect(shown[0]?.at).toBe(t0 + 5000)
    shown = noteShownQr(shown, { persona: 'ana', kind: 'code', at: (t0 + SHOWN_QR_WINDOW_MS + 10_000) as SimTime })
    expect(shown.map((x) => x.persona)).toEqual(['ana'])
    const h = fresh()
    const business: ShownQr[] = [{ persona: 'firm', kind: 'code', at: h.node.now() }]
    expect(scanCandidates(state(h), 'ana', null, h.node.now(), VALIDITY, { shown: business })).toEqual([])
  })
})

describe('money in and out', () => {
  it('a shortfall in euros: 5.86 BCPS short is €6; €1 at least; never above the limit', () => {
    const h = fresh()
    expect(topUpForShortfall(state(h), 'ana', m('5.86'))).toBe(6)
    expect(topUpForShortfall(state(h), 'ana', m('0.01'))).toBe(1)
    expect(topUpForShortfall(state(h), 'ana', m('11.00'))).toBe(10)
    expect(topUpForShortfall(state(h), 'ana', m('11.01'))).toBe(11)
    expect(topUpForShortfall(state(h), 'ana', m('50000.00'))).toBe(10_000)
    expect(topUpForShortfall(state(h), 'firm', m('50000.00'))).toBe(45_455)
  })

  it('€50 gives 55.00 BCPS', () => {
    const h = fresh()
    expect(money(topUpAmount(state(h), 50))).toBe('55.00')
    expect(money(topUpAmount(state(h), 1))).toBe('1.10')
  })

  it('a cash-out: 110.00 costs 1.65 for ≈ €98.50; 1.10 costs 0.02 for ≈ €0.98; below 1.10 is not offered', () => {
    const h = fresh()
    const q = quoteCashOut(state(h), m('110.00'))
    expect([q?.fee, q?.eurOut]).toEqual([165, 9850])
    const min = quoteCashOut(state(h), m('1.10'))
    expect([min?.fee, min?.eurOut]).toEqual([2, 98])
    expect(quoteCashOut(state(h), m('1.09'))).toBeNull()
    expect(quoteCashOut(state(h), 0 as Minor)).toBeNull()
  })

  it('the ways to top up: a card if there is one, the bank transfer, a local method always', () => {
    const h = fresh()
    const methods = (persona: string) => topUpMethods(state(h), persona, content)
    expect(methods('ana')).toEqual([
      { method: 'card', last4: '7719' },
      { method: 'bank-transfer', bank: 'SI56 •••• •••• 4821' },
      { method: 'local-method' },
    ])
    // The café has bank and local only; the bakery has no bank to send from.
    expect(methods('cafe')).toEqual([
      { method: 'bank-transfer', bank: 'SI56 •••• •••• 1934' },
      { method: 'local-method' },
    ])
    expect(methods('bakery').map((x) => x.method)).toEqual(['local-method'])
    expect(bankOf(content, 'cafe')).toBe('SI56 •••• •••• 1934')
    expect(bankOf(content, 'bakery')).toBeUndefined()
  })

  it('a flow finds its top-up or cash-out by its command, also while a bank transfer has no payment', () => {
    const h = fresh()
    const bank = id('topup')
    const card = id('topup')
    const out = id('cashout')
    run(h, { type: 'ramp.on', actor: 'ana', cmdId: bank, method: 'bank-transfer', eur: 50 })
    run(h, { type: 'ramp.on', actor: 'ana', cmdId: card, method: 'card', eur: 10 })
    run(h, { type: 'ramp.off', actor: 'ana', cmdId: out, amount: m('1.10') })
    expect(rampByCmdId(state(h), bank)).toMatchObject({ id: 'RP-000001', status: 'pending', direction: 'on' })
    expect(rampByCmdId(state(h), bank)?.txId).toBeUndefined()
    expect(rampByCmdId(state(h), card)).toMatchObject({ id: 'RP-000002', status: 'completed', method: 'card' })
    expect(rampByCmdId(state(h), out)).toMatchObject({ id: 'RP-000003', direction: 'off' })
    expect(rampByCmdId(state(h), 'nope:topup')).toBeUndefined()
  })

  it('Max is what is available; locked money is not there; a bank on file is needed', () => {
    const h = fresh()
    expect(money(maxCashOut(state(h), 'ana'))).toBe('247.50')
    run(h, { type: 'ramp.off', actor: 'ana', cmdId: id('cashout'), amount: m('100.00') })
    expect(money(maxCashOut(state(h), 'ana'))).toBe('147.50') // what is on its way out is not available
    expect(hasBank(state(h), 'ana')).toBe(true)
    expect(hasBank(state(h), 'bakery')).toBe(false)
  })

  it('auto-convert: "Next: tonight 23:00 · ≈ 143.00 BCPS → ≈ €128.05"; after a sale and the bakery 144.00 → ≈ €128.95', () => {
    const h = fresh()
    const cafe = state(h).merchant.cafe
    if (!cafe) throw new Error('no settings')
    const p = autoConvertPreview(state(h), 'cafe', cafe.autoConvert, h.node.now(), TZ)
    expect([money(p?.amount ?? 0), money(p?.fee ?? 0), money(p?.eur ?? 0)]).toEqual(['143.00', '2.15', '128.05'])
    expect(p?.at).toBe(resolveLocal('2026-09-25', '23:00', TZ))
    elevenSale(h)
    run(h, {
      type: 'pay',
      actor: 'cafe',
      cmdId: id(),
      to: '@pekarnazrno',
      amount: m('8.80'),
      channel: 'username',
      expect: { senderDebit: m('8.89') },
    })
    h.node.settleDue()
    const after = autoConvertPreview(state(h), 'cafe', cafe.autoConvert, h.node.now(), TZ)
    expect([money(after?.amount ?? 0), money(after?.fee ?? 0), money(after?.eur ?? 0)]).toEqual([
      '144.00',
      '2.16',
      '128.95',
    ])
    // 30 % at 22:00.
    const thirty = { ...cafe.autoConvert, sharePct: 30, atLocal: '22:00' as const }
    const q = autoConvertPreview(state(h), 'cafe', thirty, h.node.now(), TZ)
    expect(money(q?.amount ?? 0)).toBe('86.40')
    expect(q?.at).toBe(resolveLocal('2026-09-25', '22:00', TZ))
  })

  it('the next run follows the schedule: every day, weekdays, weekly; today when its time is still ahead', () => {
    const h = fresh() // Friday 12:15
    const base = state(h).merchant.cafe?.autoConvert
    if (!base) throw new Error('no settings')
    const at = (settings: typeof base) => {
      const t = nextAutoConvert(settings, h.node.now(), TZ)
      return `${localDateOf(t, TZ)} ${formatTime(t, TZ)}`
    }
    expect(at(base)).toBe('2026-09-25 23:00')
    expect(at({ ...base, atLocal: '18:00' })).toBe('2026-09-25 18:00')
    expect(at({ ...base, schedule: 'weekly', weekdays: [1] })).toBe('2026-09-28 23:00')
    expect(at({ ...base, schedule: 'weekdays', weekdays: [1, 2, 3, 4, 5] })).toBe('2026-09-25 23:00')
    h.node.advanceTo(resolveLocal('2026-09-25', '23:30', TZ), 'timer')
    expect(at({ ...base, schedule: 'weekdays', weekdays: [1, 2, 3, 4, 5] })).toBe('2026-09-28 23:00')
    expect(at(base)).toBe('2026-09-26 23:00')
  })

  it('a share too small to convert has no preview', () => {
    const h = fresh()
    const base = state(h).merchant.cafe?.autoConvert
    if (!base) throw new Error('no settings')
    run(h, { type: 'ramp.off', actor: 'cafe', cmdId: id('cashout'), amount: m('285.00') })
    h.node.settleDue()
    expect(autoConvertPreview(state(h), 'cafe', base, h.node.now(), TZ)).toBeNull() // 50 % of 1.00
  })
})

describe('the payment detail', () => {
  it('a sale the café received: refundable, then refunded with its refund; the customer sees Split this bill', () => {
    const h = fresh()
    const brunch = seedTx(h, 'cafe-thu-brunch')
    const cafe = txDetail(state(h), brunch.id, 'cafe', content)
    expect(cafe).toMatchObject({ refundState: 'refundable', splittable: false, refund: undefined })
    const ana = txDetail(state(h), brunch.id, 'ana', content)
    expect(ana).toMatchObject({ refundState: 'no', splittable: true, split: undefined })
    run(h, { type: 'refund', actor: 'cafe', cmdId: id('refund'), txId: brunch.id })
    h.node.settleDue()
    const after = txDetail(state(h), brunch.id, 'cafe', content)
    expect(after?.refundState).toBe('refunded')
    expect(after?.refund?.kind).toBe('refund')
    expect(txDetail(state(h), brunch.id, 'ana', content)?.splittable).toBe(false)
    const refund = txDetail(state(h), after?.refund?.id ?? '', 'ana', content)
    expect(refund?.refundOf?.id).toBe(brunch.id)
    expect(refund).toMatchObject({ refundState: 'no', splittable: false })
  })

  it("a split payment opens its split; summary rows and other people's payments offer nothing", () => {
    const h = fresh()
    const brunch = seedTx(h, 'cafe-thu-brunch')
    run(h, {
      type: 'split.create',
      actor: 'ana',
      cmdId: id('split'),
      sourceTxId: brunch.id,
      total: brunch.amount,
      note: 'Brunch',
      shares: [{ party: '@marko', amount: m('13.20') }],
    })
    const d = txDetail(state(h), brunch.id, 'ana', content)
    expect(d).toMatchObject({ splittable: false, split: { id: 'S-000001' } })
    expect(txDetail(state(h), seedTx(h, 'cafe-thu').id, 'cafe', content)).toMatchObject({ refundState: 'no' })
    expect(txDetail(state(h), brunch.id, 'marko', content)).toMatchObject({ refundState: 'no', splittable: false })
  })

  it('a payment of a request shows the request; of a link, the link', () => {
    const h = fresh()
    run(h, {
      type: 'request.create',
      actor: 'ana',
      cmdId: id('request'),
      channel: 'username',
      payer: '@marko',
      amount: m('13.20'),
      note: 'Lunch',
    })
    run(h, {
      type: 'pay',
      actor: 'marko',
      cmdId: id(),
      to: '@ana',
      amount: m('13.20'),
      channel: 'request',
      requestId: 'R-000001',
      expect: { senderDebit: m('13.33') },
    })
    const tx = Object.values(state(h).txs).find((t) => t.links?.requestId === 'R-000001') as Tx
    expect(txDetail(state(h), tx.id, 'ana', content)?.request?.id).toBe('R-000001')
    run(h, { type: 'link.create', actor: 'ana', cmdId: id('link'), amount: m('2.00') })
    run(h, {
      type: 'pay',
      actor: 'marko',
      cmdId: id(),
      to: '@ana',
      amount: m('2.00'),
      channel: 'link',
      linkId: 'L-000001',
      expect: { senderDebit: m('2.02') },
    })
    const linked = Object.values(state(h).txs).find((t) => t.links?.linkId === 'L-000001') as Tx
    expect(txDetail(state(h), linked.id, 'marko', content)?.link?.id).toBe('L-000001')
  })
})
