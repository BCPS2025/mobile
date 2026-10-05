// Golden journey send-request-split: Ana and Marko send, request, decline and split. The composite
// journey ends on its balances at the three epochs; the values of the acceptance list (a request
// paid, one turned down, the Brunch split, ten euros in three) are proved on their own from the start.
import { describe, expect, it } from 'vitest'
import { invariants } from '@domain/invariants'
import { formatHundredths } from '@domain/money'
import type { Tx, UserCommand } from '@domain/types'
import { splitsOf } from '@store/selectors'
import { EPOCHS, bal, describeGolden } from '../support/golden'
import { type Headless, headless } from '../support/journey'
import { content, m } from '../unit/helpers'
import { seedTxId, sendRequestSplit } from './journeys/send-request-split'

describeGolden({
  name: 'send-request-split',
  journey: sendRequestSplit,
  // Ana: 247.50 − 16.67 − 13.33 + 13.20 + 13.20 + 3.33; Marko: 132.98 + 16.50 + 13.20 − 13.33 − 13.33 − 3.36.
  end: { ana: '247.23', marko: '132.66' },
  // 0.17 + 0.13 + 0.13 + 0.13 + 0.03
  fees: '0.59',
  check: (h) => {
    const s = h.node.getState()
    expect(s.requests.r_seed_lunch?.status).toBe('paid')
    expect(s.requests['R-000001']?.status).toBe('paid')
    expect(s.requests['R-000002']).toMatchObject({ status: 'declined', declineReason: 'Not ordered' })
    expect(s.requests['R-000003']?.status).toBe('declined') // the first ask of the Brunch share
    expect(s.requests['R-000004']?.status).toBe('paid') // asked again
    expect(s.splits['S-000001']?.shares[0]?.requestId).toBe('R-000004')
    expect(s.requests['R-000006']?.status).toBe('cancelled') // Marta's open share
    const brunch = splitsOf(s, 'ana').find((x) => x.split.id === 'S-000001')
    expect(brunch).toMatchObject({ paid: 1, count: 1, status: 'complete' })
    expect(formatHundredths(brunch?.collected ?? 0)).toBe('13.20')
  },
})

describe.each(EPOCHS)('the acceptance values of requests and splits, from the start at T0 = %s', (epoch) => {
  const run = (h: Headless, c: UserCommand) => {
    const r = h.node.dispatch(c)
    if (!r.ok) throw new Error(`refused ${r.error.code}`)
    return r.value
  }
  const cmd = (n: number, step = 'review') => `${(0x900 + n).toString(16).padStart(16, '0')}:${step}`

  it('Ana pays the seeded Lunch: fee 0.13, total 13.33, Ana 234.17, Marko 146.18', () => {
    const h = headless(epoch)
    const events = run(h, {
      type: 'pay',
      actor: 'ana',
      cmdId: cmd(1),
      to: '@marko',
      amount: m('13.20'),
      channel: 'request',
      requestId: 'r_seed_lunch',
      expect: { senderDebit: m('13.33') },
    })
    const tx = (events[0] as { tx: Tx }).tx
    expect([formatHundredths(tx.fee.fee), formatHundredths(tx.fee.senderDebit)]).toEqual(['0.13', '13.33'])
    h.node.settleDue()
    expect([bal(h.node.getState(), 'ana'), bal(h.node.getState(), 'marko')]).toEqual(['234.17', '146.18'])
    expect(invariants(h.node.getState())).toEqual([])
  })

  it('Declined: no money moved, balances unchanged; a request cancelled meanwhile cannot be paid', () => {
    const h = headless(epoch)
    run(h, {
      type: 'request.decline',
      actor: 'ana',
      cmdId: cmd(2, 'decline'),
      requestId: 'r_seed_lunch',
      reason: 'Not now',
    })
    expect([bal(h.node.getState(), 'ana'), bal(h.node.getState(), 'marko')]).toEqual(['247.50', '132.98'])
    expect(h.node.getState().requests.r_seed_lunch).toMatchObject({ status: 'declined', declineReason: 'Not now' })
    const g = headless(epoch)
    run(g, {
      type: 'request.create',
      actor: 'marko',
      cmdId: cmd(3, 'request'),
      channel: 'username',
      payer: '@ana',
      amount: m('4.00'),
      note: 'Coffee',
    })
    run(g, { type: 'request.cancel', actor: 'marko', cmdId: cmd(4, 'cancel'), requestId: 'R-000001' })
    const late = g.node.dispatch({
      type: 'pay',
      actor: 'ana',
      cmdId: cmd(5),
      to: '@marko',
      amount: m('4.00'),
      channel: 'request',
      requestId: 'R-000001',
      expect: { senderDebit: m('4.04') },
    })
    expect(late).toEqual({ ok: false, error: { code: 'invalid-state', status: 'cancelled' } })
  })

  it('Ana splits the Brunch with Marko: Ana 260.70, Marko 119.65, "1 of 1 paid"', () => {
    const h = headless(epoch)
    run(h, {
      type: 'split.create',
      actor: 'ana',
      cmdId: cmd(6, 'split'),
      sourceTxId: seedTxId(content, 'cafe-thu-brunch'),
      total: m('26.40'),
      note: 'Brunch for two',
      shares: [{ party: '@marko', amount: m('13.20') }],
    })
    expect(splitsOf(h.node.getState(), 'ana')[0]).toMatchObject({ paid: 0, count: 1 })
    run(h, {
      type: 'pay',
      actor: 'marko',
      cmdId: cmd(7),
      to: '@ana',
      amount: m('13.20'),
      channel: 'request',
      requestId: 'R-000001',
      expect: { senderDebit: m('13.33') },
    })
    h.node.settleDue()
    expect([bal(h.node.getState(), 'ana'), bal(h.node.getState(), 'marko')]).toEqual(['260.70', '119.65'])
    expect(splitsOf(h.node.getState(), 'ana')[0]).toMatchObject({ paid: 1, count: 1, status: 'complete' })
    expect(invariants(h.node.getState())).toEqual([])
  })

  it('10.00 with two people: 3.33 each, Ana keeps 3.34; custom shares over the total are refused', () => {
    const h = headless(epoch)
    run(h, {
      type: 'split.create',
      actor: 'ana',
      cmdId: cmd(8, 'split'),
      total: m('10.00'),
      note: 'Pizza',
      shares: [
        { party: '@marko', amount: m('3.33') },
        { party: '@marta_k', amount: m('3.33') },
      ],
    })
    expect(h.node.getState().splits['S-000001']?.ownShare).toBe(m('3.34'))
    const over = h.node.dispatch({
      type: 'split.create',
      actor: 'ana',
      cmdId: cmd(9, 'split'),
      sourceTxId: seedTxId(content, 'cafe-thu-brunch'),
      total: m('26.40'),
      note: 'Brunch for two',
      shares: [{ party: '@marko', amount: m('26.41') }],
    })
    // "The shares add up to more than 26.40."
    expect(over).toEqual({ ok: false, error: { code: 'invalid-amount', max: m('26.40') } })
  })

  it('Ask again after a decline re-links the share to a new request', () => {
    const h = headless(epoch)
    run(h, {
      type: 'split.create',
      actor: 'ana',
      cmdId: cmd(10, 'split'),
      total: m('10.00'),
      note: 'Pizza',
      shares: [{ party: '@marko', amount: m('5.00') }],
    })
    run(h, { type: 'request.decline', actor: 'marko', cmdId: cmd(11, 'decline'), requestId: 'R-000001' })
    run(h, { type: 'split.reask', actor: 'ana', cmdId: cmd(12, 'reask'), splitId: 'S-000001', party: '@marko' })
    expect(h.node.getState().splits['S-000001']?.shares[0]?.requestId).toBe('R-000002')
    expect(h.node.getState().requests['R-000002']?.status).toBe('open')
  })
})
