import type { BankArrival, BankingHours, DecideCtx, SimConfig, SimTime } from '@domain/types'
import { addDays, localDateOf, parseLocalTime, resolveLocal, weekdayOfDate, zonedParts } from './tz'

// Banking hours and when a bank transfer reaches an account. The domain cannot compute local
// times, so the node and replay hand `decide` this resolver (`decideCtx`).

/** Whether an instant is inside a country's opening hours: open on the day, from `open` up to (not including) `close`. */
export function withinHours(t: SimTime, hours: BankingHours): boolean {
  const p = zonedParts(t, hours.tz)
  if (!hours.days.includes(p.weekday)) return false
  const minutes = p.hour * 60 + p.minute
  return minutes >= parseLocalTime(hours.open) / 60_000 && minutes < parseLocalTime(hours.close) / 60_000
}

/**
 * When a bank transfer requested at `requestedAt` arrives. Requested inside banking hours it arrives
 * `withinHoursDelayMin` later, provided that is not after that day's closing time; otherwise (outside
 * hours, or the delay would pass closing) it arrives at `nextDayArrival` on the next banking day: the
 * first banking day whose arrival time is still ahead (Friday 16:30 arrives Monday 10:00; a Monday
 * 06:00 request arrives Monday 10:00). Holidays are ignored.
 */
export function bankTransferArrival(config: SimConfig, country: 'SI' | 'KR', requestedAt: SimTime): SimTime {
  const hours = config.bankingHours[country]
  const { withinHoursDelayMin, nextDayArrival } = config.bankTransfer
  if (withinHours(requestedAt, hours)) {
    const arrives = requestedAt + withinHoursDelayMin * 60_000
    const closes = resolveLocal(localDateOf(requestedAt, hours.tz), hours.close, hours.tz)
    if (arrives <= closes) return arrives as SimTime
  }
  let date = localDateOf(requestedAt, hours.tz)
  // At most a week ahead: banks are open on at least one weekday.
  for (let i = 0; i < 8; i++, date = addDays(date, 1)) {
    if (!hours.days.includes(weekdayOfDate(date))) continue
    const arrives = resolveLocal(date, nextDayArrival, hours.tz)
    if (arrives > requestedAt) return arrives
  }
  throw new Error('no banking day found')
}

/** The context the domain decides a command in: the virtual clock, plus the banks' arrival rule. */
export function decideCtx(config: SimConfig, now: SimTime): DecideCtx {
  const bankArrival: BankArrival = (country, at) => bankTransferArrival(config, country, at)
  return { now, bankArrival }
}
