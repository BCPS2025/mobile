import { asEurCents, asMinor, divRoundHalfUp } from './money'
import type { EurCents, Minor, Rate } from './types'

// The one conversion rule for every "≈ €" figure: round half-up of minor × eur / bcps.
// With the reference rate { bcps: 11, eur: 10 } this is (2 × minor × 10 + 11) div 22.

export function approxEur(minor: Minor, rate: Rate): EurCents {
  if (minor < 0) return asEurCents(-approxEur(asMinor(-minor), rate))
  return asEurCents(divRoundHalfUp(minor * rate.eur, rate.bcps))
}

/** EUR cents to BCPS hundredths, round half-up (top-up amounts). */
export function eurToMinor(eur: EurCents | number, rate: Rate): Minor {
  if (eur < 0) throw new Error('eurToMinor expects a non-negative amount')
  return asMinor(divRoundHalfUp(eur * rate.bcps, rate.eur))
}

export function assertRate(rate: Rate): void {
  if (!Number.isSafeInteger(rate.bcps) || !Number.isSafeInteger(rate.eur) || rate.bcps <= 0 || rate.eur <= 0) {
    throw new Error('Rate must be a ratio of positive integers')
  }
}
