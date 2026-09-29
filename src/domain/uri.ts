import { formatHundredths, parseMinor } from './money'
import type { Handle, Minor, PaymentUri, Result } from './types'

// Payment links and QR payloads: <base>#/pay?v=1&to=@cafelipa&amount=11.00&req=r_1
// Pure: the caller supplies the base URL (see paymentBaseUrl).

const HANDLE = /^@[a-z0-9_]{2,30}$/
const PAY_MARKER = '#/pay?'

export type PaymentUriError = 'not-bcps' | 'bad-amount' | 'bad-recipient' | 'unsupported-version'

/** Plain amount for URLs: two decimals, no grouping. */
function amountParam(m: Minor): string {
  return formatHundredths(m).replaceAll(',', '')
}

export function encodePaymentUri(u: PaymentUri, baseUrl: string): string {
  if (!HANDLE.test(u.to)) throw new Error(`Bad recipient handle: ${u.to}`)
  if (u.amount !== undefined && (!Number.isSafeInteger(u.amount) || u.amount <= 0)) {
    throw new Error(`Bad payment amount: ${u.amount}`)
  }
  const base = baseUrl.split('#')[0]?.split('?')[0] ?? ''
  const parts = [`v=${u.v}`, `to=${u.to}`]
  if (u.amount !== undefined) parts.push(`amount=${amountParam(u.amount)}`)
  if (u.ref !== undefined) parts.push(`ref=${encodeURIComponent(u.ref)}`)
  if (u.req !== undefined) parts.push(`req=${encodeURIComponent(u.req)}`)
  return `${base}${PAY_MARKER}${parts.join('&')}`
}

export function parsePaymentUri(raw: string): Result<PaymentUri, PaymentUriError> {
  const at = raw.indexOf(PAY_MARKER)
  if (at < 0) return { ok: false, error: 'not-bcps' }
  const params = new Map<string, string>()
  for (const pair of raw.slice(at + PAY_MARKER.length).split('&')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    const key = eq < 0 ? pair : pair.slice(0, eq)
    const value = eq < 0 ? '' : pair.slice(eq + 1)
    let decoded: string
    try {
      decoded = decodeURIComponent(value)
    } catch {
      return { ok: false, error: 'not-bcps' }
    }
    params.set(key, decoded)
  }
  const v = params.get('v')
  if (v === undefined) return { ok: false, error: 'not-bcps' }
  if (v !== '1') return { ok: false, error: 'unsupported-version' }
  const to = params.get('to') ?? ''
  if (!HANDLE.test(to)) return { ok: false, error: 'bad-recipient' }
  const out: PaymentUri = { v: 1, to: to as Handle }
  const amount = params.get('amount')
  if (amount !== undefined) {
    const parsed = parseMinor(amount)
    if (!parsed.ok || parsed.value <= 0) return { ok: false, error: 'bad-amount' }
    out.amount = parsed.value
  }
  const ref = params.get('ref')
  if (ref !== undefined) out.ref = ref
  const req = params.get('req')
  if (req !== undefined) out.req = req
  return { ok: true, value: out }
}

export interface LocationLike {
  protocol: string
  href: string
}

/**
 * Base URL for payment payloads. On https it is the app base resolved against the page
 * location; anywhere else (file://, the single-file backup, http dev) it is the canonical
 * public URL, so a projected code never exposes a local path.
 */
export function paymentBaseUrl(loc: LocationLike, appBase: string, canonicalUrl: string): string {
  if (loc.protocol === 'https:') {
    const u = new URL(appBase, loc.href)
    u.hash = ''
    u.search = ''
    return u.href
  }
  return canonicalUrl
}
