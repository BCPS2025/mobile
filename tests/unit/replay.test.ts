import { describe, expect, it } from 'vitest'
import { invariants } from '@domain/invariants'
import { formatHundredths } from '@domain/money'
import type { SimTime, UserCommand } from '@domain/types'
import { buildSeed } from '@sim/seed'
import { type At, atOfInstant, instantOfAt } from '@sim/tz'
import { createLogEncoder } from '@store/log-codec'
import { createLedgerNode } from '@store/node'
import { snapshotRecord } from '@store/persistence'
import { LIMITS, type LogEntry, freshUi, serializeRecord } from '@store/record'
import { replay } from '@store/replay'
import { restoreText } from '@store/restore'
import { cafeQrBakery } from '../golden/journeys/cafe-qr-bakery'
import { manualTime } from '../support/manual-time'
import { STATE_VERSION, recordOf, sessionOf } from '../support/records'
import { content, m } from './helpers'

// Replay: seed + calendar-stamped log, the live boundary rule, a mutable draft,
// stored T0, re-basing onto another Friday, and live sessions with random timer delays giving the
// same bytes as a headless replay.

const EPOCHS = ['2026-09-25', '2026-10-23', '2027-03-26'] as const
const env = { content }
const bal = (s: { balances: Record<string, { confirmed: number } | undefined> }, a: string) =>
  formatHundredths(s.balances[a]?.confirmed ?? Number.NaN)

describe.each(EPOCHS)('replay at T0 = %s', (epoch) => {
  it('the café loop replays from its record to the byte-identical live state', () => {
    const { seed, node } = sessionOf(epoch)
    const text = serializeRecord(recordOf(node, seed.t0Date))
    const r = restoreText(text, env, { acceptOlder: false })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.recalculated).toBe(false)
    expect(JSON.stringify(r.value.session.state)).toBe(JSON.stringify(node.getState()))
    expect(JSON.stringify(r.value.session.events)).toBe(JSON.stringify(node.events()))
    expect(r.value.session.clock).toBe(node.now())
    expect(r.value.session.log).toEqual(node.log())
    expect(bal(r.value.session.state, 'ana')).toBe('236.50')
    expect(bal(r.value.session.state, 'cafe')).toBe('288.00')
    expect(bal(r.value.session.state, 'bakery')).toBe('8.80')
    expect(Object.isFrozen(r.value.session.state.txs)).toBe(true)
  })

  it('10 × (restore → snapshot) gives the same bytes', () => {
    const { seed, node } = sessionOf(epoch)
    let text = serializeRecord(recordOf(node, seed.t0Date))
    const seen = new Set<string>()
    for (let i = 0; i < 10; i++) {
      const r = restoreText(text, env, { acceptOlder: false })
      if (!r.ok) throw new Error(JSON.stringify(r.error))
      const n = createLedgerNode({ seed: r.value.session.seed, t0: r.value.session.t0 })
      n.loadSession(r.value.session)
      text = serializeRecord(recordOf(n, seed.t0Date))
      seen.add(`${text}|${JSON.stringify(n.getState())}`)
    }
    expect(seen.size).toBe(1)
  })
})

describe('replay rules', () => {
  it('re-bases a file onto another Friday by calendar: same weekdays, wall times and balances', () => {
    const { seed, node } = sessionOf('2026-09-25')
    const rec = recordOf(node, seed.t0Date)
    const other = buildSeed(content, '2027-03-26')
    const r = replay({ seed: other.state, t0: other.t0, t0Date: other.t0Date, content, log: rec.log, clock: rec.clock })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(bal(r.value.state, 'cafe')).toBe('288.00')
    const first = r.value.log[0]
    expect(first && atOfInstant(other.t0Date, first.at)).toEqual({ day: 0, time: '12:16:00.000' })
  })

  it('runs due work before each entry and up to the clock, each item at its own time', () => {
    const { seed, node } = sessionOf('2026-09-25', cafeQrBakery(content).slice(0, 1))
    const rec = recordOf(node, seed.t0Date)
    // Clock left before the settle: the payment is still pending after replay.
    const early = { ...rec, clock: { day: 0, time: '12:16:01.000' } }
    const r1 = replay({
      seed: seed.state,
      t0: seed.t0,
      t0Date: seed.t0Date,
      content,
      log: early.log,
      clock: early.clock,
    })
    expect(r1.ok && Object.values(r1.value.state.txs).filter((t) => t.status === 'pending')).toHaveLength(1)
    const r2 = replay({ seed: seed.state, t0: seed.t0, t0Date: seed.t0Date, content, log: rec.log, clock: rec.clock })
    expect(r2.ok && r2.value.events.map((e) => [e.type, e.at - seed.t0])).toEqual([
      ['tx.submitted', 60_000],
      ['tx.confirmed', 61_400],
    ])
  })

  it('a jump entry moves the clock and is kept in the log', () => {
    const seed = buildSeed(content, '2026-09-25')
    const node = createLedgerNode({ seed: seed.state, t0: seed.t0 })
    const sunday = instantOfAt(seed.t0Date, { day: 2, time: '07:30:00.000' })
    expect(node.jump(sunday).ok).toBe(true)
    const rec = recordOf(node, seed.t0Date)
    expect(rec.log).toEqual([{ at: { day: 2, time: '07:30:00.000' }, jump: true }])
    const r = replay({ seed: seed.state, t0: seed.t0, t0Date: seed.t0Date, content, log: rec.log, clock: rec.clock })
    expect(r.ok && r.value.clock).toBe(sunday)
    expect(r.ok && r.value.log).toEqual([{ at: sunday, jump: true }])
  })

  it('refuses a file when the scheduler would run more items than the cap', () => {
    const { seed, node } = sessionOf('2026-09-25')
    const rec = recordOf(node, seed.t0Date)
    const r = replay({
      seed: seed.state,
      t0: seed.t0,
      t0Date: seed.t0Date,
      content,
      log: rec.log,
      clock: rec.clock,
      cap: 1,
    })
    expect(r).toEqual({ ok: false, error: { code: 'scheduler-cap' } })
  })

  it('stored T0 wins: a record replays on the seed of its own date, whatever day it is now', () => {
    const { seed, node } = sessionOf('2026-10-23')
    const r = restoreText(serializeRecord(recordOf(node, seed.t0Date)), env, { acceptOlder: false })
    expect(r.ok && r.value.session.t0).toBe(seed.t0)
  })
})

/** A small deterministic generator (tests only). */
function rng(seed: number) {
  let x = seed >>> 0 || 1
  return () => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    return (x >>> 0) / 2 ** 32
  }
}

describe('live equals replay', () => {
  it('random timer delays and catch-up points give byte-identical JSON to a headless replay', () => {
    for (let run = 0; run < 25; run++) {
      const rand = rng(1000 + run)
      const seed = buildSeed(content, '2026-09-25')
      const time = manualTime()
      const node = createLedgerNode({ seed: seed.state, t0: seed.t0, timers: time.timers })
      const encoder = createLogEncoder()
      let k = 0
      for (let step = 0; step < 30; step++) {
        const roll = rand()
        if (roll < 0.45) {
          // A command now (the node catches up first); some are refused, which changes nothing.
          const cmd: UserCommand =
            rand() < 0.5
              ? {
                  type: 'pay',
                  actor: 'ana',
                  cmdId: `${(++k).toString(16).padStart(16, '0')}:review`,
                  to: '@cafelipa',
                  amount: m('1.10'),
                  channel: 'qr',
                  expect: { senderDebit: m('1.10') },
                }
              : {
                  type: 'pay',
                  actor: 'cafe',
                  cmdId: `${(++k).toString(16).padStart(16, '0')}:review`,
                  to: '@marko',
                  amount: m('2.00'),
                  channel: 'username',
                  expect: { senderDebit: m('2.02') },
                }
          node.dispatch(cmd)
        } else if (roll < 0.8) {
          // Time passes on the manual clock without the timer firing (a late or throttled timer).
          node.clock.advance(Math.floor(rand() * 3000))
        } else {
          // The timer fires, possibly long after it was due.
          node.clock.advance(Math.floor(rand() * 500))
          time.fireNext()
        }
      }
      const rec = snapshotRecord({
        node,
        meta: { stateVersion: STATE_VERSION, build: 'dev', t0Date: seed.t0Date },
        ui: freshUi(),
        writerEpoch: 1,
        encoder,
      })
      if (!rec.ok) throw new Error(rec.error)
      node.run(node.now(), 'catch-up')
      const r = replay({
        seed: seed.state,
        t0: seed.t0,
        t0Date: seed.t0Date,
        content,
        log: rec.value.log,
        clock: rec.value.clock,
      })
      if (!r.ok) throw new Error(JSON.stringify(r.error))
      expect(JSON.stringify(r.value.state)).toBe(JSON.stringify(node.getState()))
      expect(invariants(r.value.state)).toEqual([])
    }
  })
})

describe('replay performance', () => {
  /** 2,000 accepted payments, two seconds apart: Ana pays the café 1.10 by QR, the café sends Ana 1.00. */
  function longLog(): { log: LogEntry[]; clock: At; t0Date: string } {
    const seed = buildSeed(content, '2026-09-25')
    const log: LogEntry[] = []
    for (let i = 0; i < 2000; i++) {
      const t = (seed.t0 + 60_000 + i * 2000) as SimTime
      const cmdId = `${i.toString(16).padStart(16, '0')}:review`
      const at = atOfInstant(seed.t0Date, t)
      log.push(
        i % 2 === 0
          ? {
              at,
              actor: 'ana',
              cmdId,
              cmd: { type: 'pay', to: '@cafelipa', amount: '1.10', channel: 'qr', expect: { senderDebit: '1.10' } },
            }
          : {
              at,
              actor: 'cafe',
              cmdId,
              cmd: {
                type: 'pay',
                to: '@ana',
                amount: '1.00',
                channel: 'username',
                note: 'Change',
                expect: { senderDebit: '1.01' },
              },
            },
      )
    }
    const clock = atOfInstant(seed.t0Date, (seed.t0 + 60_000 + 2000 * 2000) as SimTime)
    return { log, clock, t0Date: seed.t0Date }
  }

  it('a 2,000-command record is parsed, replayed and checked in under 300 ms', () => {
    const { log, clock, t0Date } = longLog()
    const seed = buildSeed(content, t0Date)
    const draft = replay({ seed: seed.state, t0: seed.t0, t0Date, content, log, clock })
    if (!draft.ok) throw new Error(JSON.stringify(draft.error))
    const n = createLedgerNode({ seed: seed.state, t0: seed.t0 })
    n.loadSession({ seed: seed.state, t0: seed.t0, ...draft.value })
    const text = serializeRecord(recordOf(n, t0Date))
    const times: number[] = []
    for (let i = 0; i < 5; i++) {
      const start = performance.now()
      const r = restoreText(text, env, { acceptOlder: false })
      times.push(performance.now() - start)
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.value.session.log).toHaveLength(2000)
        expect(r.value.recalculated).toBe(false)
      }
    }
    const best = Math.min(...times)
    // Budget: 300 ms with 4× CPU throttling; unthrottled that is 75 ms.
    expect(best).toBeLessThan(75)
    expect(bal(draft.value.state, 'ana')).toBe('147.50')
  })

  /** `n` accepted payments of 0.01 to the café, all at one instant: every one is pending at once. */
  function overlappingText(n: number): string {
    const seed = buildSeed(content, '2026-09-25')
    const at = atOfInstant(seed.t0Date, (seed.t0 + 60_000) as SimTime)
    const log: LogEntry[] = Array.from({ length: n }, (_, i) => ({
      at,
      actor: i % 2 === 0 ? 'ana' : 'marko',
      cmdId: `${i.toString(16).padStart(16, '0')}:review`,
      cmd: { type: 'pay', to: '@cafelipa', amount: '0.01', channel: 'qr', expect: { senderDebit: '0.01' } },
    }))
    const clock = atOfInstant(seed.t0Date, (seed.t0 + 120_000) as SimTime)
    const draft = replay({ seed: seed.state, t0: seed.t0, t0Date: seed.t0Date, content, log, clock })
    if (!draft.ok) throw new Error(JSON.stringify(draft.error))
    expect(draft.value.state.pending).toEqual([])
    const node = createLedgerNode({ seed: seed.state, t0: seed.t0 })
    node.loadSession({ seed: seed.state, t0: seed.t0, ...draft.value })
    return serializeRecord(recordOf(node, seed.t0Date))
  }

  const bestOf = (text: string, runs: number) => {
    const times: number[] = []
    for (let i = 0; i < runs; i++) {
      const start = performance.now()
      const r = restoreText(text, env, { acceptOlder: false })
      times.push(performance.now() - start)
      expect(r.ok).toBe(true)
    }
    return Math.min(...times)
  }

  it('2,000 commands pending at the same time replay within the same budget (no quadratic scan)', () => {
    // 300 ms at 4× throttling, i.e. 75 ms unthrottled, as for the spread-out log above.
    expect(bestOf(overlappingText(2000), 5)).toBeLessThan(75)
  })

  it('a file at the 5,000-entry limit, every payment pending at once, stays within 2.5× that budget', () => {
    expect(bestOf(overlappingText(LIMITS.entries), 3)).toBeLessThan(75 * 2.5)
  })
})
