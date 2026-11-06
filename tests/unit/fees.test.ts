import { describe, expect, it } from 'vitest'
import {
  MAX_QUOTE_AMOUNT,
  cardCompareMinMinor,
  feeOf,
  flatMinor,
  maxSendable,
  percentFee,
  quoteFee,
  summaryFee,
} from '@domain/fees'
import { divRoundHalfUp, formatHundredths, mustParseEurCents } from '@domain/money'
import { approxEur, eurToMinor } from '@domain/rate'
import type { FeePayer, FeePolicy, FeePolicyId, Minor, Rate } from '@domain/types'
import { simConfigFrom } from '@sim/seed'
import { content, m } from './helpers'

const config = simConfigFrom(content)
const rate: Rate = config.rate
const P = config.fees

describe('rate and approx-EUR rule', () => {
  it('uses the integer ratio 11:10', () => {
    expect(rate).toEqual({ bcps: 11, eur: 10 })
  })

  it('≈ € = (2 × minor × 10 + 11) div 22', () => {
    for (let minor = 0; minor <= 200_000; minor += 7) {
      expect(approxEur(minor as Minor, rate)).toBe(Math.floor((2 * minor * 10 + 11) / 22))
    }
  })

  it.each([
    ['247.50', '225.00'],
    ['132.98', '120.89'],
    ['286.00', '260.00'],
    ['1,254.00', '1,140.00'],
    ['12,100.00', '11,000.00'],
    ['880.00', '800.00'],
    ['11.00', '10.00'],
    ['5.50', '5.00'],
    ['5.49', '4.99'],
    ['0.11', '0.10'],
    ['0.17', '0.15'],
    ['0.39', '0.35'],
    ['3.30', '3.00'],
  ])('%s BCPS ≈ €%s', (bcps, eur) => {
    expect(formatHundredths(approxEur(m(bcps), rate))).toBe(eur)
  })

  it('EUR -> BCPS for top-ups', () => {
    expect(eurToMinor(mustParseEurCents('50.00'), rate)).toBe(5500)
    expect(eurToMinor(mustParseEurCents('121.00'), rate)).toBe(13310)
  })
})

describe('fee policies (decision D29)', () => {
  it('1 % in the network, 1.5 % to convert, zero on releases, refunds and top-ups', () => {
    for (const id of ['merchant', 'web-checkout', 'subscription', 'transfer', 'escrow-lock'] as const) {
      expect(P[id]).toMatchObject({ kind: 'percent', rateBps: 100 })
    }
    expect(P['off-ramp']).toMatchObject({ kind: 'percent', rateBps: 150, payer: 'sender' })
    for (const id of ['escrow-release', 'refund', 'on-ramp'] as const) expect(P[id].kind).toBe('zero')
  })

  it('the merchant pays on sales by default; the sender pays on transfers and escrow locks', () => {
    for (const id of ['merchant', 'web-checkout', 'subscription'] as const)
      expect(P[id]).toMatchObject({ payer: 'recipient' })
    for (const id of ['transfer', 'escrow-lock'] as const) expect(P[id]).toMatchObject({ payer: 'sender' })
  })

  it('card threshold is ceilDiv(500 × 11, 10) = 550 on the three merchant policies only', () => {
    expect(cardCompareMinMinor(500, rate)).toBe(550)
    for (const id of ['merchant', 'web-checkout', 'subscription'] as const) {
      const p = P[id]
      expect(p.kind !== 'zero' && p.cardCompareMinMinor).toBe(550)
    }
    for (const id of ['transfer', 'escrow-lock', 'off-ramp'] as const) {
      const p = P[id]
      expect(p.kind !== 'zero' && p.cardCompareMinMinor).toBeNull()
    }
  })

  it.each([
    ['11.00', '0.11'],
    ['8.80', '0.09'],
    ['5.50', '0.06'],
    ['16.50', '0.17'],
    ['13.20', '0.13'],
    ['1.10', '0.01'],
    ['1,100.00', '11.00'],
    ['5,280.00', '52.80'],
    ['0.50', '0.01'],
    ['0.49', '0.00'],
  ])('1 %% of %s is %s (round half-up, no minimum)', (amount, fee) => {
    expect(formatHundredths(feeOf(m(amount), P.transfer, rate))).toBe(fee)
  })
})

// The fee unit table (D29): amount, policy, payer override, fee, sender debit,
// recipient credit, card range.
type Row = {
  amount: string
  policy: FeePolicyId
  override?: FeePayer
  fee: string
  payer: FeePayer | null
  debit: string
  credit: string
  card?: [string, string] | null
}
const table: Row[] = [
  {
    amount: '11.00',
    policy: 'merchant',
    fee: '0.11',
    payer: 'recipient',
    debit: '11.00',
    credit: '10.89',
    card: ['0.15', '0.30'],
  },
  {
    amount: '13.20',
    policy: 'merchant',
    fee: '0.13',
    payer: 'recipient',
    debit: '13.20',
    credit: '13.07',
    card: ['0.18', '0.36'],
  },
  {
    amount: '13.20',
    policy: 'merchant',
    override: 'sender',
    fee: '0.13',
    payer: 'sender',
    debit: '13.33',
    credit: '13.20',
    card: ['0.18', '0.36'],
  },
  {
    amount: '5.50',
    policy: 'web-checkout',
    fee: '0.06',
    payer: 'recipient',
    debit: '5.50',
    credit: '5.44',
    card: ['0.08', '0.15'],
  },
  { amount: '5.49', policy: 'merchant', fee: '0.05', payer: 'recipient', debit: '5.49', credit: '5.44', card: null },
  { amount: '3.30', policy: 'merchant', fee: '0.03', payer: 'recipient', debit: '3.30', credit: '3.27', card: null },
  { amount: '2.20', policy: 'merchant', fee: '0.02', payer: 'recipient', debit: '2.20', credit: '2.18', card: null },
  {
    amount: '1.10',
    policy: 'web-checkout',
    fee: '0.01',
    payer: 'recipient',
    debit: '1.10',
    credit: '1.09',
    card: null,
  },
  { amount: '0.50', policy: 'merchant', fee: '0.01', payer: 'recipient', debit: '0.50', credit: '0.49', card: null },
  { amount: '0.49', policy: 'merchant', fee: '0.00', payer: 'recipient', debit: '0.49', credit: '0.49', card: null },
  { amount: '0.01', policy: 'merchant', fee: '0.00', payer: 'recipient', debit: '0.01', credit: '0.01', card: null },
  {
    amount: '11.00',
    policy: 'subscription',
    fee: '0.11',
    payer: 'recipient',
    debit: '11.00',
    credit: '10.89',
    card: ['0.15', '0.30'],
  },
  { amount: '16.50', policy: 'transfer', fee: '0.17', payer: 'sender', debit: '16.67', credit: '16.50', card: null },
  { amount: '8.80', policy: 'transfer', fee: '0.09', payer: 'sender', debit: '8.89', credit: '8.80', card: null },
  { amount: '13.20', policy: 'transfer', fee: '0.13', payer: 'sender', debit: '13.33', credit: '13.20', card: null },
  { amount: '52.80', policy: 'transfer', fee: '0.53', payer: 'sender', debit: '53.33', credit: '52.80', card: null },
  { amount: '220.00', policy: 'transfer', fee: '2.20', payer: 'sender', debit: '222.20', credit: '220.00', card: null },
  {
    amount: '1,100.00',
    policy: 'transfer',
    fee: '11.00',
    payer: 'sender',
    debit: '1,111.00',
    credit: '1,100.00',
    card: null,
  },
  {
    amount: '5,280.00',
    policy: 'escrow-lock',
    fee: '52.80',
    payer: 'sender',
    debit: '5,332.80',
    credit: '5,280.00',
    card: null,
  },
  {
    amount: '1,584.00',
    policy: 'escrow-release',
    fee: '0.00',
    payer: null,
    debit: '1,584.00',
    credit: '1,584.00',
    card: null,
  },
  {
    amount: '3,696.00',
    policy: 'escrow-release',
    fee: '0.00',
    payer: null,
    debit: '3,696.00',
    credit: '3,696.00',
    card: null,
  },
  { amount: '26.40', policy: 'refund', fee: '0.00', payer: null, debit: '26.40', credit: '26.40', card: null },
  { amount: '11.00', policy: 'refund', fee: '0.00', payer: null, debit: '11.00', credit: '11.00', card: null },
  { amount: '55.00', policy: 'on-ramp', fee: '0.00', payer: null, debit: '55.00', credit: '55.00', card: null },
  { amount: '110.00', policy: 'off-ramp', fee: '1.65', payer: 'sender', debit: '110.00', credit: '108.35', card: null },
  { amount: '143.00', policy: 'off-ramp', fee: '2.15', payer: 'sender', debit: '143.00', credit: '140.85', card: null },
  { amount: '144.00', policy: 'off-ramp', fee: '2.16', payer: 'sender', debit: '144.00', credit: '141.84', card: null },
  { amount: '220.00', policy: 'off-ramp', fee: '3.30', payer: 'sender', debit: '220.00', credit: '216.70', card: null },
  { amount: '600.00', policy: 'off-ramp', fee: '9.00', payer: 'sender', debit: '600.00', credit: '591.00', card: null },
  { amount: '1.10', policy: 'off-ramp', fee: '0.02', payer: 'sender', debit: '1.10', credit: '1.08', card: null },
  { amount: '0.34', policy: 'off-ramp', fee: '0.01', payer: 'sender', debit: '0.34', credit: '0.33', card: null },
  { amount: '0.33', policy: 'off-ramp', fee: '0.00', payer: 'sender', debit: '0.33', credit: '0.33', card: null },
]

describe('fee unit table', () => {
  it.each(table)('$amount $policy $override -> fee $fee', (row) => {
    const r = quoteFee(m(row.amount), P[row.policy], rate, row.override)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const q = r.value
    expect(formatHundredths(q.fee)).toBe(row.fee)
    expect(q.payer).toBe(row.payer)
    expect(q.policy).toBe(row.policy)
    expect(formatHundredths(q.senderDebit)).toBe(row.debit)
    expect(formatHundredths(q.recipientCredit)).toBe(row.credit)
    if (row.card) {
      expect(q.card).toBeDefined()
      expect(formatHundredths(q.card?.lowEurCents ?? -1)).toBe(row.card[0])
      expect(formatHundredths(q.card?.highEurCents ?? -1)).toBe(row.card[1])
    } else {
      expect(q.card).toBeUndefined()
    }
  })

  it.each([
    ['11.00', '0.10'],
    ['13.20', '0.12'],
    ['5.50', '0.05'],
    ['8.80', '0.08'],
    ['16.50', '0.15'],
    ['1,100.00', '10.00'],
    ['5,280.00', '48.00'],
  ])('the fee on %s shows as ≈ €%s', (amount, eur) => {
    const r = quoteFee(m(amount), P.transfer, rate)
    expect(r.ok && formatHundredths(approxEur(r.value.fee, rate))).toBe(eur)
  })

  it.each([
    ['110.00', '98.50'],
    ['143.00', '128.05'],
    ['144.00', '128.95'],
    ['220.00', '197.00'],
    ['600.00', '537.27'],
    ['1.10', '0.98'],
  ])('off-ramp %s pays out ≈ €%s', (amount, eur) => {
    const r = quoteFee(m(amount), P['off-ramp'], rate)
    expect(r.ok && formatHundredths(r.value.eurOut ?? -1)).toBe(eur)
  })

  it('on-ramp €50.00 credits 55.00 with no fee', () => {
    const credit = eurToMinor(mustParseEurCents('50.00'), rate)
    const r = quoteFee(credit, P['on-ramp'], rate)
    expect(r.ok && r.value.fee).toBe(0)
    expect(r.ok && formatHundredths(r.value.recipientCredit)).toBe('55.00')
  })

  it('no minimum: every positive amount is accepted, whoever pays, and credits more than zero', () => {
    for (const id of ['merchant', 'web-checkout', 'subscription', 'transfer', 'escrow-lock', 'off-ramp'] as const) {
      for (const payer of ['sender', 'recipient'] as const) {
        for (let a = 1; a <= 2_000; a++) {
          const r = quoteFee(a as Minor, P[id], rate, payer)
          expect(r.ok).toBe(true)
          if (r.ok) expect(r.value.recipientCredit).toBeGreaterThan(0)
        }
      }
    }
  })

  it('zero or negative amounts are rejected', () => {
    expect(quoteFee(0 as Minor, P.transfer, rate)).toEqual({ ok: false, error: 'invalid-amount' })
    expect(quoteFee(-5 as Minor, P.transfer, rate).ok).toBe(false)
  })

  it('percent fee formula: (2 × amount × bps + 10000) div 20000', () => {
    for (let a = 0; a < 100_000; a += 13) {
      expect(percentFee(a as Minor, 100)).toBe(Math.floor((2 * a * 100 + 10000) / 20000))
      expect(percentFee(a as Minor, 150)).toBe(Math.floor((2 * a * 150 + 10000) / 20000))
    }
  })

  it('summary rows: 1 % of the gross, rounded once per row', () => {
    expect(formatHundredths(summaryFee(48, m('334.58'), P.merchant, rate))).toBe('3.35')
    expect(formatHundredths(summaryFee(23, m('111.38'), P.merchant, rate))).toBe('1.11')
    expect(formatHundredths(summaryFee(41, m('150.70'), P['web-checkout'], rate))).toBe('1.51')
  })
})

describe('Max button', () => {
  it('sender pays: the largest amount with amount + 1 % <= available (Ana from fresh: 245.05)', () => {
    expect(maxSendable(m('247.50'), P.transfer, rate)).toBe(m('245.05'))
    expect(formatHundredths(percentFee(m('245.05'), 100))).toBe('2.45')
  })

  it('is exact for every balance up to 30.00 and a spread of larger ones', () => {
    const check = (avail: number) => {
      const max = maxSendable(avail as Minor, P.transfer, rate)
      expect(max + percentFee(max, 100)).toBeLessThanOrEqual(avail)
      expect(max + 1 + percentFee((max + 1) as Minor, 100)).toBeGreaterThan(avail)
    }
    for (let a = 1; a <= 3_000; a++) check(a)
    for (let a = 3_000; a <= 10_000_000; a += 9_973) check(a)
  })

  it('recipient pays, conversions and zero-fee policies: the full balance', () => {
    expect(maxSendable(m('247.50'), P.merchant, rate)).toBe(m('247.50'))
    expect(maxSendable(m('0.01'), P.merchant, rate)).toBe(m('0.01'))
    expect(maxSendable(m('286.00'), P['off-ramp'], rate)).toBe(m('286.00'))
    expect(maxSendable(m('5.00'), P.refund, rate)).toBe(m('5.00'))
    expect(maxSendable(0 as Minor, P.transfer, rate)).toBe(0)
  })
})

describe('a flat policy (supported by the engine, unused by the D29 config)', () => {
  const flat = (payer: FeePayer): FeePolicy => ({
    id: 'transfer',
    kind: 'flat',
    flatEurCents: 10,
    payer,
    cardCompareMinMinor: null,
  })

  it('flatEurCents 10 -> 0.11 BCPS, on top or out of the amount', () => {
    expect(flatMinor(10, rate)).toBe(11)
    const sender = quoteFee(m('8.80'), flat('sender'), rate)
    expect(sender.ok && [sender.value.fee, sender.value.senderDebit, sender.value.rule]).toEqual([11, 891, 'flat'])
    const recipient = quoteFee(m('8.80'), flat('recipient'), rate)
    expect(recipient.ok && recipient.value.recipientCredit).toBe(869)
  })

  it('a recipient-paid amount at or below the fee is invalid-amount; Max follows', () => {
    expect(quoteFee(m('0.11'), flat('recipient'), rate)).toEqual({ ok: false, error: 'invalid-amount' })
    expect(quoteFee(m('0.12'), flat('recipient'), rate).ok).toBe(true)
    expect(maxSendable(m('0.11'), flat('recipient'), rate)).toBe(0)
    expect(maxSendable(m('0.12'), flat('sender'), rate)).toBe(m('0.01'))
    expect(formatHundredths(summaryFee(48, m('334.58'), flat('recipient'), rate))).toBe('5.28')
  })
})

describe('card threshold (kept at €5.00 = 5.50 BCPS)', () => {
  it('5.49 (≈ €4.99) hides the comparison', () => {
    const r = quoteFee(m('5.49'), P.merchant, rate)
    expect(r.ok && r.value.card).toBeUndefined()
  })
  it('5.50 (≈ €5.00) shows it', () => {
    const r = quoteFee(m('5.50'), P.merchant, rate)
    expect(r.ok && r.value.card).toEqual({ lowEurCents: 8, highEurCents: 15 })
  })
  it('never on transfers, escrow, conversions or large B2B amounts', () => {
    for (const id of ['transfer', 'escrow-lock', 'off-ramp'] as const) {
      const r = quoteFee(m('1,100.00'), P[id], rate)
      expect(r.ok && r.value.card).toBeUndefined()
    }
  })
})

describe('card guard', () => {
  const comparable = ['merchant', 'web-checkout', 'subscription'] as const

  it('for every amount from 5.50 to 99,999.99, ≈ €(1 % fee) < the card low end', () => {
    // Plain arithmetic over all 9,999,450 amounts (the same rules quoteFee uses, checked
    // against quoteFee on a sample below).
    const bps = P.merchant.kind === 'percent' ? P.merchant.rateBps : Number.NaN
    const low = config.cardRange.lowBps
    let failures = 0
    for (let a = 550; a <= 9_999_999; a++) {
      const feeEur = divRoundHalfUp(divRoundHalfUp(a * bps, 10_000) * rate.eur, rate.bcps)
      const cardLow = divRoundHalfUp(divRoundHalfUp(a * rate.eur, rate.bcps) * low, 10_000)
      if (feeEur >= cardLow) failures++
    }
    expect(failures).toBe(0)
  })

  it('agrees with quoteFee on every comparable policy (sampled)', () => {
    for (const id of comparable) {
      for (let a = 1; a <= 10_000_000; a += a < 3_000 ? 1 : 997) {
        const r = quoteFee(a as Minor, P[id], rate)
        expect(r.ok).toBe(true)
        if (!r.ok) continue
        if (a < 550) expect(r.value.card).toBeUndefined()
        else expect(approxEur(r.value.fee, rate)).toBeLessThan(r.value.card?.lowEurCents ?? -1)
      }
    }
  })

  it('holds for every catalogue item and template', () => {
    const catalogue = content.catalogue.products
    const items = [...(catalogue.cafe ?? []), ...(catalogue.studio ?? [])]
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      for (const id of comparable) {
        const r = quoteFee(m(item.price), P[id], rate)
        expect(r.ok).toBe(true)
        if (r.ok && r.value.card) expect(approxEur(r.value.fee, rate)).toBeLessThan(r.value.card.lowEurCents)
        // Items under 5.50 never show a comparison.
        if (m(item.price) < 550) expect(r.ok && r.value.card).toBeUndefined()
      }
    }
  })

  it('catalogue prices convert to the expected ≈ € figures', () => {
    const price = (sku: string) =>
      [...(content.catalogue.products.cafe ?? []), ...(content.catalogue.products.studio ?? [])].find(
        (i) => i.sku === sku,
      )?.price ?? ''
    expect(formatHundredths(approxEur(m(price('flat-white')), rate))).toBe('3.00')
    expect(formatHundredths(approxEur(m(price('aurora-wings')), rate))).toBe('1.00')
    expect(formatHundredths(approxEur(m(price('gem-pack-500')), rate))).toBe('5.00')
    expect(formatHundredths(approxEur(m(price('season-pass')), rate))).toBe('10.00')
  })
})

describe('quote bounds (found by the property test)', () => {
  it('amounts beyond the safe range are invalid-amount, never an exception', () => {
    const p = P.merchant as FeePolicy
    for (const bad of [Number.MAX_SAFE_INTEGER, 1e15, MAX_QUOTE_AMOUNT + 1]) {
      expect(quoteFee(bad as Minor, p, rate)).toEqual({ ok: false, error: 'invalid-amount' })
    }
    expect(quoteFee(MAX_QUOTE_AMOUNT as Minor, p, rate).ok).toBe(true)
    // Far above every payment limit (99,999.99).
    expect(MAX_QUOTE_AMOUNT).toBeGreaterThan(m('99999.99') * 1000)
  })
})
