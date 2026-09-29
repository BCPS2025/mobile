import { afterEach, describe, expect, it, vi } from 'vitest'
import { CANONICAL_URL } from '../../src/build-constants'
import type { Minor } from '@domain/types'
import { encodePaymentUri, parsePaymentUri, paymentBaseUrl } from '@domain/uri'
import { currentPaymentBaseUrl } from '@store/env'

const cafe = { v: 1 as const, to: '@cafelipa' as const, amount: 1100 as Minor }

describe('encodePaymentUri', () => {
  it('builds <base>#/pay?v=1&to=@handle&amount=..&req=..', () => {
    expect(encodePaymentUri({ ...cafe, req: 'r_1' }, 'https://bcps2025.github.io/mobile/next/')).toBe(
      'https://bcps2025.github.io/mobile/next/#/pay?v=1&to=@cafelipa&amount=11.00&req=r_1',
    )
  })

  it('writes large amounts without grouping and drops an existing hash from the base', () => {
    expect(encodePaymentUri({ v: 1, to: '@hanbit', amount: 110000 as Minor }, 'https://x.example/app/#/stage/1')).toBe(
      'https://x.example/app/#/pay?v=1&to=@hanbit&amount=1100.00',
    )
  })

  it('round-trips through parsePaymentUri', () => {
    const uri = { v: 1 as const, to: '@cafelipa' as const, amount: 1100 as Minor, ref: 'a b&c', req: 'r_1' }
    expect(parsePaymentUri(encodePaymentUri(uri, CANONICAL_URL))).toEqual({ ok: true, value: uri })
  })
})

describe('parsePaymentUri', () => {
  it.each([
    ['https://example.org/', 'not-bcps'],
    ['#/pay?to=@cafelipa', 'not-bcps'],
    ['#/pay?v=2&to=@cafelipa', 'unsupported-version'],
    ['#/pay?v=1&to=cafelipa', 'bad-recipient'],
    ['#/pay?v=1&to=@CafeLipa', 'bad-recipient'],
    ['#/pay?v=1', 'bad-recipient'],
    ['#/pay?v=1&to=@cafelipa&amount=11.001', 'bad-amount'],
    ['#/pay?v=1&to=@cafelipa&amount=0.00', 'bad-amount'],
    ['#/pay?v=1&to=@cafelipa&amount=abc', 'bad-amount'],
  ])('%s -> %s', (raw, error) => {
    expect(parsePaymentUri(raw)).toEqual({ ok: false, error })
  })

  it('accepts a request without an amount', () => {
    expect(parsePaymentUri('#/pay?v=1&to=@ana')).toEqual({ ok: true, value: { v: 1, to: '@ana' } })
  })
})

describe('payment base URL', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('on https resolves the app base against the page location', () => {
    const loc = { protocol: 'https:', href: 'https://bcps2025.github.io/mobile/next/?x=1#/present/1' }
    expect(paymentBaseUrl(loc, './', CANONICAL_URL)).toBe('https://bcps2025.github.io/mobile/next/')
  })

  it.each([
    'file:///Users/someone/dist-single/index.html',
    'file:///Volumes/USB/bcps.html',
    'http://localhost:5179/',
    'http://127.0.0.1:4173/next/',
  ])('under a non-https location (%s) the payload never starts with file:', (href) => {
    const loc = { protocol: new URL(href).protocol, href }
    const base = paymentBaseUrl(loc, './', CANONICAL_URL)
    const payload = encodePaymentUri(cafe, base)
    expect(payload.startsWith('file:')).toBe(false)
    expect(payload.startsWith(CANONICAL_URL)).toBe(true)
  })

  it('currentPaymentBaseUrl reads location and the build-time canonical URL', () => {
    vi.stubGlobal('location', { protocol: 'file:', href: 'file:///Users/someone/index.html' })
    const payload = encodePaymentUri(cafe, currentPaymentBaseUrl())
    expect(payload.startsWith('file:')).toBe(false)
    expect(payload).toBe('https://bcps2025.github.io/mobile/next/#/pay?v=1&to=@cafelipa&amount=11.00')
  })

  it('the canonical URL is https', () => {
    expect(CANONICAL_URL.startsWith('https://')).toBe(true)
  })
})
