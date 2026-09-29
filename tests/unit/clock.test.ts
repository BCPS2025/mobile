import { describe, expect, it } from 'vitest'
import type { LedgerState, SimTime, Tx, UserCommand } from '@domain/types'
import { createClock } from '@sim/clock'
import { MAX_TIMER_MS } from '@sim/scheduler'
import { buildSeed } from '@sim/seed'
import { type AppliedBatch, createLedgerNode, isJump } from '@store/node'
import { fakeTime } from '../support/fake-time'
import { EPOCH, content, m } from './helpers'

// The clock store and the node's timer: live time 1:1 only while visible
// and active, never paused while a payment is pending, forward only, timers capped at 60 s.

const seed = buildSeed(content, EPOCH)
const T0 = seed.t0
const IDLE = content.config.clock.idlePauseMs
let k = 0
const sale = (amount = '11.00'): UserCommand => ({
  type: 'pay',
  actor: 'ana',
  cmdId: `${(++k).toString(16).padStart(16, '0')}:review`,
  to: '@cafelipa',
  amount: m(amount),
  channel: 'qr',
  expect: { senderDebit: m(amount) },
})

function live(visible = true) {
  const time = fakeTime()
  const clock = createClock({
    mode: 'live',
    start: T0,
    wallNow: time.wallNow,
    timers: time.timers,
    idleMs: IDLE,
    visible,
  })
  return { time, clock }
}

describe('live clock', () => {
  it('stays on whole milliseconds when the wall clock has fractions (performance.now)', () => {
    const time = fakeTime(1000.25)
    const clock = createClock({
      mode: 'live',
      start: T0,
      wallNow: () => time.wallNow() + 0.3,
      timers: time.timers,
      idleMs: IDLE,
    })
    const seen: number[] = []
    for (const step of [0.4, 999.7, 0.2, 1000.4, 0.35, 12_345.65]) {
      time.advance(step)
      seen.push(clock.now())
      clock.noteInput() // re-anchors on a fractional wall time
      seen.push(clock.now())
    }
    expect(seen.every(Number.isSafeInteger)).toBe(true)
    // Re-anchoring keeps the fractions: no time is lost or gained over the steps.
    expect(clock.now()).toBe(T0 + Math.floor(0.4 + 999.7 + 0.2 + 1000.4 + 0.35 + 12_345.65))
  })

  it('refuses fractional instants and steps', () => {
    const { clock } = live()
    expect(() => clock.jumpTo((T0 + 1.5) as SimTime)).toThrow(/whole milliseconds/)
    expect(() => clock.set((T0 + 0.5) as SimTime)).toThrow(/whole milliseconds/)
    expect(() => clock.advance(0.5)).toThrow()
    const manual = createClock({ start: T0 })
    expect(() => manual.advance(0.5)).toThrow()
    expect(() => manual.jumpTo((T0 + 0.5) as SimTime)).toThrow(/whole milliseconds/)
  })

  it('advances 1:1 with wall time while the page is visible and there was recent input', () => {
    const { time, clock } = live()
    expect(clock.isRunning()).toBe(true)
    time.advance(30_000)
    expect(clock.now()).toBe(T0 + 30_000)
  })

  it('holds after the idle window and continues from the held value on input, not from wall time', () => {
    const { time, clock } = live()
    let changes = 0
    clock.onChange(() => (changes += 1))
    time.advance(IDLE + 600_000)
    expect(clock.now()).toBe(T0 + IDLE)
    expect(clock.isRunning()).toBe(false)
    expect(changes).toBe(1) // the idle transition is reported by the clock's own timer
    expect(time.live()).toHaveLength(0) // a held clock arms nothing
    clock.noteInput()
    expect(clock.isRunning()).toBe(true)
    time.advance(1000)
    expect(clock.now()).toBe(T0 + IDLE + 1000)
  })

  it('pauses while hidden and resumes where it stopped', () => {
    const { time, clock } = live()
    time.advance(5000)
    clock.setVisible(false)
    time.advance(3_600_000)
    expect(clock.now()).toBe(T0 + 5000)
    expect(time.live()).toHaveLength(0)
    clock.setVisible(true)
    time.advance(2000)
    expect(clock.now()).toBe(T0 + 7000)
  })

  it('never pauses while a payment is pending (hidden or idle)', () => {
    const { time, clock } = live(false)
    clock.setHold(true)
    time.advance(IDLE * 3)
    expect(clock.now()).toBe(T0 + IDLE * 3)
    clock.setHold(false)
    time.advance(10_000)
    expect(clock.now()).toBe(T0 + IDLE * 3)
  })

  it('ticks once a minute for minute subscribers, every second only for second subscribers', () => {
    const { time, clock } = live()
    let minutes = 0
    let seconds = 0
    clock.subscribeMinute(() => (minutes += 1))
    time.advance(60_000) // T0 is 12:15:00.000: the next boundary is exactly one minute on
    expect(minutes).toBe(1)
    expect(seconds).toBe(0)
    expect(Math.max(...time.delays())).toBeLessThanOrEqual(60_000)
    const off = clock.subscribeSecond(() => (seconds += 1))
    time.advance(5000)
    expect(seconds).toBe(5)
    off()
    expect(clock.minute()).toBe(T0 + 60_000)
    expect(clock.second()).toBe(T0 + 65_000)
  })

  it('moves forward only; set is the one way back (Reset, loading)', () => {
    const { clock } = live()
    expect(() => clock.jumpTo((T0 - 1) as SimTime)).toThrow(/forward/)
    clock.jumpTo((T0 + 3_600_000) as SimTime)
    expect(clock.now()).toBe(T0 + 3_600_000)
    clock.set(T0)
    expect(clock.now()).toBe(T0)
  })
})

describe('node timer with the clock store', () => {
  it('a live node settles at the exact due time, also while the page is hidden', () => {
    const { time, clock } = live()
    const node = createLedgerNode({ seed: seed.state, t0: T0, timers: time.timers, clock })
    node.dispatch(sale())
    clock.setVisible(false)
    expect(clock.isRunning()).toBe(true) // held by the pending payment
    time.advance(1400)
    expect(node.hasPending()).toBe(false)
    const confirmed = node.events().find((e) => e.type === 'tx.confirmed')
    expect(confirmed?.at).toBe(T0 + 1400)
    expect(clock.isRunning()).toBe(false) // hidden, nothing pending: the clock holds
    time.advance(600_000)
    expect(clock.now()).toBe(T0 + 1400)
  })

  it('late timers never change what happens: items are stamped at their own due time', () => {
    const time = fakeTime()
    const node = createLedgerNode({ seed: seed.state, t0: T0, timers: time.timers })
    node.dispatch(sale())
    node.clock.advance(100)
    node.dispatch(sale('5.50'))
    // The host fires the timer 7 s late: the manual clock sits at 1,500 ms when it fires.
    node.clock.advance(1400)
    time.fireNext()
    const at = node
      .events()
      .filter((e) => e.type === 'tx.confirmed')
      .map((e) => e.at - T0)
    expect(at).toEqual([1400, 1500])
  })

  it('a far due item causes no busy loop: every wait is capped at 60 s and moves the clock', () => {
    const time = fakeTime()
    const far = farPending(seed.state, T0 + 45 * 86_400_000)
    const node = createLedgerNode({ seed: far, t0: T0, timers: time.timers })
    node.run(T0) // arms the timer
    for (let i = 0; i < 10; i++) expect(time.fireNext()).toBe(true)
    expect(new Set(time.delays())).toEqual(new Set([MAX_TIMER_MS]))
    expect(node.now()).toBe(T0 + 10 * MAX_TIMER_MS)
    expect(node.events()).toHaveLength(0)
  })

  it('a paused live clock arms no scheduler timer; resuming re-arms it', () => {
    const { time, clock } = live()
    const far = farPending(seed.state, T0 + 3 * 60_000)
    const node = createLedgerNode({ seed: far, t0: T0, timers: time.timers, clock })
    node.run(T0)
    // The far item is pending, so the clock is held running; release the hold to test pausing.
    clock.setHold(false)
    clock.setVisible(false)
    expect(time.live()).toHaveLength(0)
    clock.setVisible(true)
    expect(time.live().length).toBeGreaterThan(0)
    expect(Math.max(...time.live().map((h) => h.ms))).toBeLessThanOrEqual(MAX_TIMER_MS)
  })

  it('the ledger notifies on events only, not on clock ticks', () => {
    const { time, clock } = live()
    const node = createLedgerNode({ seed: seed.state, t0: T0, timers: time.timers, clock })
    let notified = 0
    node.subscribe(() => (notified += 1))
    time.advance(90_000)
    expect(notified).toBe(0)
    node.dispatch(sale())
    expect(notified).toBe(1)
  })
})

describe('Clock jumps', () => {
  it('are refused while a payment is pending and backwards; accepted ones are logged', () => {
    const node = createLedgerNode({ seed: seed.state, t0: T0 })
    const origins: string[] = []
    node.onBatch((b: AppliedBatch) => origins.push(b.origin))
    node.dispatch(sale())
    expect(node.jump((T0 + 3_600_000) as SimTime)).toEqual({ ok: false, error: 'pending' })
    node.settleDue()
    expect(node.jump(node.now())).toEqual({ ok: false, error: 'backwards' })
    const r = node.jump((T0 + 3_600_000) as SimTime)
    expect(r.ok).toBe(true)
    expect(node.now()).toBe(T0 + 3_600_000)
    expect(node.log().map((e) => (isJump(e) ? `jump@${e.at - T0}` : e.cmd.type))).toEqual(['pay', 'jump@3600000'])
    expect(node.commands()).toHaveLength(1)
    expect(origins).toEqual(['user', 'timer'])
  })

  it('loadSession takes over a session as one replay batch; keepUndo makes it undoable', () => {
    const node = createLedgerNode({ seed: seed.state, t0: T0 })
    node.dispatch(sale())
    node.settleDue()
    const session = {
      seed: node.seedState(),
      t0: node.t0(),
      state: node.getState(),
      events: node.events(),
      log: node.log(),
      clock: node.now(),
    }
    node.resetToSeed()
    const batches: AppliedBatch[] = []
    node.onBatch((b) => batches.push(b))
    const g = node.generation()
    node.loadSession(session, { keepUndo: true })
    expect(node.generation()).toBe(g + 1)
    expect(batches.map((b) => [b.origin, b.events.length])).toEqual([['replay', 2]])
    expect(node.getState()).toBe(session.state)
    expect(node.undoReset()).toBe(true)
    expect(node.events()).toHaveLength(0)
  })
})

/** The seed with one pending transaction due at `dueAt` (to exercise long waits). */
function farPending(s: LedgerState, dueAt: number): LedgerState {
  const node = createLedgerNode({ seed: s, t0: T0 })
  node.dispatch(sale())
  const st = node.getState()
  const id = st.txOrder[st.txOrder.length - 1] as string
  const tx = st.txs[id] as Tx
  return { ...st, txs: { ...st.txs, [id]: { ...tx, dueAt: dueAt as SimTime } } }
}
