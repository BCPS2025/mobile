import { describe, expect, it } from 'vitest'
import { maxSendable } from '@domain/fees'
import { decide, maxPayable } from '@domain/ledger'
import type { AccountId, Command, LedgerState, Minor, SimTime } from '@domain/types'
import { encodePaymentUri, parsePaymentUri } from '@domain/uri'
import { buildSeed, simConfigFrom } from '@sim/seed'
import { quoteFor } from '@store/selectors'
import { EPOCH, content, m } from './helpers'

// Regression tests for the engine review findings.

const seed = buildSeed(content, EPOCH)
const config = simConfigFrom(content)
type PayCommand = Extract<Command, { type: 'pay' }>

/** A pay command whose expected debit is whatever decide computes (quotes are tested elsewhere). */
function decidePay(s: LedgerState, c: Omit<PayCommand, 'type' | 'cmdId' | 'expect'>) {
  const quote = quoteFor(s, s.handles[c.to] ?? '', c.channel, c.amount)
  const expect = { senderDebit: (quote?.senderDebit ?? c.amount) as Minor }
  return decide(s, { type: 'pay', cmdId: '0000000000000001:review', expect, ...c } as PayCommand, {
    now: seed.t0 as SimTime,
  })
}

function withCafePayer(feePayer: 'sender' | 'recipient'): LedgerState {
  const cafe = seed.state.merchant.cafe
  if (!cafe) throw new Error('seed has no cafe merchant settings')
  return { ...seed.state, merchant: { ...seed.state.merchant, cafe: { ...cafe, feePayer } } }
}

function withBalance(s: LedgerState, a: AccountId, confirmed: Minor): LedgerState {
  return { ...s, balances: { ...s.balances, [a]: { confirmed, held: 0 as Minor } } }
}

describe('Max button', () => {
  it('maxSendable honours the per-merchant payer override (sender pays: amount + 1 % <= available)', () => {
    expect(maxSendable(m('247.50'), config.fees.merchant, config.rate, 'sender')).toBe(m('245.05'))
    expect(maxSendable(m('247.50'), config.fees.merchant, config.rate, 'recipient')).toBe(m('247.50'))
  })

  it('no minimum: tiny balances can always be sent in full up to where the 1 % fee starts', () => {
    expect(maxSendable(m('0.01'), config.fees.merchant, config.rate)).toBe(m('0.01'))
    expect(maxSendable(m('0.06'), config.fees.merchant, config.rate)).toBe(m('0.06'))
    expect(maxSendable(m('0.01'), config.fees.transfer, config.rate)).toBe(m('0.01'))
    expect(maxSendable(m('0.50'), config.fees.transfer, config.rate)).toBe(m('0.49'))
    expect(maxSendable(m('0.51'), config.fees.transfer, config.rate)).toBe(m('0.50'))
    expect(maxSendable(0 as Minor, config.fees.transfer, config.rate)).toBe(0)
  })

  it('maxPayable resolves policy and override like decide, which accepts it and rejects one more', () => {
    for (const payer of ['sender', 'recipient'] as const) {
      const s = withCafePayer(payer)
      const max = maxPayable(s, 'ana', '@cafelipa', 'qr')
      expect(max).toBe(payer === 'sender' ? m('245.05') : m('247.50'))
      expect(decidePay(s, { actor: 'ana', to: '@cafelipa', amount: max, channel: 'qr' }).ok).toBe(true)
      const over = decidePay(s, { actor: 'ana', to: '@cafelipa', amount: (max + 1) as Minor, channel: 'qr' })
      expect(!over.ok && over.error.code).toBe('insufficient-funds')
    }
    const poor = withBalance(seed.state, 'ana', m('0.05'))
    expect(maxPayable(poor, 'ana', '@cafelipa', 'qr')).toBe(m('0.05'))
    expect(decidePay(poor, { actor: 'ana', to: '@cafelipa', amount: m('0.05'), channel: 'qr' }).ok).toBe(true)
    expect(maxPayable(withBalance(seed.state, 'ana', 0 as Minor), 'ana', '@cafelipa', 'qr')).toBe(0)
    expect(maxPayable(seed.state, 'ana', '@nobody_here', 'qr')).toBe(0)
  })
})

describe('pay items guard', () => {
  const base = { actor: 'ana' as const, to: '@cafelipa' as const, amount: m('11.00'), channel: 'qr' as const }
  it.each([
    [
      'negative price',
      [
        { name: 'a', qty: 1, price: 2000 },
        { name: 'b', qty: 1, price: -900 },
      ],
    ],
    [
      'negative qty',
      [
        { name: 'a', qty: 2, price: 600 },
        { name: 'b', qty: -1, price: 100 },
      ],
    ],
    ['fractional qty', [{ name: 'a', qty: 0.5, price: 2200 }]],
    [
      'zero qty',
      [
        { name: 'a', qty: 0, price: 5 },
        { name: 'b', qty: 1, price: 1100 },
      ],
    ],
    [
      'zero price',
      [
        { name: 'a', qty: 1, price: 0 },
        { name: 'b', qty: 1, price: 1100 },
      ],
    ],
    [
      'fractional price',
      [
        { name: 'a', qty: 2, price: 550.5 },
        { name: 'b', qty: 1, price: -1 },
      ],
    ],
  ])('%s is invalid-amount', (_label, items) => {
    const r = decidePay(seed.state, { ...base, items: items as PayCommand['items'] })
    expect(!r.ok && r.error.code).toBe('invalid-amount')
  })

  it('well-formed items that add up are accepted', () => {
    const items = [
      { name: 'Flat white', qty: 2, price: 330 },
      { name: 'Croissant', qty: 2, price: 220 },
    ]
    expect(decidePay(seed.state, { ...base, items: items as PayCommand['items'] }).ok).toBe(true)
  })
})

describe('encodePaymentUri amount guard', () => {
  const base = 'https://x.example/app/'
  it.each([0, -1, -1100, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('throws for amount %s', (amount) => {
    expect(() => encodePaymentUri({ v: 1, to: '@cafelipa', amount: amount as Minor }, base)).toThrow()
  })

  it.each([1, 99, 100, 1100, 110_000, 123_456_789])('round-trips amount %s', (amount) => {
    const uri = { v: 1 as const, to: '@cafelipa' as const, amount: amount as Minor }
    expect(parsePaymentUri(encodePaymentUri(uri, base))).toEqual({ ok: true, value: uri })
  })

  it('an absent amount is still allowed', () => {
    expect(encodePaymentUri({ v: 1, to: '@cafelipa' }, base)).toBe(`${base}#/pay?v=1&to=@cafelipa`)
  })
})
