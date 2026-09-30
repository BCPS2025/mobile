import { describe, expect, it } from 'vitest'
import { invariants } from '@domain/invariants'
import { cashOutRef } from '@domain/ids'
import { formatHundredths } from '@domain/money'
import type { LedgerEvent, LedgerState, Ramp, SimTime, Tx, UserCommand } from '@domain/types'
import { bankTransferArrival, decideCtx } from '@sim/banking'
import { buildSeed } from '@sim/seed'
import { formatTime, formatWeekday, instantOfAt, resolveLocal } from '@sim/tz'
import { decodeCommand, encodeCommand } from '@store/log-codec'
import { checkWireCommand } from '@store/record'
import { replay } from '@store/replay'
import { type Headless, headless } from '../support/journey'
import { recordOf } from '../support/records'
import { content, m } from './helpers'

// ramp.on (top up) and ramp.off (cash out): no fee coming in, 1.5 % going out, and the bank-transfer
// arrival item of the scheduler.

const EPOCHS = ['2026-09-25', '2026-10-23', '2027-03-26'] as const
const TZ = content.config.t0.tz
let n = 0
const id = (step = 'review') => `${(++n).toString(16).padStart(16, '0')}:${step}`

const topUp = (method: string, eur: number, actor = 'ana'): UserCommand =>
  ({ type: 'ramp.on', actor, cmdId: id('topup'), method, eur }) as UserCommand
const cashOut = (amount: string | number, actor = 'ana'): UserCommand => ({
  type: 'ramp.off',
  actor,
  cmdId: id('cashout'),
  amount: typeof amount === 'string' ? m(amount) : (amount as never),
})

const run = (h: Headless, c: UserCommand): LedgerEvent[] => {
  const r = h.node.dispatch(c)
  if (!r.ok) throw new Error(`refused ${r.error.code}`)
  return r.value
}
const refusal = (h: Headless, c: UserCommand) => {
  const r = h.node.dispatch(c)
  return r.ok ? 'accepted' : r.error
}
const bal = (s: LedgerState, a: string) => formatHundredths(s.balances[a]?.confirmed ?? Number.NaN)
const ramp = (h: Headless, rampId = 'RP-000001'): Ramp => {
  const r = h.node.getState().ramps[rampId]
  if (!r) throw new Error(`no ramp ${rampId}`)
  return r
}
const txOf = (events: LedgerEvent[]): Tx => (events.find((e) => e.type === 'tx.submitted') as { tx: Tx }).tx

describe.each(EPOCHS)('ramp.on by card or local method at T0 = %s', (epoch) => {
  it('€50 by card gives 55.00 BCPS, no fee: a transaction from the issuer that settles like a payment', () => {
    const h = headless(epoch)
    const events = run(h, topUp('card', 50))
    expect(events.map((e) => e.type)).toEqual(['tx.submitted', 'ramp.completed'])
    const tx = txOf(events)
    expect(tx).toMatchObject({
      kind: 'on-ramp',
      channel: 'auto',
      status: 'pending',
      from: 'sys:issuance',
      to: 'ana',
      amount: 5500,
      rampId: 'RP-000001',
    })
    expect(tx.fee).toMatchObject({ policy: 'on-ramp', fee: 0, payer: null, senderDebit: 5500, recipientCredit: 5500 })
    expect(tx.dueAt).toBe(tx.createdAt + 1400)
    expect(tx.cmdId).toMatch(/:topup$/)
    expect(ramp(h)).toMatchObject({
      id: 'RP-000001',
      persona: 'ana',
      direction: 'on',
      method: 'card',
      eur: 5000,
      amount: 5500,
      fee: 0,
      status: 'completed',
      txId: tx.id,
      requestedAt: h.node.now(),
    })
    expect(ramp(h).arrivesAt).toBeUndefined()
    expect(bal(h.node.getState(), 'ana')).toBe('247.50') // pending: not in the balance yet
    expect(h.node.getState().pendingRamps).toEqual([])
    h.node.settleDue()
    expect(bal(h.node.getState(), 'ana')).toBe('302.50')
    expect(formatHundredths(h.node.getState().balances['sys:fees']?.confirmed ?? 0)).toBe(
      formatHundredths(h.node.seedState().balances['sys:fees']?.confirmed ?? 0),
    )
    expect(h.node.getState().counters.rampSeq).toBe(1)
    expect(invariants(h.node.getState())).toEqual([])
  })

  it('a local payment method pays in at once too; the café has no card', () => {
    const h = headless(epoch)
    run(h, topUp('local-method', 20, 'cafe'))
    h.node.settleDue()
    expect(bal(h.node.getState(), 'cafe')).toBe('308.00')
    expect(ramp(h)).toMatchObject({ method: 'local-method', amount: 2200, persona: 'cafe' })
    expect(refusal(h, topUp('card', 20, 'cafe'))).toEqual({ code: 'not-allowed' })
  })
})

describe('the amount and who may top up', () => {
  it('€1 to €10,000 for a person, up to €100,000 for a business, whole euros only', () => {
    const h = headless('2026-09-25')
    expect(refusal(h, topUp('card', 0))).toEqual({ code: 'invalid-amount' })
    expect(refusal(h, topUp('card', -5))).toEqual({ code: 'invalid-amount' })
    expect(refusal(h, topUp('card', 1.5))).toEqual({ code: 'invalid-amount' })
    expect(refusal(h, topUp('card', Number.NaN))).toEqual({ code: 'invalid-amount' })
    expect(refusal(h, topUp('card', 10_001))).toEqual({ code: 'invalid-amount', maxEur: 10_000 })
    expect(refusal(h, topUp('card', 10_000))).toBe('accepted')
    expect(ramp(h).amount).toBe(1_100_000)
    expect(refusal(h, topUp('local-method', 100_001, 'firm'))).toEqual({ code: 'invalid-amount', maxEur: 100_000 })
    expect(refusal(h, topUp('local-method', 100_000, 'firm'))).toBe('accepted')
    expect(refusal(h, topUp('card', 1))).toBe('accepted')
    expect(ramp(h, 'RP-000003').amount).toBe(110)
  })

  it('refuses a method that is not on file, an unknown method and an unknown actor', () => {
    const h = headless('2026-09-25')
    expect(refusal(h, topUp('card', 50, 'supplier'))).toEqual({ code: 'not-allowed' })
    expect(refusal(h, topUp('cheque', 50))).toEqual({ code: 'not-allowed' })
    expect(refusal(h, topUp('card', 50, 'nobody'))).toEqual({ code: 'not-allowed' })
    // Without a bank on file (a crafted account) a bank transfer is refused as well.
    const seed = buildSeed(content, '2026-09-25')
    const ana = seed.state.directory.ana
    if (!ana) throw new Error('ana')
    const noBank: LedgerState = {
      ...seed.state,
      directory: { ...seed.state.directory, ana: { ...ana, methods: { card: true, bank: false } } },
    }
    const h2 = headless('2026-09-25')
    h2.node.loadSession({ seed: noBank, t0: seed.t0, state: noBank, events: [], log: [], clock: seed.t0 })
    expect(refusal(h2, topUp('bank-transfer', 50))).toEqual({ code: 'not-allowed' })
    expect(refusal(h2, topUp('card', 50))).toBe('accepted')
  })

  it('a repeated command id is refused as duplicate and pays in once', () => {
    const h = headless('2026-09-25')
    const c = topUp('card', 50)
    run(h, c)
    expect(refusal(h, c)).toEqual({ code: 'duplicate' })
    h.node.settleDue()
    expect(bal(h.node.getState(), 'ana')).toBe('302.50')
  })
})

describe.each(EPOCHS)('a bank-transfer top-up at T0 = %s (Friday 12:15)', (epoch) => {
  it('is only requested: ON ITS WAY, expected Friday 14:15; it arrives then and pays in', () => {
    const h = headless(epoch)
    const requestedAt = h.node.now()
    expect(formatTime(requestedAt, TZ)).toBe('12:15')
    const events = run(h, topUp('bank-transfer', 50))
    expect(events.map((e) => e.type)).toEqual(['ramp.requested'])
    const r = ramp(h)
    expect(r).toMatchObject({ direction: 'on', method: 'bank-transfer', eur: 5000, amount: 5500, status: 'pending' })
    expect(r.txId).toBeUndefined()
    expect(r.arrivesAt).toBe(requestedAt + 2 * 3_600_000)
    expect(`${formatWeekday(r.arrivesAt as SimTime, TZ)} ${formatTime(r.arrivesAt as SimTime, TZ)}`).toBe('Fri 14:15')
    expect(h.node.getState().pendingRamps).toEqual(['RP-000001'])
    expect(Object.values(h.node.getState().txs).some((t) => t.rampId !== undefined)).toBe(false)
    expect(invariants(h.node.getState())).toEqual([])

    // Nothing arrives before the time; at the time the money is issued (a transaction, then settled).
    h.node.advanceTo(((r.arrivesAt as number) - 1) as SimTime, 'timer')
    expect(ramp(h).status).toBe('pending')
    const arrival = h.node.advanceTo(r.arrivesAt as SimTime, 'timer')
    expect(arrival.map((e) => e.type)).toEqual(['tx.submitted', 'ramp.completed'])
    expect(arrival.every((e) => e.at === r.arrivesAt)).toBe(true)
    expect(arrival.every((e) => e.cmdId === undefined)).toBe(true)
    const tx = txOf(arrival)
    expect(tx).toMatchObject({ kind: 'on-ramp', to: 'ana', amount: 5500, rampId: 'RP-000001', createdAt: r.arrivesAt })
    expect(ramp(h)).toMatchObject({ status: 'completed', txId: tx.id })
    expect(h.node.getState().pendingRamps).toEqual([])
    h.node.settleDue()
    expect(bal(h.node.getState(), 'ana')).toBe('302.50')
    expect(invariants(h.node.getState())).toEqual([])
  })

  it('arrives by the rule after a dispatch too, and several can be on their way at once', () => {
    const h = headless(epoch)
    run(h, topUp('bank-transfer', 50))
    h.node.clock.advance(30 * 60_000)
    run(h, topUp('bank-transfer', 20, 'marko'))
    expect(h.node.getState().pendingRamps).toEqual(['RP-000001', 'RP-000002'])
    h.node.advanceTo(ramp(h).arrivesAt as SimTime, 'timer')
    h.node.settleDue()
    expect(bal(h.node.getState(), 'ana')).toBe('302.50')
    expect(bal(h.node.getState(), 'marko')).toBe('132.98')
    h.node.advanceTo(ramp(h, 'RP-000002').arrivesAt as SimTime, 'timer')
    h.node.settleDue()
    expect(bal(h.node.getState(), 'marko')).toBe('154.98')
    expect(h.node.getState().pendingRamps).toEqual([])
    expect(invariants(h.node.getState())).toEqual([])
  })

  it('a session with every kind of top-up and a cash-out replays to the same ledger', () => {
    const h = headless(epoch)
    run(h, topUp('bank-transfer', 50))
    run(h, topUp('card', 10, 'marko'))
    h.node.clock.advance(60_000)
    run(h, cashOut('110.00'))
    run(h, topUp('local-method', 5, 'cafe'))
    h.node.clock.advance(3 * 3_600_000)
    h.node.run(h.node.now(), 'catch-up')
    h.node.settleDue()
    const record = recordOf(h.node, h.seed.t0Date)
    const r = replay({
      seed: h.seed.state,
      t0: h.seed.t0,
      t0Date: h.seed.t0Date,
      content,
      log: record.log,
      clock: record.clock,
    })
    if (!r.ok) throw new Error(JSON.stringify(r.error))
    expect(JSON.stringify(r.value.state)).toBe(JSON.stringify(h.node.getState()))
    expect(JSON.stringify(r.value.events)).toBe(JSON.stringify(h.node.events()))
    expect(invariants(r.value.state)).toEqual([])
  })
})

describe('when a bank transfer arrives (Slovenia: Monday to Friday, 08:00 to 17:00)', () => {
  const config = buildSeed(content, '2026-09-25').state.config
  const at = (date: string, time: string) => resolveLocal(date, time, TZ)
  const arrives = (date: string, time: string) => {
    const t = bankTransferArrival(config, 'SI', at(date, time))
    return `${formatWeekday(t, TZ)} ${formatTime(t, TZ)}`
  }

  it('inside banking hours: two hours later', () => {
    expect(arrives('2026-09-25', '12:15')).toBe('Fri 14:15')
    expect(arrives('2026-09-25', '08:00')).toBe('Fri 10:00')
    expect(arrives('2026-09-21', '09:30')).toBe('Mon 11:30')
  })

  it('never after closing: the last request that still arrives that day is 15:00', () => {
    expect(arrives('2026-09-25', '15:00')).toBe('Fri 17:00')
    expect(arrives('2026-09-25', '15:01')).toBe('Mon 10:00')
    // Friday 16:30 arrives Monday 10:00.
    expect(arrives('2026-09-25', '16:30')).toBe('Mon 10:00')
    expect(arrives('2026-09-24', '16:30')).toBe('Fri 10:00')
  })

  it('outside banking hours: 10:00 on the next banking day', () => {
    expect(arrives('2026-09-25', '17:00')).toBe('Mon 10:00')
    expect(arrives('2026-09-25', '23:30')).toBe('Mon 10:00')
    expect(arrives('2026-09-26', '10:00')).toBe('Mon 10:00') // Saturday
    expect(arrives('2026-09-27', '23:00')).toBe('Mon 10:00') // Sunday
    expect(arrives('2026-09-24', '18:00')).toBe('Fri 10:00') // Thursday evening
    expect(arrives('2026-09-28', '06:00')).toBe('Mon 10:00') // before the banks open
    expect(arrives('2026-09-28', '07:59')).toBe('Mon 10:00')
  })

  it('keeps the local time across the change of clocks (Friday 23 Oct 16:30 arrives Monday 26 Oct 10:00)', () => {
    const t = bankTransferArrival(config, 'SI', at('2026-10-23', '16:30'))
    expect(t).toBe(at('2026-10-26', '10:00'))
    expect(new Date(t).toISOString()).toBe('2026-10-26T09:00:00.000Z')
    expect(bankTransferArrival(config, 'SI', at('2027-03-26', '16:30'))).toBe(at('2027-03-29', '10:00'))
  })

  it('Busan has its own hours (Monday to Friday 09:00 to 16:00, Asia/Seoul)', () => {
    const kr = config.bankingHours.KR
    const seoul = (date: string, time: string) => resolveLocal(date, time, kr.tz)
    const back = (t: SimTime) => `${formatWeekday(t, kr.tz)} ${formatTime(t, kr.tz)}`
    expect(back(bankTransferArrival(config, 'KR', seoul('2026-09-25', '09:30')))).toBe('Fri 11:30')
    expect(back(bankTransferArrival(config, 'KR', seoul('2026-09-25', '14:30')))).toBe('Mon 10:00')
    expect(back(bankTransferArrival(config, 'KR', seoul('2026-09-26', '11:00')))).toBe('Mon 10:00')
  })

  it('decide gets the rule from the node: decideCtx carries it', () => {
    const ctx = decideCtx(config, at('2026-09-25', '16:30'))
    expect(ctx.bankArrival?.('SI', ctx.now)).toBe(at('2026-09-28', '10:00'))
  })

  it('a bank transfer asked for late on Friday waits for Monday: the scheduler pays it in then', () => {
    const h = headless('2026-09-25')
    h.node.clock.jumpTo(at('2026-09-25', '16:30'))
    run(h, topUp('bank-transfer', 50))
    expect(ramp(h).arrivesAt).toBe(at('2026-09-28', '10:00'))
    h.node.advanceTo(at('2026-09-27', '12:00'), 'timer')
    expect(ramp(h).status).toBe('pending')
    h.node.advanceTo(at('2026-09-28', '10:00'), 'timer')
    expect(ramp(h).status).toBe('completed')
    h.node.settleDue()
    expect(bal(h.node.getState(), 'ana')).toBe('302.50')
  })
})

describe('ramp.off: cash out to the bank, the converter pays 1.5 %', () => {
  it('110.00 costs 1.65 and pays out ≈ €98.50', () => {
    const h = headless('2026-09-25')
    const events = run(h, cashOut('110.00'))
    expect(events.map((e) => e.type)).toEqual(['tx.submitted', 'ramp.completed'])
    const tx = txOf(events)
    expect(tx).toMatchObject({
      kind: 'off-ramp',
      channel: 'auto',
      from: 'ana',
      to: 'sys:issuance',
      amount: 11000,
      rampId: 'RP-000001',
    })
    expect(tx.fee).toMatchObject({
      policy: 'off-ramp',
      fee: 165,
      payer: 'sender',
      senderDebit: 11000,
      recipientCredit: 10835,
      eurOut: 9850,
    })
    expect(ramp(h)).toMatchObject({
      direction: 'off',
      persona: 'ana',
      eur: 9850,
      amount: 11000,
      fee: 165,
      status: 'completed',
      txId: tx.id,
    })
    expect(cashOutRef(tx.id)).toMatch(/^BC-OUT-[0-9A-Z]{6}$/)
    // Held while pending: the funds are no longer available.
    expect(h.node.getState().balances.ana).toMatchObject({ confirmed: 24750, held: 11000 })
    h.node.settleDue()
    const s = h.node.getState()
    expect(bal(s, 'ana')).toBe('137.50')
    expect(
      formatHundredths(
        (s.balances['sys:fees']?.confirmed ?? 0) - (h.node.seedState().balances['sys:fees']?.confirmed ?? 0),
      ),
    ).toBe('1.65')
    expect(invariants(s)).toEqual([])
  })

  it('the minimum 1.10 costs 0.02 and pays out ≈ €0.98; below it is refused', () => {
    const h = headless('2026-09-25')
    const tx = txOf(run(h, cashOut('1.10')))
    expect(tx.fee).toMatchObject({ fee: 2, eurOut: 98 })
    expect(refusal(h, cashOut('1.09'))).toEqual({ code: 'invalid-amount', min: m('1.10') })
    expect(refusal(h, cashOut(0))).toEqual({ code: 'invalid-amount' })
    expect(refusal(h, cashOut(Number.NaN))).toEqual({ code: 'invalid-amount' })
    expect(refusal(h, cashOut(-110))).toEqual({ code: 'invalid-amount' })
  })

  it('the café converts 143.00 (fee 2.15, ≈ €128.05) and 144.00 (fee 2.16, ≈ €128.95)', () => {
    const a = headless('2026-09-25')
    const t1 = txOf(run(a, cashOut('143.00', 'cafe')))
    expect(t1.fee).toMatchObject({ fee: 215, eurOut: 12805 })
    const b = headless('2026-09-25')
    const t2 = txOf(run(b, cashOut('144.00', 'cafe')))
    expect(t2.fee).toMatchObject({ fee: 216, eurOut: 12895 })
  })

  it('more than is available is refused with the shortfall; the whole balance can go (Max)', () => {
    const h = headless('2026-09-25')
    expect(refusal(h, cashOut('247.51'))).toEqual({ code: 'insufficient-funds', have: m('247.50'), short: m('0.01') })
    const tx = txOf(run(h, cashOut('247.50')))
    expect(tx.fee).toMatchObject({ fee: 371, eurOut: 22163 })
    h.node.settleDue()
    expect(bal(h.node.getState(), 'ana')).toBe('0.00')
    expect(invariants(h.node.getState())).toEqual([])
  })

  it('funds already on their way out are not available again', () => {
    const h = headless('2026-09-25')
    run(h, cashOut('200.00'))
    expect(refusal(h, cashOut('100.00'))).toMatchObject({ code: 'insufficient-funds', have: m('47.50') })
  })

  it('refuses an account without a bank on file, an unknown actor; a repeat is a duplicate', () => {
    const h = headless('2026-09-25')
    expect(refusal(h, cashOut('10.00', 'bakery'))).toEqual({ code: 'not-allowed' })
    expect(refusal(h, cashOut('10.00', 'nobody'))).toEqual({ code: 'not-allowed' })
    const c = cashOut('10.00')
    run(h, c)
    expect(refusal(h, c)).toEqual({ code: 'duplicate' })
  })

  it('an account whose bank is not on file cannot cash out (crafted state)', () => {
    const seed = buildSeed(content, '2026-09-25')
    const ana = seed.state.directory.ana
    if (!ana) throw new Error('ana')
    const noBank: LedgerState = {
      ...seed.state,
      directory: { ...seed.state.directory, ana: { ...ana, methods: { card: true, bank: false } } },
    }
    const h = headless('2026-09-25')
    h.node.loadSession({ seed: noBank, t0: seed.t0, state: noBank, events: [], log: [], clock: seed.t0 })
    expect(refusal(h, cashOut('10.00'))).toEqual({ code: 'not-allowed' })
  })
})

describe('the log form of a ramp', () => {
  it('ramp.on stores the method and the whole euros; ramp.off the amount', () => {
    const h = headless('2026-09-25')
    const s = h.node.getState()
    const on = topUp('bank-transfer', 50)
    const off = cashOut('110.00')
    const w1 = encodeCommand(s, on)
    const w2 = encodeCommand(s, off)
    expect(w1).toEqual({ ok: true, value: { type: 'ramp.on', method: 'bank-transfer', eur: 50 } })
    expect(w2).toEqual({ ok: true, value: { type: 'ramp.off', amount: '110.00' } })
    if (!w1.ok || !w2.ok) return
    expect(checkWireCommand(w1.value)).toBeNull()
    expect(checkWireCommand(w2.value)).toBeNull()
    expect(decodeCommand(s, content, { actor: 'ana', cmdId: on.cmdId, cmd: w1.value })).toEqual({ ok: true, value: on })
    expect(decodeCommand(s, content, { actor: 'ana', cmdId: off.cmdId, cmd: w2.value })).toEqual({
      ok: true,
      value: off,
    })
    expect(checkWireCommand({ type: 'ramp.on', method: 'cheque' as never, eur: 5 })).not.toBeNull()
    expect(checkWireCommand({ type: 'ramp.on', method: 'card', eur: 0 })).not.toBeNull()
    expect(instantOfAt('2026-09-25', { day: 0, time: '12:15:00.000' })).toBe(h.node.now())
  })
})
