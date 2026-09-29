import type { SimTime } from '@domain/types'

// Minimal time-zone helpers on top of Intl. Calendar dates are 'YYYY-MM-DD' strings;
// calendar arithmetic is done in UTC so it is independent of the host zone.

export const LJUBLJANA = 'Europe/Ljubljana'
export type IsoDate = string

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function ymd(date: IsoDate): [number, number, number] {
  const m = DATE.exec(date)
  if (!m) throw new Error(`Bad date: ${date}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function isoFromUtcMs(ms: number): IsoDate {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = ymd(date)
  return isoFromUtcMs(Date.UTC(y, m - 1, d + days))
}

/** Day of week of a calendar date, 0 = Sunday. */
export function weekdayOfDate(date: IsoDate): number {
  const [y, m, d] = ymd(date)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** The most recent `weekday` on or before `date` (0 = Sunday). */
export function mostRecentWeekdayOnOrBefore(date: IsoDate, weekday: number): IsoDate {
  const back = (weekdayOfDate(date) - weekday + 7) % 7
  return addDays(date, -back)
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>()
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    })
    partsFormatters.set(tz, f)
  }
  return f
}

export interface ZonedParts {
  date: IsoDate
  hour: number
  minute: number
  second: number
  weekday: number
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function zonedParts(t: number, tz: string): ZonedParts {
  const parts: Record<string, string> = {}
  for (const p of partsFormatter(tz).formatToParts(new Date(t))) parts[p.type] = p.value
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS.indexOf(parts.weekday ?? ''),
  }
}

/** Offset of `tz` from UTC at instant t, in ms (east positive). */
export function offsetAt(t: number, tz: string): number {
  const p = zonedParts(t, tz)
  const [y, m, d] = ymd(p.date)
  const asUtc = Date.UTC(y, m - 1, d, p.hour, p.minute, p.second)
  return asUtc - (t - (((t % 1000) + 1000) % 1000))
}

const LOCAL_TIME = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{3}))?)?$/

/** Wall-clock time as ms since local midnight: "HH:MM", "HH:MM:SS" or "HH:MM:SS.mmm". */
export function parseLocalTime(time: string): number {
  const m = LOCAL_TIME.exec(time)
  if (!m) throw new Error(`Bad time: ${time}`)
  return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3] ?? 0)) * 1000 + Number(m[4] ?? 0)
}

export interface ResolveOptions {
  /** A wall time that does not exist (spring forward): the first valid instant after the gap. */
  gap: 'next-valid'
  /** A wall time that exists twice (fall back): the first occurrence (the rule), or the second
   *  (only for a log stamp that recorded an instant in the repeated hour, `At.fold`). */
  fold: 'first' | 'second'
}
const DEFAULT_RESOLVE: ResolveOptions = { gap: 'next-valid', fold: 'first' }
const HOUR = 3_600_000

const steadyCache = new Map<string, number | null>()
/**
 * The offset of `tz` on a calendar date when it is the same from 14 h before the date's start to
 * 14 h after its end (so no wall time of that date is in a gap or a fold); null otherwise.
 */
function steadyOffset(date: IsoDate, dayStartUtc: number, tz: string): number | null {
  const key = `${tz}|${date}`
  const hit = steadyCache.get(key)
  if (hit !== undefined) return hit
  const a = offsetAt(dayStartUtc - 14 * HOUR, tz)
  const b = offsetAt(dayStartUtc + 38 * HOUR, tz)
  const out = a === b ? a : null
  if (steadyCache.size > 4096) steadyCache.clear()
  steadyCache.set(key, out)
  return out
}

/**
 * The one rule that turns a calendar date plus a local wall time into an instant. Every calendar
 * rule (seed rows, log stamps, renewals, deadlines, banking hours, re-basing) goes through it.
 * - fold (autumn): the first occurrence, e.g. 2026-10-25 02:10 Europe/Ljubljana -> 00:10Z;
 * - gap (spring): the first valid instant, e.g. 2027-03-28 02:10 Europe/Ljubljana -> 03:00 local.
 */
export function resolveLocal(date: IsoDate, time: string, tz: string, opts: ResolveOptions = DEFAULT_RESOLVE): SimTime {
  const [y, m, d] = ymd(date)
  const wall = Date.UTC(y, m - 1, d) + parseLocalTime(time)
  // Most days have no offset change anywhere near them: one offset serves every wall time.
  const steady = steadyOffset(date, Date.UTC(y, m - 1, d), tz)
  if (steady !== null) return (wall - steady) as SimTime
  const before = offsetAt(wall - 12 * HOUR, tz)
  const after = offsetAt(wall + 12 * HOUR, tz)
  const valid: number[] = []
  for (const o of before === after ? [before] : [before, after]) {
    const t = wall - o
    if (t + offsetAt(t, tz) === wall) valid.push(t)
  }
  if (valid.length > 0) return (opts.fold === 'second' ? Math.max(...valid) : Math.min(...valid)) as SimTime
  // In a gap: the transition instant lies between wall - after and wall - before.
  let lo = wall - after
  let hi = wall - before
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (offsetAt(mid, tz) === after) hi = mid
    else lo = mid
  }
  return hi as SimTime
}

/** Instants are whole milliseconds; anything else cannot be stamped (it would print "01.0.39…"). */
function assertInstant(t: number): void {
  if (!Number.isSafeInteger(t)) throw new Error(`Not a whole-millisecond instant: ${t}`)
}

/** Local wall time of an instant as "HH:MM:SS.mmm". */
export function localTimeOf(t: SimTime, tz: string): string {
  assertInstant(t)
  const p = zonedParts(t, tz)
  const ms = ((t % 1000) + 1000) % 1000
  return `${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}.${String(ms).padStart(3, '0')}`
}

/** The same local time `days` calendar days later (a 45-day deadline keeps its wall time across DST). */
export function addLocalDays(t: SimTime, days: number, tz: string): SimTime {
  return resolveLocal(addDays(localDateOf(t, tz), days), localTimeOf(t, tz), tz)
}

/** The first instant at or after t whose local time is `time` (resolved with resolveLocal). */
export function nextLocalAtOrAfter(t: SimTime, time: string, tz: string): SimTime {
  const today = localDateOf(t, tz)
  const r = resolveLocal(today, time, tz)
  return r >= t ? r : resolveLocal(addDays(today, 1), time, tz)
}

/** Days in a calendar month (month 1–12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** `day` clamped to the last valid day of the month (31 -> 30 in April, -> 28 in February). */
export function lastValidDay(year: number, month: number, day: number): number {
  return Math.min(day, daysInMonth(year, month))
}

/**
 * Calendar stamp of the log and state files: day offset from T0's date plus a local time. `fold: 2`
 * marks the second pass through a repeated hour (autumn change), so every instant has exactly one
 * stamp; it is written only when needed.
 */
export interface At {
  day: number
  time: string
  fold?: 2
}

/** Instant of a calendar stamp for a given T0 date (Europe/Ljubljana unless given). */
export function instantOfAt(t0Date: IsoDate, at: At, tz: string = LJUBLJANA): SimTime {
  return resolveLocal(addDays(t0Date, at.day), at.time, tz, {
    gap: 'next-valid',
    fold: at.fold === 2 ? 'second' : 'first',
  })
}

/**
 * Time order of two stamps for a given T0 date: < 0, 0 or > 0. Stamps are compared as instants,
 * because wall-clock text is not time order inside the repeated autumn hour (a second-pass
 * 02:10 comes after a first-pass 02:50). Days are compared first: a later calendar day is always
 * later in time.
 */
export function compareAt(t0Date: IsoDate, a: At, b: At, tz: string = LJUBLJANA): number {
  if (a.day !== b.day) return a.day - b.day
  if (a.time === b.time && (a.fold ?? 1) === (b.fold ?? 1)) return 0
  return instantOfAt(t0Date, a, tz) - instantOfAt(t0Date, b, tz)
}

/** Whole calendar days from date a to date b. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const [y1, m1, d1] = ymd(a)
  const [y2, m2, d2] = ymd(b)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000)
}

/** Calendar stamp of an instant relative to T0's date; `instantOfAt` gives the instant back. */
export function atOfInstant(t0Date: IsoDate, t: SimTime, tz: string = LJUBLJANA): At {
  assertInstant(t)
  const at: At = { day: daysBetween(t0Date, localDateOf(t, tz)), time: localTimeOf(t, tz) }
  if (instantOfAt(t0Date, at, tz) !== t) at.fold = 2
  return at
}

export function localDateOf(t: SimTime, tz: string): IsoDate {
  return zonedParts(t, tz).date
}

/** "12:15" or "12:15:32". */
export function formatTime(t: SimTime, tz: string, seconds = false): string {
  const p = zonedParts(t, tz)
  const hm = `${pad2(p.hour)}:${pad2(p.minute)}`
  return seconds ? `${hm}:${pad2(p.second)}` : hm
}

const weekdayFormatters = new Map<string, Intl.DateTimeFormat>()
/** Short weekday name, e.g. "Fri". */
export function formatWeekday(t: SimTime, tz: string, locale = 'en-GB'): string {
  const key = `${locale}|${tz}`
  let f = weekdayFormatters.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'short' })
    weekdayFormatters.set(key, f)
  }
  return f.format(new Date(t))
}

/** Short weekday name for a calendar date. */
export function weekdayName(date: IsoDate): string {
  return WEEKDAYS[weekdayOfDate(date)] ?? ''
}

/** The calendar date n business days (Mon–Fri) after the local date of t. Holidays are ignored. */
export function addBusinessDays(date: IsoDate, n: number): IsoDate {
  let d = date
  let left = n
  while (left > 0) {
    d = addDays(d, 1)
    const wd = weekdayOfDate(d)
    if (wd !== 0 && wd !== 6) left -= 1
  }
  return d
}

/** Typical card payout window (1–3 business days) from a virtual-clock instant: e.g. Fri -> ["Mon", "Wed"]. */
export function cardPayoutWindow(t: SimTime, tz: string = LJUBLJANA): { first: string; last: string } {
  const today = localDateOf(t, tz)
  return { first: weekdayName(addBusinessDays(today, 1)), last: weekdayName(addBusinessDays(today, 3)) }
}
