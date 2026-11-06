// Golden journey topup-cashout: top-ups by card, bank transfer and local method; cash-outs. The
// composite journey ends on its balances at the three epochs; the values of the acceptance list (€50
// by card, a bank transfer at Friday 12:15, the maximum top-up, 110.00 and 1.10 out, the minimum) are
// proved on their own from the start.
import { describe, expect, it } from 'vitest'
import { cashOutRef } from '@domain/ids'
import { invariants } from '@domain/invariants'
import { formatHundredths } from '@domain/money'
import type { LedgerEvent, SimTime, Tx, UserCommand } from '@domain/types'
import { formatTime, formatWeekday, resolveLocal } from '@sim/tz'
import { hasBank, maxCashOut, quoteCashOut, topUpAmount, topUpForShortfall } from '@store/selectors'
import { EPOCHS, bal, describeGolden } from '../support/golden'
import { type Headless, headless } from '../support/journey'
import { content, m } from '../unit/helpers'
import { topupCashout } from './journeys/topup-cashout'

const TZ = content.config.t0.tz
const when = (t: SimTime) => `${formatWeekday(t, TZ)} ${formatTime(t, TZ)}`

describeGolden({
  name: 'topup-cashout',
  journey: topupCashout,
  // Ana: 247.50 + 55.00 + 110.00 − 110.00 − 1.10. Marko: 132.98 + 22.00.
  // Café: 286.00 + 11.00 (Monday 10:00) + 22.00 − 50.00.
  end: { ana: '301.40', marko: '154.98', cafe: '269.00' },
  // Cash-outs only: 1.65 + 0.02 + 0.75. Top-ups cost nothing.
  fees: '2.42',
  check: (h) => {
    const s = h.node.getState()
    const ramps = Object.values(s.ramps)
    expect(ramps.map((r) => [r.id, r.persona, r.direction, r.method ?? null, r.status])).toEqual([
      ['RP-000001', 'ana', 'on', 'card', 'completed'],
      ['RP-000002', 'ana', 'on', 'bank-transfer', 'completed'],
      ['RP-000003', 'marko', 'on', 'local-method', 'completed'],
      ['RP-000004', 'ana', 'off', null, 'completed'],
      ['RP-000005', 'ana', 'off', null, 'completed'],
      ['RP-000006', 'cafe', 'on', 'bank-transfer', 'completed'],
      ['RP-000007', 'cafe', 'on', 'local-method', 'completed'],
      ['RP-000008', 'cafe', 'off', null, 'completed'],
    ])
    // The transfer asked for at 12:17 arrived two hours later; the one at 16:30 on Monday at 10:00.
    expect(when(s.ramps['RP-000002']?.arrivesAt as SimTime)).toBe('Fri 14:17')
    expect(when(s.ramps['RP-000006']?.arrivesAt as SimTime)).toBe('Mon 10:00')
    // Every conversion: the fee, and the euros paid out.
    const out = (id: string) => {
      const tx = s.txs[s.ramps[id]?.txId ?? ''] as Tx
      return [formatHundredths(tx.fee.fee), tx.fee.eurOut]
    }
    expect([out('RP-000004'), out('RP-000005'), out('RP-000008')]).toEqual([
      ['1.65', 9850],
      ['0.02', 98],
      ['0.75', 4477],
    ])
    // Nothing waits for the bank any more.
    expect(s.pendingRamps).toEqual([])
  },
})

describe.each(EPOCHS)('the acceptance values of top-up and cash-out, from the start at T0 = %s', (epoch) => {
  let n = 0
  const cmd = (step: string) => `${(0xb00 + ++n).toString(16).padStart(16, '0')}:${step}`
  const run = (h: Headless, c: UserCommand): LedgerEvent[] => {
    const r = h.node.dispatch(c)
    if (!r.ok) throw new Error(`refused ${r.error.code}`)
    return r.value
  }
  const topUp = (actor: string, method: string, eur: number): UserCommand =>
    ({ type: 'ramp.on', actor, cmdId: cmd('topup'), method, eur }) as UserCommand
  const cashOut = (actor: string, amount: string): UserCommand => ({
    type: 'ramp.off',
    actor,
    cmdId: cmd('cashout'),
    amount: m(amount),
  })

  it('€50 by card: +55.00 BCPS, no fee, a payment from the issuer', () => {
    const h = headless(epoch)
    expect(topUpAmount(h.node.getState(), 50)).toBe(m('55.00'))
    const tx = (run(h, topUp('ana', 'card', 50)).find((e) => e.type === 'tx.submitted') as { tx: Tx }).tx
    expect(tx).toMatchObject({ kind: 'on-ramp', from: 'sys:issuance', to: 'ana', amount: m('55.00') })
    expect(tx.fee.fee).toBe(0)
    h.node.settleDue()
    expect(bal(h.node.getState(), 'ana')).toBe('302.50')
    expect(formatHundredths(h.node.getState().balances['sys:fees']?.confirmed ?? 0)).toBe(
      formatHundredths(h.node.seedState().balances['sys:fees']?.confirmed ?? 0),
    )
    expect(invariants(h.node.getState())).toEqual([])
  })

  it('a bank transfer at Friday 12:15: on its way, expected Fri 14:15; it arrives then', () => {
    const h = headless(epoch)
    run(h, topUp('ana', 'bank-transfer', 50))
    const ramp = h.node.getState().ramps['RP-000001']
    expect(ramp?.status).toBe('pending')
    expect(when(ramp?.arrivesAt as SimTime)).toBe('Fri 14:15')
    h.node.advanceTo(((ramp?.arrivesAt as number) - 1) as SimTime, 'timer')
    h.node.settleDue()
    expect(bal(h.node.getState(), 'ana')).toBe('247.50')
    h.node.advanceTo(ramp?.arrivesAt as SimTime, 'timer')
    h.node.settleDue()
    expect(bal(h.node.getState(), 'ana')).toBe('302.50')
    expect(h.node.getState().ramps['RP-000001']?.status).toBe('completed')
  })

  it('outside banking hours the transfer arrives on the next banking day at 10:00', () => {
    const h = headless(epoch)
    h.node.clock.jumpTo(resolveLocal(h.seed.t0Date, '16:30', TZ))
    run(h, topUp('cafe', 'bank-transfer', 10))
    const arrives = h.node.getState().ramps['RP-000001']?.arrivesAt as SimTime
    expect(when(arrives)).toBe('Mon 10:00')
    h.node.advanceTo(resolveLocal(h.seed.t0Date, '23:59', TZ), 'timer')
    expect(h.node.getState().ramps['RP-000001']?.status).toBe('pending')
    h.node.advanceTo(arrives, 'timer')
    h.node.settleDue()
    expect(bal(h.node.getState(), 'cafe')).toBe('297.00')
  })

  it('more than €10,000 is refused ("The maximum top-up is €10,000."); a business may top up €100,000', () => {
    const h = headless(epoch)
    expect(h.node.dispatch(topUp('ana', 'card', 10_001))).toEqual({
      ok: false,
      error: { code: 'invalid-amount', maxEur: 10_000 },
    })
    expect(h.node.dispatch(topUp('ana', 'card', 10_000)).ok).toBe(true)
    expect(h.node.dispatch(topUp('cafe', 'local-method', 100_000)).ok).toBe(true)
    expect(h.node.dispatch(topUp('cafe', 'local-method', 100_001))).toEqual({
      ok: false,
      error: { code: 'invalid-amount', maxEur: 100_000 },
    })
  })

  it('the Top up link after a shortfall: 5.86 BCPS short is €6', () => {
    const h = headless(epoch)
    expect(topUpForShortfall(h.node.getState(), 'ana', m('5.86'))).toBe(6)
  })

  it('cash out 110.00: conversion 1.65, you receive ≈ €98.50, reference BC-OUT-…', () => {
    const h = headless(epoch)
    expect(quoteCashOut(h.node.getState(), m('110.00'))).toMatchObject({ fee: m('1.65'), eurOut: 9850 })
    const tx = (run(h, cashOut('ana', '110.00')).find((e) => e.type === 'tx.submitted') as { tx: Tx }).tx
    expect(tx).toMatchObject({ kind: 'off-ramp', from: 'ana', to: 'sys:issuance', amount: m('110.00') })
    expect([formatHundredths(tx.fee.fee), tx.fee.eurOut]).toEqual(['1.65', 9850])
    expect(cashOutRef(tx.id)).toMatch(/^BC-OUT-[0-9A-Z]{6}$/)
    h.node.settleDue()
    expect(bal(h.node.getState(), 'ana')).toBe('137.50')
    expect(invariants(h.node.getState())).toEqual([])
  })

  it('cash out 1.10: conversion 0.02, ≈ €0.98; below 1.10 is refused ("The minimum is 1.10 BCPS.")', () => {
    const h = headless(epoch)
    const tx = (run(h, cashOut('ana', '1.10')).find((e) => e.type === 'tx.submitted') as { tx: Tx }).tx
    expect([formatHundredths(tx.fee.fee), tx.fee.eurOut]).toEqual(['0.02', 98])
    expect(h.node.dispatch(cashOut('ana', '1.09'))).toEqual({
      ok: false,
      error: { code: 'invalid-amount', min: m('1.10') },
    })
    expect(quoteCashOut(h.node.getState(), m('1.09'))).toBeNull()
  })

  it('Max is what is available; both accounts have a bank to cash out to', () => {
    const h = headless(epoch)
    const s = h.node.getState()
    expect(formatHundredths(maxCashOut(s, 'ana'))).toBe('247.50')
    expect(formatHundredths(maxCashOut(s, 'cafe'))).toBe('286.00')
    expect([hasBank(s, 'ana'), hasBank(s, 'cafe')]).toEqual([true, true])
  })
})
