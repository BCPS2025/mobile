import type { AutoConvertSettings, SimTime } from '@domain/types'
import { daysBetween, formatTime, localDateOf } from '@sim/tz'
import { fill, ui } from '../copy'
import { dayText } from '../format'

// The words that describe an auto-convert schedule: the strip on the Cash out list, the check
// before saving and the line that says when it would run next. The days follow the schedule: every
// day, Monday to Friday, or the one day of a weekly one.

const dayName = (n: number): string => ui.autoConvert.days[n] ?? ''

/** "Auto-convert 50% · every day 23:00", or that it is off (the strip on the Cash out list). */
export function stripText(a: AutoConvertSettings): string {
  if (!a.enabled) return ui.autoConvert.stripOff
  const v = { sharePct: a.sharePct, time: a.atLocal }
  if (a.schedule === 'daily') return fill(ui.autoConvert.stripDaily, v)
  if (a.schedule === 'weekdays') return fill(ui.autoConvert.stripWeekdays, v)
  return fill(ui.autoConvert.stripWeekly, { ...v, day: dayName(a.weekdays[0] ?? 1) })
}

/** "Every day · 23:00" / "Weekdays · 23:00" / "Every Monday · 23:00" (the check before saving). */
export function scheduleLine(a: AutoConvertSettings): string {
  const time = a.atLocal
  if (a.schedule === 'daily') return fill(ui.autoConvert.scheduleDaily, { time })
  if (a.schedule === 'weekdays') return fill(ui.autoConvert.scheduleWeekdays, { time })
  return fill(ui.autoConvert.scheduleWeekly, { day: dayName(a.weekdays[0] ?? 1), time })
}

/** When it would run next: "tonight 23:00", "tomorrow 23:00" or "Mon 23:00". */
export function whenText(at: SimTime, now: SimTime, tz: string): string {
  const time = formatTime(at, tz)
  const date = localDateOf(at, tz)
  const age = daysBetween(localDateOf(now, tz), date)
  if (age <= 0) return fill(ui.autoConvert.whenTonight, { time })
  if (age === 1) return fill(ui.autoConvert.whenTomorrow, { time })
  return fill(ui.autoConvert.whenDay, { day: dayText(date).split(' ')[0] ?? '', time })
}
