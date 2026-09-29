import { describe, expect, it } from 'vitest'
import type { SimTime } from '@domain/types'
import {
  LJUBLJANA,
  addLocalDays,
  atOfInstant,
  compareAt,
  formatTime,
  formatWeekday,
  instantOfAt,
  lastValidDay,
  localDateOf,
  localTimeOf,
  nextLocalAtOrAfter,
  offsetAt,
  parseLocalTime,
  resolveLocal,
} from '@sim/tz'

// resolveLocal and the calendar helpers: fold -> first, gap -> first valid instant.

const iso = (t: number) => new Date(t).toISOString()
const SEOUL = 'Asia/Seoul'

describe('resolveLocal', () => {
  it('ordinary wall times in summer and winter', () => {
    expect(iso(resolveLocal('2026-09-25', '12:15', LJUBLJANA))).toBe('2026-09-25T10:15:00.000Z')
    expect(iso(resolveLocal('2026-12-04', '12:15', LJUBLJANA))).toBe('2026-12-04T11:15:00.000Z')
  })

  it('autumn fold picks the first occurrence: 2026-10-25 02:10 -> 00:10Z', () => {
    expect(iso(resolveLocal('2026-10-25', '02:10', LJUBLJANA))).toBe('2026-10-25T00:10:00.000Z')
    expect(iso(resolveLocal('2026-10-25', '02:59:59.999', LJUBLJANA))).toBe('2026-10-25T00:59:59.999Z')
    // Outside the fold the offset is unambiguous.
    expect(iso(resolveLocal('2026-10-25', '03:00', LJUBLJANA))).toBe('2026-10-25T02:00:00.000Z')
    expect(iso(resolveLocal('2026-10-25', '01:59', LJUBLJANA))).toBe('2026-10-24T23:59:00.000Z')
  })

  it('spring gap gives the first valid instant: 2027-03-28 02:10 -> 03:00 local', () => {
    const t = resolveLocal('2027-03-28', '02:10', LJUBLJANA)
    expect(iso(t)).toBe('2027-03-28T01:00:00.000Z')
    expect(formatTime(t, LJUBLJANA)).toBe('03:00')
    expect(iso(resolveLocal('2027-03-28', '02:00', LJUBLJANA))).toBe('2027-03-28T01:00:00.000Z')
    expect(iso(resolveLocal('2027-03-28', '03:00', LJUBLJANA))).toBe('2027-03-28T01:00:00.000Z')
    expect(iso(resolveLocal('2027-03-28', '01:59', LJUBLJANA))).toBe('2027-03-28T00:59:00.000Z')
  })

  it('accepts seconds and milliseconds', () => {
    expect(iso(resolveLocal('2026-09-25', '12:16:36.250', LJUBLJANA))).toBe('2026-09-25T10:16:36.250Z')
    expect(parseLocalTime('00:00')).toBe(0)
    expect(parseLocalTime('23:59:59.999')).toBe(86_399_999)
    expect(() => parseLocalTime('24:00')).toThrow()
    expect(() => parseLocalTime('7:30')).toThrow()
  })

  it('Busan is UTC+9 all year: 7 h ahead of Ljubljana in summer, 8 h after the last Sunday of October', () => {
    expect(offsetAt(resolveLocal('2026-09-25', '12:15', SEOUL), SEOUL)).toBe(9 * 3_600_000)
    const summer = resolveLocal('2026-09-25', '12:15', LJUBLJANA)
    const winter = resolveLocal('2026-10-26', '12:15', LJUBLJANA)
    expect(formatTime(summer, SEOUL)).toBe('19:15')
    expect(formatTime(winter, SEOUL)).toBe('20:15')
  })
})

describe('calendar helpers', () => {
  it('a 45-day deadline from Fri 25 Sep 12:34 is Mon 9 Nov 12:34 across the DST change', () => {
    const start = resolveLocal('2026-09-25', '12:34', LJUBLJANA)
    const deadline = addLocalDays(start, 45, LJUBLJANA)
    expect(localDateOf(deadline, LJUBLJANA)).toBe('2026-11-09')
    expect(formatTime(deadline, LJUBLJANA)).toBe('12:34')
    expect(formatWeekday(deadline, LJUBLJANA)).toBe('Mon')
    expect(deadline - start).toBe(45 * 86_400_000 + 3_600_000)
  })

  it('next local time at or after', () => {
    const t0 = resolveLocal('2026-09-25', '12:15', LJUBLJANA)
    expect(iso(nextLocalAtOrAfter(t0, '23:00', LJUBLJANA))).toBe('2026-09-25T21:00:00.000Z')
    expect(iso(nextLocalAtOrAfter(t0, '08:00', LJUBLJANA))).toBe('2026-09-26T06:00:00.000Z')
    expect(nextLocalAtOrAfter(t0, '12:15', LJUBLJANA)).toBe(t0)
    // The renewal on the fold day runs at the first 02:10, on the gap day at 03:00.
    const sat = resolveLocal('2026-10-24', '12:00', LJUBLJANA)
    expect(iso(nextLocalAtOrAfter(sat, '02:10', LJUBLJANA))).toBe('2026-10-25T00:10:00.000Z')
    const satSpring = resolveLocal('2027-03-27', '12:00', LJUBLJANA)
    expect(formatTime(nextLocalAtOrAfter(satSpring, '02:10', LJUBLJANA), LJUBLJANA)).toBe('03:00')
  })

  it('last valid day of the month', () => {
    expect(lastValidDay(2026, 4, 31)).toBe(30)
    expect(lastValidDay(2027, 2, 31)).toBe(28)
    expect(lastValidDay(2028, 2, 31)).toBe(29)
    expect(lastValidDay(2026, 10, 25)).toBe(25)
  })

  it('calendar stamps round-trip and re-base by calendar, not by milliseconds', () => {
    const at = { day: 2, time: '07:30:00.000' }
    const t = instantOfAt('2026-09-25', at)
    expect(atOfInstant('2026-09-25', t)).toEqual(at)
    expect(localTimeOf(t, LJUBLJANA)).toBe('07:30:00.000')
    // The same stamp on a Friday in the gap week keeps its weekday and wall time.
    const rebased = instantOfAt('2027-03-26', at)
    expect(formatWeekday(rebased, LJUBLJANA)).toBe('Sun')
    expect(formatTime(rebased, LJUBLJANA)).toBe('07:30')
    expect(atOfInstant('2026-09-25', (t + 1) as SimTime).time).toBe('07:30:00.001')
  })
})

describe('calendar stamps across the autumn fold', () => {
  it('every instant of the repeated hour has exactly one stamp; the second pass carries fold 2', () => {
    const t0Date = '2026-09-25'
    const first = resolveLocal('2026-10-25', '02:30', LJUBLJANA)
    const second = (first + 3_600_000) as SimTime
    expect(new Date(first).toISOString()).toBe('2026-10-25T00:30:00.000Z')
    const a = atOfInstant(t0Date, first)
    const b = atOfInstant(t0Date, second)
    expect(a).toEqual({ day: 30, time: '02:30:00.000' })
    expect(b).toEqual({ day: 30, time: '02:30:00.000', fold: 2 })
    expect(instantOfAt(t0Date, a)).toBe(first)
    expect(instantOfAt(t0Date, b)).toBe(second)
    expect(compareAt(t0Date, a, b)).toBeLessThan(0)
    // Every 10 minutes through the night round-trips.
    const start = resolveLocal('2026-10-25', '00:00', LJUBLJANA)
    for (let t: number = start; t < start + 6 * 3_600_000; t += 600_000) {
      expect(instantOfAt(t0Date, atOfInstant(t0Date, t as SimTime))).toBe(t)
    }
  })

  it('compareAt orders stamps by time: day first, then the instant (fold-aware)', () => {
    const t0Date = '2026-10-23'
    expect(compareAt(t0Date, { day: 1, time: '00:00:00.000' }, { day: 0, time: '23:59:59.999' })).toBeGreaterThan(0)
    expect(compareAt(t0Date, { day: 0, time: '12:16:00.000' }, { day: 0, time: '12:16:00.000' })).toBe(0)
    // Sun 25 Oct 2026: a second-pass 02:10 (01:10Z) comes after a first-pass 02:50 (00:50Z) ...
    const firstPass = { day: 2, time: '02:50:00.000' }
    const secondPass = { day: 2, time: '02:10:00.000', fold: 2 as const }
    expect(new Date(instantOfAt(t0Date, firstPass)).toISOString()).toBe('2026-10-25T00:50:00.000Z')
    expect(new Date(instantOfAt(t0Date, secondPass)).toISOString()).toBe('2026-10-25T01:10:00.000Z')
    expect(compareAt(t0Date, secondPass, firstPass)).toBeGreaterThan(0)
    expect(compareAt(t0Date, firstPass, secondPass)).toBeLessThan(0)
    // ... and before 03:00 of the same morning, which is after the fold.
    expect(compareAt(t0Date, secondPass, { day: 2, time: '03:00:00.000' })).toBeLessThan(0)
    // The same wall time: the first pass comes first.
    expect(compareAt(t0Date, { day: 2, time: '02:10:00.000' }, secondPass)).toBeLessThan(0)
  })

  it('refuses fractional instants instead of printing a malformed time', () => {
    expect(() => localTimeOf(1790331301000.4 as SimTime, LJUBLJANA)).toThrow(/whole-millisecond/)
    expect(() => atOfInstant('2026-09-25', 1790331301000.4 as SimTime)).toThrow(/whole-millisecond/)
  })
})
