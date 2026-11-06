// Golden journey refunds-fee-payer: refunds, the choice of who pays the fee, the sales figures and the
// counter code. The composite journey ends on its balances at the three epochs; the values of the
// acceptance list (refunding the Brunch, the sales after a sale and a refund, the customer paying the
// fee, a stale counter-code review, the counter code in phone mode, the café's invoice) are proved on
// their own from the start.
import { describe, expect, it } from 'vitest'
import { invariants } from '@domain/invariants'
import { formatHundredths } from '@domain/money'
import type { LedgerEvent, Tx, UserCommand } from '@domain/types'
import { resolveItems } from '@sim/seed'
import {
  activity,
  badges,
  counterMerchants,
  invoices,
  quoteFor,
  quoteForRequest,
  refundableSales,
  salesDashboard,
  scanCandidates,
  txDetail,
} from '@store/selectors'
import { EPOCHS, bal, describeGolden } from '../support/golden'
import { type Headless, headless } from '../support/journey'
import { content, m } from '../unit/helpers'
import { refundsFeePayer } from './journeys/refunds-fee-payer'
import { seedTxId } from './journeys/send-request-split'

describeGolden({
  name: 'refunds-fee-payer',
  journey: refundsFeePayer,
  // Ana: 247.50 − 11.00 + 11.00 + 26.40 − 13.33 − 11.11 − 3.33 − 5.05; Marko: 132.98 + 5.00.
  // Café: 286.00 + 10.89 − 11.00 − 26.40 + 13.20 + 11.00 + 3.30.
  end: { ana: '241.08', marko: '137.98', cafe: '286.99' },
  // The first sale 0.11 (the refund does not return it), then 0.13, 0.11, 0.03 and 0.05.
  fees: '0.43',
  check: (h) => {
    const s = h.node.getState()
    const refunds = Object.values(s.txs).filter((t) => t.kind === 'refund')
    expect(refunds.map((t) => [t.from, t.to, formatHundredths(t.amount), t.fee.fee])).toEqual([
      ['cafe', 'ana', '11.00', 0],
      ['cafe', 'ana', '26.40', 0],
    ])
    expect(refunds.every((t) => s.txs[t.links?.refundOf ?? '']?.refundedBy === t.id)).toBe(true)
    // Each code kept the payer it was made with, although the setting changed twice.
    expect(['R-000001', 'R-000002', 'R-000003'].map((id) => s.requests[id]?.feePayer)).toEqual([
      'sender',
      'sender',
      'sender',
    ])
    expect(s.merchant.cafe).toMatchObject({
      feePayer: 'recipient',
      autoConvert: { enabled: true, schedule: 'daily', atLocal: '22:00', sharePct: 30 },
    })
    // Nothing converted by itself, not at 22:00 and not at 23:00 (the last entry is at 23:30).
    expect(Object.values(s.txs).filter((t) => !t.seed && t.kind === 'off-ramp')).toEqual([])
    expect(invariants(s)).toEqual([])
  },
})

describe.each(EPOCHS)('the acceptance values of refunds and fees, from the start at T0 = %s', (epoch) => {
  let n = 0
  const cmd = (step = 'review') => `${(0xc00 + ++n).toString(16).padStart(16, '0')}:${step}`
  const run = (h: Headless, c: UserCommand): LedgerEvent[] => {
    const r = h.node.dispatch(c)
    if (!r.ok) throw new Error(`refused ${r.error.code}`)
    return r.value
  }
  const txOf = (events: LedgerEvent[]): Tx => (events.find((e) => e.type === 'tx.submitted') as { tx: Tx }).tx
  const refund = (txId: string): UserCommand => ({ type: 'refund', actor: 'cafe', cmdId: cmd('refund'), txId })
  const items11 = () =>
    resolveItems(content, 'cafe', [
      { sku: 'flat-white', qty: 2 },
      { sku: 'croissant', qty: 2 },
    ])
  const sell = (h: Headless): Tx => {
    const tx = txOf(
      run(h, {
        type: 'pay',
        actor: 'ana',
        cmdId: cmd(),
        to: '@cafelipa',
        amount: m('11.00'),
        channel: 'qr',
        items: items11(),
        expect: { senderDebit: m('11.00') },
      }),
    )
    h.node.settleDue()
    return tx
  }
  const brunchId = seedTxId(content, 'cafe-thu-brunch')
  const figures = (h: Headless, range: 'today' | '7d') => {
    const d = salesDashboard(h.node.getState(), 'cafe', range, h.node.now(), content)
    return [d.sales, formatHundredths(d.gross), formatHundredths(d.fees), formatHundredths(d.net)]
  }

  it('the café refunds the Brunch: café 259.60, Ana 273.90, no fee; the sale reads "Refunded ✓"', () => {
    const h = headless(epoch)
    expect(refundableSales(h.node.getState(), 'cafe').map((t) => [t.note ?? t.items?.[0]?.name, t.id])[0]).toEqual([
      'Brunch for two',
      brunchId,
    ])
    const refundTx = txOf(run(h, refund(brunchId)))
    expect(refundTx).toMatchObject({ kind: 'refund', from: 'cafe', to: 'ana', amount: m('26.40') })
    expect(refundTx.fee.fee).toBe(0)
    h.node.settleDue()
    const s = h.node.getState()
    expect([bal(s, 'cafe'), bal(s, 'ana')]).toEqual(['259.60', '273.90'])
    // The fee of the sale stays where it was: the network gained nothing and returned nothing.
    expect(s.balances['sys:fees']?.confirmed).toBe(h.node.seedState().balances['sys:fees']?.confirmed)
    // Ana's History has the refund; the original shows Refunded ✓; the café's detail offers no second refund.
    const row = activity(s, 'ana', h.node.now(), 'Europe/Ljubljana', { filter: 'shops' })
      .flatMap((g) => g.rows)
      .find((r) => r.tx.kind === 'refund')
    expect(row).toMatchObject({ direction: 'in', signed: m('26.40') })
    expect(txDetail(s, brunchId, 'cafe', content)?.refundState).toBe('refunded')
    expect(txDetail(s, brunchId, 'ana', content)?.refund?.id).toBe(refundTx.id)
    // A second attempt: "Refunded ✓ · {time}".
    expect(h.node.dispatch(refund(brunchId))).toEqual({ ok: false, error: { code: 'already-refunded' } })
    // Summary rows have no refund.
    expect(h.node.dispatch(refund(seedTxId(content, 'cafe-today')))).toEqual({
      ok: false,
      error: { code: 'invalid-state' },
    })
    expect(invariants(s)).toEqual([])
  })

  it('sales: Today 23 · 111.38 · 1.11 · 110.27 and 7 days 180 · 1,221.22 · 12.20 · 1,209.02', () => {
    const h = headless(epoch)
    expect(figures(h, 'today')).toEqual([23, '111.38', '1.11', '110.27'])
    expect(figures(h, '7d')).toEqual([180, '1,221.22', '12.20', '1,209.02'])
  })

  it('after an 11.00 sale Today is 24 · 122.38 · 1.22 · 121.16; refunded, a "Refunds −11.00" line', () => {
    const h = headless(epoch)
    const sale = sell(h)
    expect(figures(h, 'today')).toEqual([24, '122.38', '1.22', '121.16'])
    run(h, refund(sale.id))
    h.node.settleDue()
    const d = salesDashboard(h.node.getState(), 'cafe', 'today', h.node.now(), content)
    expect(d.refunds).toEqual({ count: 1, amount: m('11.00') })
    expect(d.sales).toBe(24)
    expect(bal(h.node.getState(), 'cafe')).toBe('285.89')
    expect(bal(h.node.getState(), 'ana')).toBe('247.50')
  })

  it('"Customer pays": a Brunch 13.20 code reviews fee 0.13, total 13.33; the café receives 13.20', () => {
    const h = headless(epoch)
    run(h, {
      type: 'merchant.settings',
      actor: 'cafe',
      cmdId: cmd('settings'),
      patch: { feePayer: 'sender' },
    })
    run(h, {
      type: 'request.create',
      actor: 'cafe',
      cmdId: cmd('code'),
      channel: 'pos',
      amount: m('13.20'),
      items: resolveItems(content, 'cafe', [{ sku: 'brunch', qty: 1 }]),
    })
    const s = h.node.getState()
    const code = Object.values(s.requests).find((r) => r.channel === 'pos')
    if (!code) throw new Error('no code')
    const quote = quoteForRequest(s, code)
    expect(quote).toMatchObject({
      fee: m('0.13'),
      senderDebit: m('13.33'),
      recipientCredit: m('13.20'),
      payer: 'sender',
    })
    // An 11.00 code reads Pay 11.11.
    run(h, {
      type: 'request.create',
      actor: 'cafe',
      cmdId: cmd('code'),
      channel: 'pos',
      amount: m('11.00'),
      items: items11(),
    })
    const code2 = Object.values(h.node.getState().requests).findLast((r) => r.channel === 'pos')
    if (!code2) throw new Error('no second code')
    expect(quoteForRequest(h.node.getState(), code2)?.senderDebit).toBe(m('11.11'))
    run(h, {
      type: 'pay',
      actor: 'ana',
      cmdId: cmd(),
      to: '@cafelipa',
      amount: m('11.00'),
      channel: 'qr',
      requestId: code2.id,
      items: items11(),
      expect: { senderDebit: m('11.11') },
    })
    h.node.settleDue()
    expect([bal(h.node.getState(), 'ana'), bal(h.node.getState(), 'cafe')]).toEqual(['236.39', '297.00'])
  })

  it('a code already open keeps its payer; a counter-code review made before the switch says "The amount changed"', () => {
    const h = headless(epoch)
    run(h, { type: 'request.create', actor: 'cafe', cmdId: cmd('code'), channel: 'pos', amount: m('11.00') })
    const open = Object.values(h.node.getState().requests).find((r) => r.channel === 'pos')
    if (!open) throw new Error('no code')
    // Ana is on the counter-code review for 11.00: the café pays the fee, she pays 11.00.
    expect(quoteFor(h.node.getState(), 'cafe', 'qr', m('11.00'))?.senderDebit).toBe(m('11.00'))
    run(h, { type: 'merchant.settings', actor: 'cafe', cmdId: cmd('settings'), patch: { feePayer: 'sender' } })
    expect(quoteForRequest(h.node.getState(), h.node.getState().requests[open.id] ?? open)?.senderDebit).toBe(
      m('11.00'),
    )
    // The stale counter-code review: Pay returns quote-changed with the new total.
    expect(
      h.node.dispatch({
        type: 'pay',
        actor: 'ana',
        cmdId: cmd(),
        to: '@cafelipa',
        amount: m('11.00'),
        channel: 'qr',
        expect: { senderDebit: m('11.00') },
      }),
    ).toEqual({ ok: false, error: { code: 'quote-changed', senderDebit: m('11.11') } })
    expect(quoteFor(h.node.getState(), 'cafe', 'qr', m('11.00'))?.senderDebit).toBe(m('11.11'))
  })

  it('the counter code in phone mode: 3.30, paid by Café Lipa, the café receives 3.27', () => {
    const h = headless(epoch)
    const candidates = scanCandidates(h.node.getState(), 'ana', null, h.node.now(), 300_000, {
      counterMerchants: counterMerchants(content),
    })
    expect(candidates).toEqual([{ kind: 'counter', merchant: 'cafe' }])
    const quote = quoteFor(h.node.getState(), 'cafe', 'qr', m('3.30'))
    expect(quote).toMatchObject({ fee: m('0.03'), payer: 'recipient', senderDebit: m('3.30') })
    run(h, {
      type: 'pay',
      actor: 'ana',
      cmdId: cmd(),
      to: '@cafelipa',
      amount: m('3.30'),
      channel: 'qr',
      expect: { senderDebit: m('3.30') },
    })
    h.node.settleDue()
    expect([bal(h.node.getState(), 'cafe'), bal(h.node.getState(), 'ana')]).toEqual(['289.27', '244.20'])
  })

  it('the café pays the bakery invoice PZ-0412: fee 0.53, total 53.33, café 232.67, bakery 52.80', () => {
    const h = headless(epoch)
    const s0 = h.node.getState()
    expect(badges(s0, 'cafe')).toMatchObject({ invoicesToPay: 1 })
    const [invoice] = invoices(s0, 'cafe', 'toPay')
    expect(invoice).toMatchObject({ number: 'PZ-0412', amount: m('52.80') })
    const tx = txOf(
      run(h, {
        type: 'pay',
        actor: 'cafe',
        cmdId: cmd(),
        to: '@pekarnazrno',
        amount: m('52.80'),
        channel: 'request',
        requestId: invoice?.request.id,
        expect: { senderDebit: m('53.33') },
      }),
    )
    expect(tx.fee.fee).toBe(m('0.53'))
    h.node.settleDue()
    const s = h.node.getState()
    expect([bal(s, 'cafe'), bal(s, 'bakery')]).toEqual(['232.67', '52.80'])
    expect(badges(s, 'cafe').invoicesToPay).toBe(0)
    expect(invariants(s)).toEqual([])
  })

  it('the café declines the invoice with a reason: no money moves and the bakery is told why', () => {
    const h = headless(epoch)
    const [invoice] = invoices(h.node.getState(), 'cafe', 'toPay')
    run(h, {
      type: 'request.decline',
      actor: 'cafe',
      cmdId: cmd('decline'),
      requestId: invoice?.request.id ?? '',
      reason: 'Wrong amount',
    })
    const s = h.node.getState()
    expect(s.requests[invoice?.request.id ?? '']).toMatchObject({ status: 'declined', declineReason: 'Wrong amount' })
    expect([bal(s, 'cafe'), bal(s, 'bakery')]).toEqual(['286.00', '0.00'])
    expect(badges(s, 'cafe').invoicesToPay).toBe(0)
  })
})
