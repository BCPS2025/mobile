import { describe, expect, it } from 'vitest'
import '@app/phone/register'
import { isImplemented } from '@app/phone/implemented'
import { HUBS, homeOf, registeredRows } from '@app/phone/registry'
import { content } from './helpers'

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
    expect(registeredRows(home, 'sales').map((r) => r.row)).toEqual(['allPayments'])
    expect(isImplemented({ kind: 'hub', id: 'sales' }, 'pos')).toBe(true)
  })
})
