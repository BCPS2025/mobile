import type { SimTime } from '@domain/types'
import { parseLocalTime, zonedParts } from '@sim/tz'

// Banking hours: whether an instant falls inside a country's opening hours (the payment detail
// says "Outside banking hours · settled anyway").

export interface OpeningHours {
  /** Weekdays the banks are open, 0 = Sunday. */
  days: readonly number[]
  /** Local "HH:MM". */
  open: string
  close: string
  tz: string
}

/** Open on the day, from `open` up to (not including) `close`, in the hours' own zone. */
export function withinHours(t: SimTime, hours: OpeningHours): boolean {
  const p = zonedParts(t, hours.tz)
  if (!hours.days.includes(p.weekday)) return false
  const minutes = p.hour * 60 + p.minute
  return minutes >= parseLocalTime(hours.open) / 60_000 && minutes < parseLocalTime(hours.close) / 60_000
}
