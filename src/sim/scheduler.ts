import { decideDue, dueHeads, earliestDueAt } from '@domain/ledger'
import type { DueItem, DueKind, LedgerState, PendingEvent, SimTime } from '@domain/types'

// The scheduler: due work is derived from state, never stored. Items run one at a
// time in a total order, each at its own timestamp, and the due set is re-derived after every
// item (an item can create new work). Live use and replay share this code, so a late timer can
// never change what a command is decided against: the node runs everything due up to a
// command's time before deciding it.
//
// Milestone A1 derives settle items only. Later kinds (bank arrivals, escrow deadlines, renewals,
// background activity, auto-convert) join by being derived in `dueWork` and `dueHeads` (the
// first due item of each kind, without a scan of all work) and answered in `decideDue`;
// KIND_RANK already orders them, and live use, replay (store/replay) and the timer cap need no
// change.

/** Kind rank for items due at the same instant. */
export const KIND_RANK: Record<DueKind, number> = {
  settle: 0,
  'ramp-arrival': 1,
  'escrow-deadline': 2,
  subscription: 3,
  background: 4,
  'auto-convert': 5,
}

/** Items per run before the scheduler gives up (bounds imported files). */
export const ITERATION_CAP = 20_000

/** Timers never wait longer than this (browsers fire delays above 2³¹ − 1 ms at once). */
export const MAX_TIMER_MS = 60_000

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Total order: (dueAt, kind rank, persona id, entity id). */
export function compareDue(a: DueItem, b: DueItem): number {
  return (
    a.dueAt - b.dueAt ||
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    cmp(a.persona, b.persona) ||
    cmp(a.entityId, b.entityId)
  )
}

/** The first item in the total order due at or before `until`, or null. */
export function nextDue(s: LedgerState, until: SimTime): DueItem | null {
  let best: DueItem | null = null
  for (const item of dueHeads(s, until)) {
    if (item.dueAt > until) continue
    if (best === null || compareDue(item, best) < 0) best = item
  }
  return best
}

/** The earliest due time of any item (for arming a timer), or null when nothing is scheduled. */
export function nextDueAt(s: LedgerState): SimTime | null {
  return earliestDueAt(s)
}

/** Timer delay for the next item: never negative, never above MAX_TIMER_MS; null = no timer. */
export function timerDelay(s: LedgerState, now: SimTime): number | null {
  const due = nextDueAt(s)
  if (due === null) return null
  return Math.min(Math.max(0, due - now), MAX_TIMER_MS)
}

export class SchedulerCapError extends Error {
  constructor() {
    super(`scheduler stopped after ${ITERATION_CAP} items`)
  }
}

/**
 * Runs every item due at or before `until`, one at a time. `apply` receives each item's events
 * (to be stamped at item.dueAt) and returns the state after applying them.
 */
export function runDue(
  initial: LedgerState,
  until: SimTime,
  apply: (item: DueItem, events: PendingEvent[], s: LedgerState) => LedgerState,
  cap: number = ITERATION_CAP,
): LedgerState {
  let s = initial
  for (let n = 0; ; n++) {
    const item = nextDue(s, until)
    if (item === null) return s
    if (n >= cap) throw new SchedulerCapError()
    const events = decideDue(s, item)
    if (events.length === 0) throw new Error(`due item ${item.kind}/${item.entityId} produced no events`)
    s = apply(item, events, s)
  }
}
