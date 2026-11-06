import { describe, expect, it } from 'vitest'
import { errorText } from '@app/errors'
import { parsePaymentUri } from '@domain/uri'
import type { PaymentUri, UserCommand } from '@domain/types'
import { identicalOpenRequest, payRefusal, payTarget } from '@store/selectors'
import { type Headless, headless } from '../support/journey'
import { content, m } from './helpers'

// What a payment address points at in this browser (the page behind "Copy link", a QR payload), and
// whether a request has already been made.

let n = 0
const id = (step = 'review') => `${(++n).toString(16).padStart(16, '0')}:${step}`
const run = (h: Headless, c: UserCommand) => {
  const r = h.node.dispatch(c)
  if (!r.ok) throw new Error(`refused ${r.error.code}`)
  return r.value
}
const fresh = () => headless('2026-09-25')
const uri = (raw: string): PaymentUri => {
  const r = parsePaymentUri(`https://example.test/mobile/next/#/pay?${raw}`)
  if (!r.ok) throw new Error(r.error)
  return r.value
}

describe('payTarget', () => {
  it('a link of this browser: the owner and the amount must match the address', () => {
    const h = fresh()
    run(h, { type: 'link.create', actor: 'ana', cmdId: id('link'), amount: m('13.20'), note: 'Pizza' })
    const s = h.node.getState()
    const t = payTarget(s, uri('v=1&to=@ana&amount=13.20&link=L-000001'))
    expect(t).toMatchObject({ kind: 'link', link: { id: 'L-000001', amount: 1320 }, owner: { handle: '@ana' } })
    // Without the amount the id is enough; a different amount or owner is not this link.
    expect(payTarget(s, uri('v=1&to=@ana&link=L-000001')).kind).toBe('link')
    expect(payTarget(s, uri('v=1&to=@ana&amount=13.21&link=L-000001'))).toEqual({ kind: 'unknown' })
    expect(payTarget(s, uri('v=1&to=@marko&amount=13.20&link=L-000001'))).toEqual({ kind: 'unknown' })
  })

  it('an id this browser does not know never reaches pay: unknown', () => {
    const h = fresh()
    const s = h.node.getState()
    expect(payTarget(s, uri('v=1&to=@ana&amount=13.20&link=L-000009'))).toEqual({ kind: 'unknown' })
    expect(payTarget(s, uri('v=1&to=@ana&amount=13.20&req=R-000009'))).toEqual({ kind: 'unknown' })
    expect(payTarget(s, uri('v=1&to=@nobody&amount=13.20&req=r_seed_lunch'))).toEqual({ kind: 'unknown' })
  })

  it('a request: the seeded Lunch, a split share and an invoice are found by their ids', () => {
    const h = fresh()
    const s = h.node.getState()
    expect(payTarget(s, uri('v=1&to=@marko&amount=13.20&req=r_seed_lunch'))).toMatchObject({
      kind: 'request',
      request: { id: 'r_seed_lunch' },
      requester: { handle: '@marko' },
    })
    expect(payTarget(s, uri('v=1&to=@pekarnazrno&amount=52.80&req=PZ-0412')).kind).toBe('request')
    // The right id for the wrong recipient is not that request.
    expect(payTarget(s, uri('v=1&to=@ana&amount=13.20&req=r_seed_lunch'))).toEqual({ kind: 'unknown' })
  })

  it('just a recipient: a person or a business in the directory', () => {
    const h = fresh()
    const s = h.node.getState()
    expect(payTarget(s, uri('v=1&to=@marko'))).toMatchObject({ kind: 'party', party: { handle: '@marko' } })
    expect(payTarget(s, uri('v=1&to=@cafelipa&amount=3.30')).kind).toBe('party')
    expect(payTarget(s, uri('v=1&to=@nobody'))).toEqual({ kind: 'unknown' })
  })
})

describe('payRefusal', () => {
  it('a link: payable by another person; not by its owner, not once paid; the words follow errorText', () => {
    const h = fresh()
    run(h, { type: 'link.create', actor: 'ana', cmdId: id('link'), amount: m('13.20') })
    const target = () => payTarget(h.node.getState(), uri('v=1&to=@ana&amount=13.20&link=L-000001'))
    expect(payRefusal(target(), 'marko')).toBeNull()
    const own = payRefusal(target(), 'ana')
    expect(own).toEqual({ code: 'self-payment' })
    expect(errorText(own as never, { about: 'link' })).toBe('This is your own link.')
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
    const paid = payRefusal(target(), 'marko')
    expect(paid).toEqual({ code: 'invalid-state', status: 'paid' })
    expect(errorText(paid as never, { about: 'link' })).toBe('This link has already been paid.')
  })

  it('a request: not once cancelled or declined, not when made of someone else, not by its requester', () => {
    const h = fresh()
    const target = () => payTarget(h.node.getState(), uri('v=1&to=@marko&amount=13.20&req=r_seed_lunch'))
    expect(payRefusal(target(), 'ana')).toBeNull()
    expect(payRefusal(target(), 'marko')).toEqual({ code: 'self-payment' })
    expect(payRefusal(target(), 'cafe')).toEqual({ code: 'not-allowed' })
    run(h, { type: 'request.cancel', actor: 'marko', cmdId: id('cancel'), requestId: 'r_seed_lunch' })
    const cancelled = payRefusal(target(), 'ana')
    expect(cancelled).toEqual({ code: 'invalid-state', status: 'cancelled' })
    expect(errorText(cancelled as never, { about: 'request' })).toBe('This request was cancelled.')
  })

  it('a recipient alone is payable by anyone but themselves; an unknown address never is', () => {
    const h = fresh()
    const s = h.node.getState()
    expect(payRefusal(payTarget(s, uri('v=1&to=@marko')), 'ana')).toBeNull()
    expect(payRefusal(payTarget(s, uri('v=1&to=@marko')), 'marko')).toEqual({ code: 'self-payment' })
    expect(payRefusal({ kind: 'unknown' }, 'ana')).toEqual({ code: 'not-allowed' })
  })
})

describe('identicalOpenRequest', () => {
  it('finds the open request of the same amount and note to the same person, by handle or id', () => {
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
    const s = h.node.getState()
    expect(identicalOpenRequest(s, 'ana', '@marko', m('13.20'), 'Lunch')?.id).toBe('R-000001')
    expect(identicalOpenRequest(s, 'ana', 'marko', m('13.20'), ' Lunch ')?.id).toBe('R-000001')
    // Another amount, note, person or requester is not identical.
    expect(identicalOpenRequest(s, 'ana', '@marko', m('13.21'), 'Lunch')).toBeUndefined()
    expect(identicalOpenRequest(s, 'ana', '@marko', m('13.20'), 'Dinner')).toBeUndefined()
    expect(identicalOpenRequest(s, 'ana', '@marko', m('13.20'))).toBeUndefined()
    expect(identicalOpenRequest(s, 'ana', '@marta_k', m('13.20'), 'Lunch')).toBeUndefined()
    expect(identicalOpenRequest(s, 'marko', '@marko', m('13.20'), 'Lunch')).toBeUndefined()
    expect(identicalOpenRequest(s, 'ana', '@nobody', m('13.20'), 'Lunch')).toBeUndefined()
  })

  it('a request that was paid, declined or cancelled is not open: asking again needs no question', () => {
    const h = fresh()
    run(h, {
      type: 'request.create',
      actor: 'ana',
      cmdId: id('request'),
      channel: 'username',
      payer: '@marko',
      amount: m('5.00'),
    })
    run(h, { type: 'request.decline', actor: 'marko', cmdId: id('decline'), requestId: 'R-000001' })
    expect(identicalOpenRequest(h.node.getState(), 'ana', '@marko', m('5.00'))).toBeUndefined()
    expect(content.copy.errors.requestCancelled).toBe('This request was cancelled.')
  })
})
