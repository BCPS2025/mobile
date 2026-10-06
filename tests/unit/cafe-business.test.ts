import { describe, expect, it } from 'vitest'
import '@app/phone/register'
import { stepBar } from '@app/flows/engine'
import { isImplemented } from '@app/phone/implemented'
import { HUBS, homeOf, registeredRows } from '@app/phone/registry'
import type { Tx } from '@domain/types'
import { refundableSales, salesToRefund } from '@store/selectors'
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
