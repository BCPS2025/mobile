import { asMinor, ceilDiv, divRoundHalfUp } from './money'
import { approxEur, eurToMinor } from './rate'
import type { CardRange, FeePayer, FeePolicy, FeePolicyId, FeeQuote, Minor, Rate, Result } from './types'

// Fee engine (decision D29): a percent fee in the network (1 %, no minimum), a percent
// conversion fee on the off-ramp (1.5 %), and zero-fee policies. A flat kind (EUR cents
// converted at the rate) is still supported. Integer maths only.

export interface CardRangeBps {
  lowBps: number
  highBps: number
}
export const DEFAULT_CARD_RANGE: CardRangeBps = { lowBps: 150, highBps: 300 }

/** Policies whose fee comes out of the converted amount (cash-out and auto-convert). */
export const isConversionPolicy = (id: FeePolicyId | null): boolean => id === 'off-ramp'

/** Flat fee in BCPS hundredths: round half-up of flatEurCents × bcps / eur. 10 -> 11. */
export function flatMinor(flatEurCents: number, rate: Rate): Minor {
  return eurToMinor(flatEurCents, rate)
}

/** Percent fee, round half-up: (2 × amount × bps + 10000) div 20000. 1100 at 100 bps -> 11. */
export function percentFee(amount: Minor, bps: number): Minor {
  return asMinor(divRoundHalfUp(amount * bps, 10_000))
}

/** The fee a policy charges on one payment of `amount`. */
export function feeOf(amount: Minor, p: FeePolicy, rate: Rate): Minor {
  switch (p.kind) {
    case 'flat':
      return flatMinor(p.flatEurCents, rate)
    case 'percent':
      return percentFee(amount, p.rateBps)
    case 'zero':
      return asMinor(0)
  }
}

/**
 * The fee of a daily summary row (seeded sales days, background slots): a percent policy
 * takes its percentage of the row's gross, rounded once; a flat policy charges count × the fee.
 */
export function summaryFee(count: number, gross: Minor, p: FeePolicy, rate: Rate): Minor {
  switch (p.kind) {
    case 'flat':
      return asMinor(count * flatMinor(p.flatEurCents, rate))
    case 'percent':
      return percentFee(gross, p.rateBps)
    case 'zero':
      return asMinor(0)
  }
}

/** Smallest BCPS amount whose card comparison is shown: ceilDiv(eurCents × bcps, eur). 500 -> 550. */
export function cardCompareMinMinor(minEurCents: number, rate: Rate): number {
  return ceilDiv(minEurCents * rate.bcps, rate.eur)
}

/** Card range for a BCPS amount: computed in EUR cents from the ≈ € amount. */
export function cardRange(amount: Minor, rate: Rate, bps: CardRangeBps = DEFAULT_CARD_RANGE): CardRange {
  const eur = approxEur(amount, rate)
  return {
    lowEurCents: divRoundHalfUp(eur * bps.lowBps, 10_000),
    highEurCents: divRoundHalfUp(eur * bps.highBps, 10_000),
  }
}

/**
 * The largest amount a quote accepts: every product in a fee or card-range computation stays a
 * safe integer (percent fees multiply by up to 10,000). Far above any payment limit.
 */
export const MAX_QUOTE_AMOUNT = Math.floor(Number.MAX_SAFE_INTEGER / 100_000)

/**
 * Quote the fee for a payment of `amount` under policy `p`.
 * - percent or flat in the network: the sender pays on top, or the recipient receives the
 *   amount less the fee (policy default, or the override from a merchant setting or snapshot).
 *   With a percent fee below 100 % no amount is at or below its own fee; a recipient-paid flat
 *   fee that would take the whole amount is `invalid-amount`.
 * - conversion (off-ramp): the converter pays out of the amount; eurOut is the ≈ € of the remainder.
 * - zero: no fee.
 * Amounts that are not positive integers up to MAX_QUOTE_AMOUNT are `invalid-amount`.
 */
export function quoteFee(
  amount: Minor,
  p: FeePolicy,
  rate: Rate,
  payerOverride?: FeePayer,
  cardBps: CardRangeBps = DEFAULT_CARD_RANGE,
): Result<FeeQuote, 'invalid-amount'> {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_QUOTE_AMOUNT) {
    return { ok: false, error: 'invalid-amount' }
  }
  if (p.kind === 'zero') {
    return {
      ok: true,
      value: { policy: p.id, fee: asMinor(0), payer: null, rule: 'zero', senderDebit: amount, recipientCredit: amount },
    }
  }
  const fee = feeOf(amount, p, rate)
  if (isConversionPolicy(p.id)) {
    if (fee >= amount) return { ok: false, error: 'invalid-amount' }
    const remainder = asMinor(amount - fee)
    return {
      ok: true,
      value: {
        policy: p.id,
        fee,
        payer: 'sender',
        rule: p.kind,
        senderDebit: amount,
        recipientCredit: remainder,
        eurOut: approxEur(remainder, rate),
      },
    }
  }
  const payer = payerOverride ?? p.payer
  if (payer === 'recipient' && fee >= amount) return { ok: false, error: 'invalid-amount' }
  const quote: FeeQuote = {
    policy: p.id,
    fee,
    payer,
    rule: p.kind,
    senderDebit: asMinor(payer === 'sender' ? amount + fee : amount),
    recipientCredit: asMinor(payer === 'recipient' ? amount - fee : amount),
  }
  if (p.cardCompareMinMinor !== null && amount >= p.cardCompareMinMinor) {
    quote.card = cardRange(amount, rate, cardBps)
  }
  return { ok: true, value: quote }
}

/**
 * Largest amount the Max button offers from `available`, resolving the payer the same way
 * as quoteFee (per-merchant override first).
 * - sender pays: the largest amount with amount + fee(amount) <= available (Ana's 247.50 at
 *   1 % -> 245.05, fee 2.45); amount + fee is strictly increasing, so the answer is unique.
 * - recipient pays, conversions and zero-fee policies: the full balance (0 when a flat
 *   recipient-paid fee would take all of it).
 */
export function maxSendable(available: Minor, p: FeePolicy, rate: Rate, payerOverride?: FeePayer): Minor {
  if (!Number.isSafeInteger(available) || available <= 0) return asMinor(0)
  if (p.kind === 'zero' || isConversionPolicy(p.id)) return available
  const payer = payerOverride ?? p.payer
  if (payer === 'recipient') return feeOf(available, p, rate) >= available ? asMinor(0) : available
  if (p.kind === 'flat') return asMinor(Math.max(0, available - flatMinor(p.flatEurCents, rate)))
  const total = (a: number) => a + percentFee(a as Minor, p.rateBps)
  let a = Math.floor((available * 10_000) / (10_000 + p.rateBps))
  while (total(a + 1) <= available) a += 1
  while (a > 0 && total(a) > available) a -= 1
  return asMinor(a)
}
