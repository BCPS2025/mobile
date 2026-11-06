import type { SimTime } from '@domain/types'

// The virtual clock, a store of its own: the ledger notifies only on events, and
// screens that show the time subscribe here (minute ticks for status bars and dates, second
// ticks only inside a code countdown), so an idle stage makes no renders except the minute tick.
//
// Modes:
// - manual (headless use, `?clock=manual`): time moves only when told to (advance, jumpTo, set;
//   the node moves it to each due time while it waits on a timer);
// - live (the app): time advances 1:1 with the wall clock, but only while the page is visible and
//   there was input in the last `idleMs`, and always while a payment is pending (`setHold`). It
//   continues from the stored value on reopen, never from wall time.
// Time moves forward only, except through `set` (Reset and loading a session).

export interface Timers {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

export interface SimClock {
  now(): SimTime
  /** Moves forward by `ms` (≥ 0). */
  advance(ms: number): void
  /** Moves forward to `t`; throws when `t` is earlier than now. */
  jumpTo(t: SimTime): void
}

export type ClockMode = 'live' | 'manual'

export interface ClockStore extends SimClock {
  readonly mode: ClockMode
  /** Places the clock anywhere, backwards included (Reset, loading a session). */
  set(t: SimTime): void
  /** Live: whether time is moving now. Manual: always false (it moves only when told to). */
  isRunning(): boolean
  /** Page visibility (live mode pauses while hidden, unless a payment is pending; showing the
   *  page again counts as input). */
  setVisible(visible: boolean): void
  /** User input: restarts the idle window. */
  noteInput(): void
  /** True while a payment is pending: the live clock never pauses then. */
  setHold(hold: boolean): void
  /** The current minute (now floored to 60 s); stable between minute ticks. */
  minute(): SimTime
  /** The current second (now floored to 1 s); stable between second ticks. */
  second(): SimTime
  /** Called when the minute changes (ticks, jumps, set). */
  subscribeMinute(listener: () => void): () => void
  /** Called every second while running (and on jumps, set); subscribe only where needed. */
  subscribeSecond(listener: () => void): () => void
  /** Called when the clock starts or stops running, and after every jump or set. */
  onChange(listener: () => void): () => void
  dispose(): void
}

export interface ManualClockOptions {
  mode?: 'manual'
  start: SimTime
}

export interface LiveClockOptions {
  mode: 'live'
  start: SimTime
  /** Monotonic wall time in ms (performance.now in the app; fractions are fine: the clock
   *  itself only ever holds whole milliseconds). */
  wallNow: () => number
  timers: Timers
  /** The clock holds after this long without input (config clock.idlePauseMs). */
  idleMs: number
  visible?: boolean
}

const floorTo = (t: number, unit: number) => (Math.floor(t / unit) * unit) as SimTime

/** Virtual time is whole milliseconds: stamps, due times and replay all depend on it. */
function wholeMs(t: number, what: string): SimTime {
  if (!Number.isSafeInteger(t)) throw new Error(`${what} expects whole milliseconds, got ${t}`)
  return t as SimTime
}

function emit(set: ReadonlySet<() => void>): void {
  for (const l of [...set]) l()
}

function subscriber(set: Set<() => void>, onChange?: () => void) {
  return (l: () => void) => {
    set.add(l)
    onChange?.()
    return () => {
      set.delete(l)
      onChange?.()
    }
  }
}

export function createClock(opts: ManualClockOptions | LiveClockOptions): ClockStore {
  return opts.mode === 'live' ? createLiveClock(opts) : createManualClock(opts.start)
}

function createManualClock(start: SimTime): ClockStore {
  let t = start
  const minuteLs = new Set<() => void>()
  const secondLs = new Set<() => void>()
  const changeLs = new Set<() => void>()
  const moved = (prev: SimTime) => {
    if (floorTo(prev, 60_000) !== floorTo(t, 60_000)) emit(minuteLs)
    if (floorTo(prev, 1000) !== floorTo(t, 1000)) emit(secondLs)
  }
  const moveTo = (next: SimTime, notifyChange: boolean) => {
    if (next === t) return
    const prev = t
    t = next
    moved(prev)
    if (notifyChange) emit(changeLs)
  }
  return {
    mode: 'manual',
    now: () => t,
    advance(ms) {
      if (!Number.isSafeInteger(ms) || ms < 0) throw new Error('advance expects a non-negative number of ms')
      moveTo((t + ms) as SimTime, false)
    },
    jumpTo(next) {
      wholeMs(next, 'jumpTo')
      if (next < t) throw new Error('the clock only moves forward')
      moveTo(next, true)
    },
    set(next) {
      moveTo(wholeMs(next, 'set'), true)
    },
    isRunning: () => false,
    setVisible() {},
    noteInput() {},
    setHold() {},
    minute: () => floorTo(t, 60_000),
    second: () => floorTo(t, 1000),
    subscribeMinute: subscriber(minuteLs),
    subscribeSecond: subscriber(secondLs),
    onChange: subscriber(changeLs),
    dispose() {
      minuteLs.clear()
      secondLs.clear()
      changeLs.clear()
    },
  }
}

function createLiveClock(opts: LiveClockOptions): ClockStore {
  const { wallNow, timers, idleMs } = opts
  let base = wholeMs(opts.start, 'the live clock')
  let anchor = wallNow()
  let visible = opts.visible ?? true
  let lastInput = anchor
  let hold = false
  let disposed = false
  let timer: unknown = null
  const minuteLs = new Set<() => void>()
  const secondLs = new Set<() => void>()
  const changeLs = new Set<() => void>()

  /** Wall time up to which the clock has run since the anchor. */
  const runUntil = (wall: number): number => {
    if (hold) return wall
    if (!visible) return anchor
    return Math.min(wall, Math.max(anchor, lastInput + idleMs))
  }
  // performance.now has fractions: the elapsed wall time is floored, so now() stays whole.
  const now = (): SimTime => (base + Math.floor(runUntil(wallNow()) - anchor)) as SimTime
  const running = (): boolean => hold || (visible && wallNow() < lastInput + idleMs)

  let shownMinute = floorTo(base, 60_000)
  let shownSecond = floorTo(base, 1000)
  let wasRunning = running()

  /** Re-bases the clock on the wall clock (after any change of the running conditions). The
   *  anchor keeps the fraction that `now()` floored away, so re-basing never loses time. */
  const reanchor = () => {
    const wall = wallNow()
    const ran = runUntil(wall) - anchor
    const whole = Math.floor(ran)
    base = (base + whole) as SimTime
    anchor = wall - (ran - whole)
  }

  const report = (forceChange: boolean) => {
    const t = now()
    const m = floorTo(t, 60_000)
    const sec = floorTo(t, 1000)
    const r = running()
    if (m !== shownMinute) {
      shownMinute = m
      emit(minuteLs)
    }
    if (sec !== shownSecond) {
      shownSecond = sec
      emit(secondLs)
    }
    if (forceChange || r !== wasRunning) {
      wasRunning = r
      emit(changeLs)
    }
  }

  const arm = () => {
    if (timer !== null) {
      timers.clear(timer)
      timer = null
    }
    if (disposed || !running()) return
    const t = now()
    const wall = wallNow()
    const waits: number[] = [60_000 - (t % 60_000)]
    if (secondLs.size > 0) waits.push(1000 - (t % 1000))
    if (!hold) waits.push(lastInput + idleMs - wall)
    const delay = Math.max(1, Math.ceil(Math.min(...waits)))
    timer = timers.set(() => {
      timer = null
      report(false)
      arm()
    }, delay)
  }

  const conditionsChanged = (mutate: () => void) => {
    reanchor()
    mutate()
    report(false)
    arm()
  }

  const moveTo = (next: SimTime) => {
    base = wholeMs(next, 'the live clock')
    anchor = wallNow()
    report(true)
    arm()
  }

  arm()

  return {
    mode: 'live',
    now,
    advance(ms) {
      if (!Number.isSafeInteger(ms) || ms < 0) throw new Error('advance expects a non-negative number of ms')
      if (ms > 0) moveTo((now() + ms) as SimTime)
    },
    jumpTo(next) {
      const t = now()
      if (next < t) throw new Error('the clock only moves forward')
      if (next !== t) moveTo(next)
    },
    set: moveTo,
    isRunning: running,
    setVisible(v) {
      // Coming back to the page counts as input.
      if (v !== visible)
        conditionsChanged(() => {
          visible = v
          if (v) lastInput = wallNow()
        })
    },
    noteInput() {
      conditionsChanged(() => (lastInput = wallNow()))
    },
    setHold(h) {
      if (h !== hold) conditionsChanged(() => (hold = h))
    },
    minute: () => floorTo(now(), 60_000),
    second: () => floorTo(now(), 1000),
    subscribeMinute: subscriber(minuteLs),
    subscribeSecond: subscriber(secondLs, arm),
    onChange: subscriber(changeLs),
    dispose() {
      disposed = true
      if (timer !== null) timers.clear(timer)
      timer = null
      minuteLs.clear()
      secondLs.clear()
      changeLs.clear()
    },
  }
}
