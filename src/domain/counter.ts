import { asMinor, formatHundredths } from './money'
import { approxEur } from './rate'
import type { EurCents, LedgerState, Minor, Rate, Tx } from './types'

// Session counter: merchant, web-checkout and subscription payments whose card comparison
// is shown (same rule as the comparison itself), settled during the session (not seed rows).

export interface SessionCounter {
  count: number
  fees: Minor
  feesEur: EurCents
  cardLowEurCents: number
  cardHighEurCents: number
}

export function sessionCounter(txs: readonly Tx[], rate: Rate): SessionCounter {
  let count = 0
  let fees = 0
  let low = 0
  let high = 0
  for (const tx of txs) {
    if (tx.seed || tx.status !== 'confirmed' || !tx.fee.card) continue
    count += 1
    fees += tx.fee.fee
    low += tx.fee.card.lowEurCents
    high += tx.fee.card.highEurCents
  }
  const feesMinor = asMinor(fees)
  return { count, fees: feesMinor, feesEur: approxEur(feesMinor, rate), cardLowEurCents: low, cardHighEurCents: high }
}

export function sessionCounterOf(s: LedgerState): SessionCounter {
  const txs: Tx[] = []
  for (const id of s.txOrder) {
    const tx = s.txs[id]
    if (tx) txs.push(tx)
  }
  return sessionCounter(txs, s.config.rate)
}

/** Fill {placeholders} in a template; unknown placeholders are left as they are. */
export function fillTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const v = values[key]
    return v === undefined ? whole : String(v)
  })
}

/** Counter text, or null before the first counted payment. */
export function sessionCounterText(c: SessionCounter, template: string): string | null {
  if (c.count === 0) return null
  return fillTemplate(template, {
    count: c.count,
    fees: formatHundredths(c.fees),
    eur: formatHundredths(c.feesEur),
    cardLow: formatHundredths(c.cardLowEurCents),
    cardHigh: formatHundredths(c.cardHighEurCents),
  })
}
