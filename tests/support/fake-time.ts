// A fake wall clock with timers, for the live clock, the node's scheduler timer and persistence.
// `advance(ms)` moves wall time forward and fires every timer that falls due, in order.
import type { Timers } from '@sim/clock'

interface Handle {
  fn: () => void
  at: number
  ms: number
  cleared: boolean
  id: number
}

export interface FakeTime {
  timers: Timers
  wallNow: () => number
  advance(ms: number): void
  /** Timers not yet fired or cleared. */
  live(): { ms: number; at: number }[]
  /** Every delay ever requested. */
  delays(): number[]
  /** Fires the next live timer (moving wall time to it). */
  fireNext(): boolean
}

export function fakeTime(start = 1_000_000): FakeTime {
  let wall = start
  let seq = 0
  const queue: Handle[] = []
  const next = () => queue.filter((h) => !h.cleared).sort((a, b) => a.at - b.at || a.id - b.id)[0] as Handle | undefined
  const fire = (h: Handle) => {
    h.cleared = true
    wall = Math.max(wall, h.at)
    h.fn()
  }
  return {
    timers: {
      set(fn, ms) {
        const h: Handle = { fn, at: wall + ms, ms, cleared: false, id: seq++ }
        queue.push(h)
        return h
      },
      clear(h) {
        if (h) (h as Handle).cleared = true
      },
    },
    wallNow: () => wall,
    advance(ms) {
      const end = wall + ms
      for (let guard = 0; guard < 1_000_000; guard++) {
        const h = next()
        if (!h || h.at > end) break
        fire(h)
      }
      wall = end
    },
    live: () => queue.filter((h) => !h.cleared).map((h) => ({ ms: h.ms, at: h.at })),
    delays: () => queue.map((h) => h.ms),
    fireNext() {
      const h = next()
      if (!h) return false
      fire(h)
      return true
    },
  }
}
