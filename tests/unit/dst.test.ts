// Daylight-saving time across the stack: T0 in the change weeks,
// calendar stamps and re-basing, Clock jumps, settling across the repeated autumn hour and the
// spring gap, deadlines, next-local-time rules and the Busan offset. The golden epochs are
// Fri 25 Sep 2026 (summer time), Fri 23 Oct 2026 (the change is on Sun 25 Oct) and
// Fri 26 Mar 2027 (the change is on Sun 28 Mar).
import { describe, expect, it } from 'vitest'
import { invariants } from '@domain/invariants'
import { formatHundredths } from '@domain/money'
import type { SimTime, UserCommand } from '@domain/types'
import { buildSeed, computeT0 } from '@sim/seed'
import {
  LJUBLJANA,
  addLocalDays,
  atOfInstant,
  formatTime,
  formatWeekday,
  instantOfAt,
  localDateOf,
  localTimeOf,
  nextLocalAtOrAfter,
  offsetAt,
  resolveLocal,
} from '@sim/tz'
import { createLedgerNode } from '@store/node'
import { type LogEntry, serializeRecord } from '@store/record'
import { replay } from '@store/replay'
import { restoreText } from '@store/restore'
import { recordOf } from '../support/records'
import { content, m } from './helpers'

const iso = (t: number) => new Date(t).toISOString()
const HOUR = 3_600_000
const SEOUL = 'Asia/Seoul'

/** Ana pays the café 1.10 by QR (the café pays the 0.01 fee). */
const coffee = (cmdId: string): UserCommand => ({
  type: 'pay',
  actor: 'ana',
  cmdId,
  to: '@cafelipa',
  amount: m('1.10'),
  channel: 'qr',
  expect: { senderDebit: m('1.10') },
})

function session(epoch: string) {
  const seed = buildSeed(content, epoch)
  const node = createLedgerNode({ seed: seed.state, t0: seed.t0 })
  return { seed, node }
}

describe('T0 in the change weeks', () => {
  it.each([
    ['2026-10-23', '2026-10-23', '2026-10-23T10:15:00.000Z'],
    ['2026-10-25', '2026-10-23', '2026-10-23T10:15:00.000Z'], // the fold day itself
    ['2026-10-26', '2026-10-23', '2026-10-23T10:15:00.000Z'], // Monday after: T0 stays in summer time
    ['2026-10-30', '2026-10-30', '2026-10-30T11:15:00.000Z'], // first Friday in winter time
    ['2027-03-26', '2027-03-26', '2027-03-26T11:15:00.000Z'],
    ['2027-03-28', '2027-03-26', '2027-03-26T11:15:00.000Z'], // the gap day itself
    ['2027-04-02', '2027-04-02', '2027-04-02T10:15:00.000Z'],
  ])('from %s: T0 is Fri %s 12:15 Ljubljana (%s)', (epoch, date, instant) => {
    const { t0, t0Date } = computeT0(content, epoch)
    expect(t0Date).toBe(date)
    expect(iso(t0)).toBe(instant)
    expect(formatTime(t0, LJUBLJANA)).toBe('12:15')
    expect(formatWeekday(t0, LJUBLJANA)).toBe('Fri')
  })
})

describe('Sunday 07:30 is a calendar stamp, not an offset', () => {
  it.each([
    ['2026-09-25', 43.25],
    ['2026-10-23', 44.25], // the repeated hour lengthens the weekend
    ['2027-03-26', 42.25], // the missing hour shortens it
  ])('at T0 = %s the jump lands on Sun 07:30 (%s h after T0) and replays there', (epoch, hours) => {
    const { seed, node } = session(epoch)
    const sunday = instantOfAt(seed.t0Date, { day: 2, time: '07:30:00.000' })
    expect((sunday - seed.t0) / HOUR).toBe(hours)
    expect(node.jump(sunday).ok).toBe(true)
    expect(formatWeekday(node.now(), LJUBLJANA)).toBe('Sun')
    expect(formatTime(node.now(), LJUBLJANA)).toBe('07:30')
    const rec = recordOf(node, seed.t0Date)
    expect(rec.log).toEqual([{ at: { day: 2, time: '07:30:00.000' }, jump: true }])
    expect(rec.clock).toEqual({ day: 2, time: '07:30:00.000' })
    const r = restoreText(serializeRecord(rec), { content }, { acceptOlder: false })
    expect(r.ok && r.value.session.clock).toBe(sunday)
  })
})

describe('the repeated autumn hour (Sun 25 Oct 2026, 03:00 → 02:00)', () => {
  const epoch = '2026-10-23'

  it('a payment late in the first pass settles in the second; stamps and replay keep both apart', () => {
    const { seed, node } = session(epoch)
    const late = resolveLocal('2026-10-25', '02:59:59.500', LJUBLJANA)
    expect(iso(late)).toBe('2026-10-25T00:59:59.500Z')
    expect(node.jump(late).ok).toBe(true)
    expect(node.dispatch(coffee('00000000000000d1:review')).ok).toBe(true)
    node.settleDue()
    const tx = node.getState().txs[node.getState().txOrder.at(-1) as string]
    expect(tx?.status).toBe('confirmed')
    // 1.4 s later on the wall is 02:00:00.900 of the second pass.
    expect(localTimeOf(tx?.confirmedAt as SimTime, LJUBLJANA)).toBe('02:00:00.900')
    expect(atOfInstant(seed.t0Date, tx?.confirmedAt as SimTime)).toEqual({ day: 2, time: '02:00:00.900', fold: 2 })
    const rec = recordOf(node, seed.t0Date)
    expect(rec.log[1]).toMatchObject({ at: { day: 2, time: '02:59:59.500' } })
    expect(rec.clock).toEqual({ day: 2, time: '02:00:00.900', fold: 2 })
    const r = replay({ seed: seed.state, t0: seed.t0, t0Date: seed.t0Date, content, log: rec.log, clock: rec.clock })
    if (!r.ok) throw new Error(JSON.stringify(r.error))
    expect(JSON.stringify(r.value.state)).toBe(JSON.stringify(node.getState()))
    expect(invariants(r.value.state)).toEqual([])
    // The record itself restores: the clock (second pass) is after the last entry (first pass).
    const restored = restoreText(serializeRecord(rec), { content }, { acceptOlder: false })
    if (!restored.ok) throw new Error(JSON.stringify(restored.error))
    expect(restored.value.session.clock).toBe(node.now())
    expect(JSON.stringify(restored.value.session.state)).toBe(JSON.stringify(node.getState()))
  })

  it('a payment in the second pass is stamped fold 2 and replays after one in the first pass', () => {
    const { seed, node } = session(epoch)
    const first = resolveLocal('2026-10-25', '02:30', LJUBLJANA)
    const second = (first + HOUR) as SimTime
    node.jump(first)
    node.dispatch(coffee('00000000000000e1:review'))
    node.settleDue()
    node.jump(second)
    node.dispatch(coffee('00000000000000e2:review'))
    node.settleDue()
    const rec = recordOf(node, seed.t0Date)
    const stamps = rec.log.filter((e) => !('jump' in e)).map((e) => e.at)
    expect(stamps).toEqual([
      { day: 2, time: '02:30:00.000' },
      { day: 2, time: '02:30:00.000', fold: 2 },
    ])
    const r = replay({ seed: seed.state, t0: seed.t0, t0Date: seed.t0Date, content, log: rec.log, clock: rec.clock })
    if (!r.ok) throw new Error(JSON.stringify(r.error))
    expect(r.value.log.filter((e) => !('jump' in e)).map((e) => e.at)).toEqual([first, second])
    expect(JSON.stringify(r.value.state)).toBe(JSON.stringify(node.getState()))
    const restored = restoreText(serializeRecord(rec), { content }, { acceptOlder: false })
    if (!restored.ok) throw new Error(JSON.stringify(restored.error))
    expect(JSON.stringify(restored.value.session.state)).toBe(JSON.stringify(node.getState()))
  })

  it('a second-pass entry whose wall time reads earlier than the first-pass entry before it restores', () => {
    const { seed, node } = session(epoch)
    const at0250 = resolveLocal('2026-10-25', '02:50', LJUBLJANA)
    node.jump(at0250)
    node.dispatch(coffee('00000000000000f1:review'))
    node.settleDue()
    // 20 minutes later on the wall: 02:10 of the second pass.
    node.jump((at0250 + 20 * 60_000) as SimTime)
    node.dispatch(coffee('00000000000000f2:review'))
    node.settleDue()
    const rec = recordOf(node, seed.t0Date)
    expect(rec.log.map((e) => e.at)).toEqual([
      { day: 2, time: '02:50:00.000' },
      { day: 2, time: '02:50:00.000' },
      { day: 2, time: '02:10:00.000', fold: 2 },
      { day: 2, time: '02:10:00.000', fold: 2 },
    ])
    const restored = restoreText(serializeRecord(rec), { content }, { acceptOlder: false })
    if (!restored.ok) throw new Error(JSON.stringify(restored.error))
    expect(JSON.stringify(restored.value.session.state)).toBe(JSON.stringify(node.getState()))
    expect(restored.value.session.clock).toBe(node.now())
  })

  it('the next 02:10 after the first 02:10 has passed is Monday, never the repeated 02:10', () => {
    const between = resolveLocal('2026-10-25', '02:30', LJUBLJANA)
    expect(iso(nextLocalAtOrAfter(between, '02:10', LJUBLJANA))).toBe('2026-10-26T01:10:00.000Z')
    const secondPass = (between + HOUR) as SimTime
    expect(iso(nextLocalAtOrAfter(secondPass, '02:10', LJUBLJANA))).toBe('2026-10-26T01:10:00.000Z')
    // From Saturday the first 02:10 is the one.
    const sat = resolveLocal('2026-10-24', '23:00', LJUBLJANA)
    expect(iso(nextLocalAtOrAfter(sat, '02:10', LJUBLJANA))).toBe('2026-10-25T00:10:00.000Z')
  })

  it('the Busan offset: 7 h ahead until the change, 8 h after', () => {
    const fri = resolveLocal('2026-10-23', '12:15', LJUBLJANA)
    const mon = resolveLocal('2026-10-26', '12:15', LJUBLJANA)
    expect(formatTime(fri, SEOUL)).toBe('19:15')
    expect(formatTime(mon, SEOUL)).toBe('20:15')
    expect(offsetAt(fri, LJUBLJANA)).toBe(2 * HOUR)
    expect(offsetAt(mon, LJUBLJANA)).toBe(HOUR)
    expect(offsetAt(mon, SEOUL)).toBe(9 * HOUR)
  })
})

describe('the spring gap (Sun 28 Mar 2027, 02:00 → 03:00)', () => {
  const epoch = '2027-03-26'

  it('a payment just before the gap settles at 03:00:00.900, stamped with a valid local time', () => {
    const { seed, node } = session(epoch)
    const late = resolveLocal('2027-03-28', '01:59:59.500', LJUBLJANA)
    node.jump(late)
    expect(node.dispatch(coffee('00000000000000f1:review')).ok).toBe(true)
    node.settleDue()
    const tx = node.getState().txs[node.getState().txOrder.at(-1) as string]
    expect(localTimeOf(tx?.confirmedAt as SimTime, LJUBLJANA)).toBe('03:00:00.900')
    const rec = recordOf(node, seed.t0Date)
    expect(rec.clock).toEqual({ day: 2, time: '03:00:00.900' })
    const r = replay({ seed: seed.state, t0: seed.t0, t0Date: seed.t0Date, content, log: rec.log, clock: rec.clock })
    expect(r.ok && JSON.stringify(r.value.state)).toBe(JSON.stringify(node.getState()))
  })

  it('stamps through the gap night round-trip and never name a missing time', () => {
    const start: number = resolveLocal('2027-03-28', '00:00', LJUBLJANA)
    for (let t = start; t < start + 5 * HOUR; t += 600_000) {
      const at = atOfInstant('2027-03-26', t as SimTime)
      expect(at.time < '02:00' || at.time >= '03:00', at.time).toBe(true)
      expect(at.fold).toBeUndefined()
      expect(instantOfAt('2027-03-26', at)).toBe(t)
    }
  })

  it('a stamp inside the gap resolves to 03:00; entries there keep their order on replay', () => {
    const seed = buildSeed(content, epoch)
    const log: LogEntry[] = [
      { at: { day: 2, time: '02:10:00.000' }, jump: true },
      { at: { day: 2, time: '02:40:00.000' }, actor: 'ana', cmdId: '00000000000000f2:review', cmd: wire() },
    ]
    const r = replay({
      seed: seed.state,
      t0: seed.t0,
      t0Date: seed.t0Date,
      content,
      log,
      clock: { day: 2, time: '03:05:00.000' },
    })
    if (!r.ok) throw new Error(JSON.stringify(r.error))
    const gap = resolveLocal('2027-03-28', '03:00', LJUBLJANA)
    expect(r.value.log.map((e) => e.at)).toEqual([gap, gap])
    expect(formatTime(r.value.log[1]?.at as SimTime, LJUBLJANA)).toBe('03:00')
  })

  it('a 45-day deadline from Fri 26 Mar 12:34 is Mon 10 May 12:34, one hour shorter', () => {
    const start = resolveLocal('2027-03-26', '12:34', LJUBLJANA)
    const deadline = addLocalDays(start, 45, LJUBLJANA)
    expect(localDateOf(deadline, LJUBLJANA)).toBe('2027-05-10')
    expect(formatTime(deadline, LJUBLJANA)).toBe('12:34')
    expect(deadline - start).toBe(45 * 24 * HOUR - HOUR)
    // A deadline whose wall time falls into the gap moves to 03:00.
    const sat = resolveLocal('2027-03-27', '02:30', LJUBLJANA)
    expect(formatTime(addLocalDays(sat, 1, LJUBLJANA), LJUBLJANA)).toBe('03:00')
  })

  it('the Busan offset: 8 h ahead until the change, 7 h after', () => {
    expect(formatTime(resolveLocal('2027-03-26', '12:15', LJUBLJANA), SEOUL)).toBe('20:15')
    expect(formatTime(resolveLocal('2027-03-29', '12:15', LJUBLJANA), SEOUL)).toBe('19:15')
  })
})

describe('re-basing a log across a change', () => {
  it('a log made on 25 Sep replays onto 23 Oct and 26 Mar with the same weekdays, wall times and balances', () => {
    const { seed, node } = session('2026-09-25')
    node.jump(instantOfAt(seed.t0Date, { day: 2, time: '02:30:00.000' }))
    node.dispatch(coffee('00000000000000a1:review'))
    node.settleDue() // a jump waits for the payment to settle
    node.jump(instantOfAt(seed.t0Date, { day: 2, time: '07:30:00.000' }))
    node.dispatch(coffee('00000000000000a2:review'))
    node.settleDue()
    const rec = recordOf(node, seed.t0Date)
    for (const epoch of ['2026-10-23', '2027-03-26']) {
      const other = buildSeed(content, epoch)
      const r = replay({
        seed: other.state,
        t0: other.t0,
        t0Date: other.t0Date,
        content,
        log: rec.log,
        clock: rec.clock,
      })
      if (!r.ok) throw new Error(JSON.stringify(r.error))
      const times = r.value.log.map((e) => `${formatWeekday(e.at, LJUBLJANA)} ${formatTime(e.at, LJUBLJANA)}`)
      // 02:30 exists on 25 Oct (first pass); on 28 Mar it is in the gap and becomes 03:00.
      expect(times).toEqual(
        epoch === '2026-10-23'
          ? ['Sun 02:30', 'Sun 02:30', 'Sun 07:30', 'Sun 07:30']
          : ['Sun 03:00', 'Sun 03:00', 'Sun 07:30', 'Sun 07:30'],
      )
      expect(formatHundredths(r.value.state.balances.ana?.confirmed ?? Number.NaN)).toBe('245.30')
      expect(invariants(r.value.state)).toEqual([])
    }
  })

  it('a second-pass stamp re-based onto an ordinary Sunday never moves before the entry it followed', () => {
    const { seed, node } = session('2026-10-23')
    const first = resolveLocal('2026-10-25', '02:50', LJUBLJANA)
    node.jump(first)
    node.dispatch(coffee('00000000000000b1:review'))
    node.settleDue()
    node.jump(resolveLocal('2026-10-25', '02:10', LJUBLJANA, { gap: 'next-valid', fold: 'second' }))
    node.dispatch(coffee('00000000000000b2:review'))
    node.settleDue()
    const rec = recordOf(node, seed.t0Date)
    const other = buildSeed(content, '2026-09-25')
    const r = replay({ seed: other.state, t0: other.t0, t0Date: other.t0Date, content, log: rec.log, clock: rec.clock })
    if (!r.ok) throw new Error(JSON.stringify(r.error))
    const ats = r.value.log.map((e) => e.at)
    for (let i = 1; i < ats.length; i++) expect(ats[i] as number).toBeGreaterThanOrEqual(ats[i - 1] as number)
    expect(formatTime(ats.at(-1) as SimTime, LJUBLJANA)).toBe('02:50')
    expect(invariants(r.value.state)).toEqual([])
  })
})

function wire() {
  return {
    type: 'pay' as const,
    to: '@cafelipa' as const,
    amount: '1.10',
    channel: 'qr' as const,
    expect: { senderDebit: '1.10' },
  }
}
