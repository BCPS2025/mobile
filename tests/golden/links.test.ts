// Golden journey links: a single-use payment link made, sent and paid; Ana 260.70, Marko 119.65.
import { describe, expect, it } from 'vitest'
import { encodePaymentUri, parsePaymentUri } from '@domain/uri'
import type { UserCommand } from '@domain/types'
import { linksOf, payItems } from '@store/selectors'
import { EPOCHS, bal, describeGolden } from '../support/golden'
import { headless } from '../support/journey'
import { m } from '../unit/helpers'
import { links } from './journeys/links'

describeGolden({
  name: 'links',
  journey: links,
  // Ana 247.50 + 13.20; Marko 132.98 − 13.33.
  end: { ana: '260.70', marko: '119.65' },
  fees: '0.13',
  check: (h) => {
    const s = h.node.getState()
    expect(s.links['L-000001']).toMatchObject({
      status: 'paid',
      note: 'Pizza',
      reusable: false,
      sharedWith: ['marko'],
      payments: [expect.stringMatching(/^BC-/)],
    })
    expect(s.links['L-000002']).toMatchObject({ status: 'open', sharedWith: ['@marta_k'] })
    const [open, paid] = linksOf(s, 'ana')
    expect(open?.link.id).toBe('L-000002')
    expect(paid?.paidBy?.handle).toBe('@marko')
    // Nothing is left to pay for Marko once it is paid.
    expect(payItems(s, 'marko').filter((i) => i.kind === 'link')).toEqual([])
  },
})

describe.each(EPOCHS)('the link rules at T0 = %s', (epoch) => {
  const cmd = (n: number, step = 'review') => `${(0xa00 + n).toString(16).padStart(16, '0')}:${step}`
  const pay = (actor: string, to: string, over: Record<string, unknown> = {}): UserCommand =>
    ({
      type: 'pay',
      actor,
      cmdId: cmd(Math.floor(Math.random() * 0xfff)),
      to,
      amount: m('13.20'),
      channel: 'link',
      linkId: 'L-000001',
      expect: { senderDebit: m('13.33') },
      ...over,
    }) as UserCommand

  it('a paid link: "This link has already been paid."; one\'s own link: "This is your own link."', () => {
    const h = headless(epoch)
    h.node.dispatch({ type: 'link.create', actor: 'ana', cmdId: cmd(1, 'link'), amount: m('13.20'), note: 'Pizza' })
    expect(h.node.dispatch(pay('ana', '@ana'))).toEqual({ ok: false, error: { code: 'self-payment' } })
    expect(h.node.dispatch(pay('marko', '@ana')).ok).toBe(true)
    expect(h.node.dispatch(pay('marko', '@ana'))).toEqual({
      ok: false,
      error: { code: 'invalid-state', status: 'paid' },
    })
    h.node.settleDue()
    expect([bal(h.node.getState(), 'ana'), bal(h.node.getState(), 'marko')]).toEqual(['260.70', '119.65'])
  })

  it('Copy link: the address ends …#/pay?v=1&to=@ana&amount=13.20&link=L-000001 and reads back', () => {
    const url = encodePaymentUri(
      { v: 1, to: '@ana', amount: m('13.20'), link: 'L-000001' },
      'https://example.test/mobile/next/',
    )
    expect(url.endsWith('#/pay?v=1&to=@ana&amount=13.20&link=L-000001')).toBe(true)
    expect(parsePaymentUri(url)).toEqual({ ok: true, value: { v: 1, to: '@ana', amount: 1320, link: 'L-000001' } })
  })
})
