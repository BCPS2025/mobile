import type { EurCents, Minor, Result } from './types'

// Integer-hundredths money helpers. Parsing is by string split, never by float.

const PLAIN = /^(\d+)(?:\.(\d{1,2}))?$/
const GROUPED = /^(\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/
const MAX_INTEGER_DIGITS = 12

export type ParseError = 'invalid-amount'

/** Parse a non-negative decimal amount ("12.40", "1,254.00", "8.8", "12") into hundredths. */
export function parseHundredths(raw: string): Result<number, ParseError> {
  const s = raw.trim()
  const m = PLAIN.exec(s) ?? GROUPED.exec(s)
  if (!m) return { ok: false, error: 'invalid-amount' }
  const whole = (m[1] ?? '').replaceAll(',', '')
  if (whole.length > MAX_INTEGER_DIGITS) return { ok: false, error: 'invalid-amount' }
  const frac = (m[2] ?? '').padEnd(2, '0')
  return { ok: true, value: Number(whole) * 100 + Number(frac) }
}

export function parseMinor(raw: string): Result<Minor, ParseError> {
  return parseHundredths(raw) as Result<Minor, ParseError>
}

export function parseEurCents(raw: string): Result<EurCents, ParseError> {
  return parseHundredths(raw) as Result<EurCents, ParseError>
}

/** Parse or throw; for trusted, schema-validated content only. */
export function mustParseMinor(raw: string): Minor {
  const r = parseMinor(raw)
  if (!r.ok) throw new Error(`Invalid amount: ${raw}`)
  return r.value
}

export function mustParseEurCents(raw: string): EurCents {
  const r = parseEurCents(raw)
  if (!r.ok) throw new Error(`Invalid EUR amount: ${raw}`)
  return r.value
}

export function asMinor(n: number): Minor {
  if (!Number.isSafeInteger(n)) throw new Error(`Minor must be an integer: ${n}`)
  return n as Minor
}

export function asEurCents(n: number): EurCents {
  if (!Number.isSafeInteger(n)) throw new Error(`EurCents must be an integer: ${n}`)
  return n as EurCents
}

const MINUS = '−'

/**
 * Format hundredths in the en-IE style: thousands separated by commas, two decimals.
 * 125400 -> "1,254.00"; -2640 -> "−26.40" (typographic minus).
 */
export function formatHundredths(n: number): string {
  if (!Number.isSafeInteger(n)) throw new Error(`Not an integer amount: ${n}`)
  const neg = n < 0
  const abs = Math.abs(n)
  const whole = Math.floor(abs / 100)
  const frac = abs % 100
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${neg ? MINUS : ''}${grouped}.${String(frac).padStart(2, '0')}`
}

export const formatMinor = (m: Minor): string => formatHundredths(m)
export const formatEurCents = (e: EurCents): string => formatHundredths(e)

/** "+8.80" / "−26.40" for ledger rows. */
export function formatSignedMinor(m: Minor): string {
  return m > 0 ? `+${formatHundredths(m)}` : formatHundredths(m)
}

/** Integer division rounding half up, for non-negative numerators and positive denominators. */
export function divRoundHalfUp(num: number, den: number): number {
  if (num < 0 || den <= 0) throw new Error('divRoundHalfUp expects num >= 0 and den > 0')
  return Math.floor((2 * num + den) / (2 * den))
}

export function ceilDiv(num: number, den: number): number {
  if (num < 0 || den <= 0) throw new Error('ceilDiv expects num >= 0 and den > 0')
  return Math.floor((num + den - 1) / den)
}
