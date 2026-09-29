import { describe, expect, it } from 'vitest'
import {
  ceilDiv,
  divRoundHalfUp,
  formatHundredths,
  formatSignedMinor,
  parseHundredths,
  parseMinor,
} from '@domain/money'
import type { Minor } from '@domain/types'

describe('parseMinor', () => {
  it.each([
    ['12.40', 1240],
    ['12.4', 1240],
    ['12', 1200],
    ['0.07', 7],
    ['0.00', 0],
    ['1,254.00', 125400],
    ['12,100.00', 1210000],
    ['1,000,000.01', 100000001],
    ['  8.80 ', 880],
    ['0.1', 10],
  ])('parses %s as %i hundredths', (raw, expected) => {
    expect(parseMinor(raw)).toEqual({ ok: true, value: expected })
  })

  it.each([
    '12.345', // more than two decimals
    '0.001',
    '12.',
    '.50',
    '',
    ' ',
    '-1.00',
    '+1.00',
    '1e3',
    '12,40',
    '1,25.00',
    '1,2345.00',
    ',100.00',
    '12.40.1',
    'abc',
    '1 000.00',
    '1234567890123.00', // beyond 12 integer digits
    'NaN',
    'Infinity',
  ])('rejects %j', (raw) => {
    expect(parseMinor(raw)).toEqual({ ok: false, error: 'invalid-amount' })
  })

  it('never uses float arithmetic: 0.29 and 1.15 are exact', () => {
    expect(parseHundredths('0.29')).toEqual({ ok: true, value: 29 })
    expect(parseHundredths('1.15')).toEqual({ ok: true, value: 115 })
    expect(parseHundredths('4.35')).toEqual({ ok: true, value: 435 })
  })
})

describe('formatHundredths (en-IE, two decimals)', () => {
  it.each([
    [0, '0.00'],
    [6, '0.06'],
    [50, '0.50'],
    [1100, '11.00'],
    [23650, '236.50'],
    [125400, '1,254.00'],
    [1210000, '12,100.00'],
    [100000001, '1,000,000.01'],
    [-2640, '−26.40'],
  ])('formats %i as %s', (n, s) => {
    expect(formatHundredths(n)).toBe(s)
  })

  it('matches Intl en-IE grouping', () => {
    const intl = new Intl.NumberFormat('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    for (const n of [0, 5, 99, 100, 123456, 98765432, 1210000]) {
      expect(formatHundredths(n)).toBe(intl.format(n / 100))
    }
  })

  it('signs ledger rows', () => {
    expect(formatSignedMinor(880 as Minor)).toBe('+8.80')
    expect(formatSignedMinor(-886 as Minor)).toBe('−8.86')
  })

  it('rejects non-integers', () => {
    expect(() => formatHundredths(1.5)).toThrow()
  })

  it('round-trips parse(format(n))', () => {
    for (const n of [0, 1, 99, 1100, 125400, 1210000, 528000]) {
      expect(parseHundredths(formatHundredths(n))).toEqual({ ok: true, value: n })
    }
  })
})

describe('integer helpers', () => {
  it('divRoundHalfUp rounds halves up', () => {
    expect(divRoundHalfUp(55, 10)).toBe(6)
    expect(divRoundHalfUp(54, 10)).toBe(5)
    expect(divRoundHalfUp(0, 10)).toBe(0)
  })
  it('ceilDiv', () => {
    expect(ceilDiv(5500, 10)).toBe(550)
    expect(ceilDiv(5501, 10)).toBe(551)
  })
})
