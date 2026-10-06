import { describe, expect, it } from 'vitest'
import '@app/phone/register'
import { stepBar } from '@app/flows/engine'
import { openNotification } from '@app/phone/notify'
import { sublineOf } from '@app/phone/sublines'
import { isImplemented } from '@app/phone/implemented'
import { HUBS, homeOf, registeredRows } from '@app/phone/registry'
import type { Tx } from '@domain/types'
import { notificationsFor } from '@store/notifications'
import { badges, feePayerExamples, invoices, refundableSales, salesToRefund } from '@store/selectors'
import { phoneFixture } from '../support/phone'
import { content, m } from './helpers'

type Fixture = ReturnType<typeof phoneFixture>

/** A starting-ledger payment by its row key ("cafe-thu-brunch"). */
const seedTx = (f: Fixture, key: string): Tx => {
  const tx = Object.values(f.node.getState().txs).find((t) => t?.seedMeta?.key === key)
  if (!tx) throw new Error(`no row ${key}`)
  return tx
}

// The café's business tools: what its Home and lists hold now that the sales, refunds, invoices and
// settings are built. The figures themselves are tested with the selectors (bc-selectors.test.ts)
// and the flows with the phone fixture.

const home = (() => {
  const h = homeOf(content.homes, 'pos', 'cafe')
  if (!h) throw new Error('no café home')
  return h
})()

describe('the café Sales list', () => {
  it('is one screen, pos.sales: the dashboard first, then the rows under it', () => {
    expect(HUBS.sales.screen).toBe('pos.sales')
    const entries = home.hubs.sales ?? []
    expect(entries[0]).toEqual({ section: 'todayKpis' })
    expect(registeredRows(home, 'sales').map((r) => r.row)).toEqual(['refundSale', 'allPayments'])
    expect(isImplemented({ kind: 'hub', id: 'sales' }, 'pos')).toBe(true)
  })
})

describe('Refund a sale', () => {
  it('lists the named sales newest first (Brunch 26.40, Espresso 2.20) and never a summary row', () => {
    const f = phoneFixture({ cafe: true })
    const rows = salesToRefund(f.node.getState(), 'cafe')
    expect(rows.map((r) => [r.tx.id === seedTx(f, 'cafe-thu-brunch').id, r.state])).toEqual([
      [true, 'refundable'],
      [false, 'refundable'],
    ])
    expect(rows.map((r) => r.tx.amount)).toEqual([m('26.40'), m('2.20')])
    expect(refundableSales(f.node.getState(), 'cafe')).toHaveLength(2)
  })

  it('opens on Which sale? with the newest chosen, then the check, then refunds it: café 259.60, Ana 273.90, no fee', () => {
    const f = phoneFixture({ cafe: true })
    const cafe = f.as('cafe')
    const { api } = cafe.open('refund')
    expect(cafe.step().id).toBe('pick')
    expect(stepBar(cafe.impl() as never, cafe.flow().draft as never, cafe.ctx(), cafe.flow().step)).toEqual({
      n: 1,
      total: 2,
    })
    expect(cafe.primary()).toEqual({ label: 'Continue', tone: 'navy', enabled: true })
    api.next()
    expect(cafe.step().id).toBe('review')
    expect(cafe.primary()).toEqual({ label: 'Refund 26.40 BCPS', tone: 'money', enabled: true })
    api.press()
    f.settle()
    expect(cafe.phase()).toBe('success')
    expect(f.balance('cafe')).toBe('259.60')
    expect(f.balance('ana')).toBe('273.90')
    expect(cafe.tx()).toMatchObject({ kind: 'refund', from: 'cafe', to: 'ana', amount: m('26.40') })
    expect(cafe.tx()?.fee.fee).toBe(0)
    // The sale reads Refunded ✓ from now on, and cannot be picked again.
    expect(salesToRefund(f.node.getState(), 'cafe').map((r) => r.state)).toEqual(['refunded', 'refundable'])
    expect(refundableSales(f.node.getState(), 'cafe')).toHaveLength(1)
  })

  it("from a sale's detail it starts on the check with that sale, without a step bar", () => {
    const f = phoneFixture({ cafe: true })
    const cafe = f.as('cafe')
    const espresso = seedTx(f, 'cafe-tue-espresso')
    cafe.open('refund', { txId: espresso.id })
    expect(cafe.step().id).toBe('review')
    expect(cafe.primary().label).toBe('Refund 2.20 BCPS')
    expect(stepBar(cafe.impl() as never, cafe.flow().draft as never, cafe.ctx(), cafe.flow().step)).toBeNull()
  })

  it('a sale that was refunded is not offered again; a second attempt says Refunded ✓ with the time', () => {
    const f = phoneFixture({ cafe: true })
    const brunch = seedTx(f, 'cafe-thu-brunch')
    const first = f.dispatch('cafe', { type: 'refund', txId: brunch.id })
    expect(first.ok).toBe(true)
    f.settle()
    // The list starts on the one that can still be refunded.
    const cafe = f.as('cafe')
    cafe.open('refund')
    expect((cafe.flow().draft as { txId: string }).txId).toBe(seedTx(f, 'cafe-tue-espresso').id)
    // Opened on the refunded sale itself: the ledger refuses and the words are the sale's.
    cafe.nav.home()
    const again = f.as('cafe')
    again.open('refund', { txId: brunch.id })
    again.api().press()
    expect(again.flow().error).toMatch(/^Refunded ✓ · (Fri|Sat|Thu) \d\d:\d\d$/)
    expect(f.balance('cafe')).toBe('259.60')
  })

  it('a balance that does not cover the refund says so, offers Top up and cannot refund', () => {
    const f = phoneFixture({ cafe: true })
    // 20.00 is left after cashing out most of the balance.
    expect(f.dispatch('cafe', { type: 'ramp.off', amount: m('260.00') }).ok).toBe(true)
    f.settle()
    const cafe = f.as('cafe')
    cafe.open('refund')
    cafe.api().next()
    expect(cafe.primary().enabled).toBe(false)
    expect(cafe.primary().label).toBe('Refund 26.40 BCPS')
  })
})

describe('Invoices to pay', () => {
  const openInvoice = (f: Fixture) => {
    const row = invoices(f.node.getState(), 'cafe', 'toPay')[0]
    if (!row) throw new Error('no invoice')
    const cafe = f.as('cafe')
    cafe.open('invoice', { request: row.request.id })
    return { cafe, row }
  }

  it('the Pay tile counts the invoice and the invoices row names it: PZ-0412 · 52.80', () => {
    const f = phoneFixture({ cafe: true })
    const c = { state: f.node.getState(), content, persona: 'cafe', now: f.node.now(), tz: 'Europe/Ljubljana' }
    expect(badges(c.state, 'cafe')).toMatchObject({ toPay: 0, invoicesToPay: 1 })
    expect(sublineOf('toPay', c)).toBe('1 to pay')
    expect(sublineOf('invoicesToPay', c)).toBe('PZ-0412 · 52.80')
  })

  it('PZ-0412: fee 0.53, total 53.33; Pay 53.33 BCPS leaves the café 232.67, and no invoice to pay', () => {
    const f = phoneFixture({ cafe: true })
    const { cafe, row } = openInvoice(f)
    expect(cafe.step().id).toBe('detail')
    expect(row.number).toBe('PZ-0412')
    expect(cafe.primary()).toEqual({ label: 'Pay 53.33 BCPS', tone: 'money', enabled: true })
    cafe.api().press()
    f.settle()
    expect(cafe.phase()).toBe('success')
    expect(f.balance('cafe')).toBe('232.67')
    expect(cafe.tx()).toMatchObject({ amount: m('52.80'), from: 'cafe' })
    expect(cafe.tx()?.fee).toMatchObject({ fee: m('0.53'), payer: 'sender' })
    expect(invoices(f.node.getState(), 'cafe', 'toPay')).toHaveLength(0)
    expect(badges(f.node.getState(), 'cafe').invoicesToPay).toBe(0)
  })

  it('Decline asks why (the reasons of the catalogue), tells the supplier and moves no money', () => {
    const f = phoneFixture({ cafe: true })
    const { cafe, row } = openInvoice(f)
    const reasons = content.catalogue.declineReasons.invoice
    expect(reasons).toEqual(['Wrong amount', 'Not ordered', 'Already paid', 'Other'])
    expect((cafe.flow().draft as { reason: string }).reason).toBe('Wrong amount')
    const secondary = cafe.step().secondary?.(cafe.flow().draft as never, cafe.ctx(), cafe.api() as never)
    expect(secondary).toMatchObject({ kind: 'outline', label: 'Decline' })
    secondary?.onPress()
    expect(cafe.step().id).toBe('decline')
    expect(cafe.primary()).toEqual({ label: 'Decline', tone: 'navy', enabled: true })
    cafe.api().set({ reason: 'Not ordered' })
    cafe.api().press()
    expect(cafe.phase()).toBe('success')
    expect(f.balance('cafe')).toBe('286.00')
    const request = f.node.getState().requests[row.request.id]
    expect(request).toMatchObject({ status: 'declined', declineReason: 'Not ordered' })
    expect(invoices(f.node.getState(), 'cafe', 'toPay')).toHaveLength(0)
  })

  it('a balance below 53.33 says so, offers Top up and does not pay', () => {
    const f = phoneFixture({ cafe: true })
    expect(f.dispatch('cafe', { type: 'ramp.off', amount: m('260.00') }).ok).toBe(true)
    f.settle()
    const { cafe } = openInvoice(f)
    expect(cafe.primary().enabled).toBe(false)
  })

  it('the seeded notification of the invoice opens its detail', () => {
    const f = phoneFixture({ cafe: true })
    const cafe = f.as('cafe')
    const n = notificationsFor(f.node.getState(), 'cafe', content).find((x) => x.kind === 'invoice.received')
    expect(n).toBeDefined()
    openNotification(f.app, cafe.who, {
      id: n?.id ?? '',
      txId: n?.txId ?? null,
      subject: n?.subject ?? { type: 'none' },
      kind: 'invoice.received',
    })
    expect(cafe.stack()).toEqual(['home', 'flow:invoice'])
    expect(cafe.step().screen).toBe('biz.invoice.detail')
  })
})

describe('Settings of the café', () => {
  const ctxOf = (f: Fixture) => ({
    state: f.node.getState(),
    content,
    persona: 'cafe',
    now: f.node.now(),
    tz: 'Europe/Ljubljana',
  })

  it('lists who pays the fee, auto-convert, the payout account, Biometrics and the integrations', () => {
    const rows = (home.hubs.settings ?? []).map((e) => ('row' in e ? e.row : e.section))
    expect(rows).toEqual(['feePayer', 'autoConvert', 'payoutAccount', 'biometrics', 'integrations', 'about', 'logout'])
    const f = phoneFixture({ cafe: true })
    expect(sublineOf('feePayer', ctxOf(f))).toBe('You pay')
    expect(sublineOf('autoConvertOn', ctxOf(f))).toBe('On · 50% · 23:00')
    expect(sublineOf('payoutAccount', ctxOf(f))).toBe('SI56 •••• •••• 1934')
  })

  it('Who pays the fee: the two examples of an 11.00 sale, and Save keeps the choice for what is made next', () => {
    const f = phoneFixture({ cafe: true })
    const cafe = f.as('cafe')
    const sale = m(content.config.feeExampleSale)
    expect(sale).toBe(m('11.00'))
    const examples = feePayerExamples(f.node.getState(), sale)
    expect([examples.recipient.customerPays, examples.recipient.merchantReceives]).toEqual([m('11.00'), m('10.89')])
    expect([examples.sender.customerPays, examples.sender.merchantReceives]).toEqual([m('11.11'), m('11.00')])
    cafe.open('feePayer')
    expect(cafe.step().id).toBe('choose')
    expect((cafe.flow().draft as { feePayer: string }).feePayer).toBe('recipient')
    expect(cafe.primary()).toEqual({ label: 'Save', tone: 'navy', enabled: true })
    cafe.api().set({ feePayer: 'sender' })
    cafe.api().press()
    expect(cafe.phase()).toBe('success')
    expect(f.node.getState().merchant.cafe?.feePayer).toBe('sender')
    expect(sublineOf('feePayer', ctxOf(f))).toBe('Customer pays')
  })

  it('Biometrics: on until an account switches it off; Reset puts it back', () => {
    const f = phoneFixture({ cafe: true })
    expect(f.app.transient.get().biometricsOff).toEqual([])
    f.app.actions.setBiometrics('cafe', false)
    expect(f.app.transient.get().biometricsOff).toEqual(['cafe'])
    f.app.actions.setBiometrics('cafe', true)
    expect(f.app.transient.get().biometricsOff).toEqual([])
    f.app.actions.setBiometrics('cafe', false)
    f.app.actions.reset('stage', false)
    expect(f.app.transient.get().biometricsOff).toEqual([])
  })
})
