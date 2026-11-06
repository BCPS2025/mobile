import type { Content } from '@content/schema'
import { applyToDraft, beginDraft, decide, finishDraft } from '@domain/ledger'
import type { DomainError, LedgerEvent, LedgerState, PendingEvent, SimTime } from '@domain/types'
import { decideCtx } from '@sim/banking'
import { ITERATION_CAP, SchedulerCapError, runDue } from '@sim/scheduler'
import { type At, type IsoDate, LJUBLJANA, instantOfAt } from '@sim/tz'
import { type CodecError, decodeCommand } from './log-codec'
import type { NodeLogEntry } from './node'
import { type LogEntry, isJumpEntry } from './record'

// Ledger = seed + command log. Replay applies exactly the live boundary rule of
// Before each entry the scheduler runs every item due at or before the entry's time, one
// at a time in the total order and each at its own time; then the entry is decided at its time
// (a jump entry only moves the clock); after the last entry the scheduler runs up to `clock`.
// Scheduler work (settling, and from later milestones conversions, renewals, deadlines, bank
// arrivals and background activity) is re-derived, never stored, so a file cannot inject money.
//
// The state is rebuilt in one mutable draft and frozen once at the end, so a log of thousands
// of commands replays in linear time. Every command must be accepted; the first refusal stops.

export interface ReplayInput {
  /** The starting ledger for `t0Date` (buildSeed). */
  seed: LedgerState
  /** T0 as an instant (the seed's end). */
  t0: SimTime
  t0Date: IsoDate
  content: Content
  log: readonly LogEntry[]
  /** Where the clock stood; the scheduler runs up to it after the last entry. */
  clock: At
  tz?: string
  /** Scheduler items allowed over the whole replay (a file that needs more is refused). */
  cap?: number
}

export interface Replayed {
  state: LedgerState
  events: LedgerEvent[]
  /** The node's log, each entry paired with the stored form it came from (same index). */
  log: NodeLogEntry[]
  clock: SimTime
}

export type ReplayFailure =
  | { code: 'refused'; index: number; error: DomainError }
  | { code: 'undecodable'; index: number; error: CodecError }
  | { code: 'before-t0'; index: number }
  | { code: 'scheduler-cap' }
  /** Something threw while replaying entry `index` (null: after the last entry). A file is
   *  untrusted: an unexpected exception refuses it instead of escaping to the caller. */
  | { code: 'exception'; index: number | null }

export type ReplayResult = { ok: true; value: Replayed } | { ok: false; error: ReplayFailure }

/** Freezes a replayed state in place (entries shared with the seed are frozen too; nothing
 *  writes to state entries: evolve replaces them). */
function deepFreeze<T>(v: T): T {
  const stack: unknown[] = [v]
  while (stack.length > 0) {
    const x = stack.pop()
    if (x && typeof x === 'object' && !Object.isFrozen(x)) {
      Object.freeze(x)
      for (const k of Object.keys(x)) stack.push((x as Record<string, unknown>)[k])
    }
  }
  return v
}

export function replay(input: ReplayInput): ReplayResult {
  const tz = input.tz ?? LJUBLJANA
  const draft = beginDraft(input.seed)
  const events: LedgerEvent[] = []
  const log: NodeLogEntry[] = []
  let budget = input.cap ?? ITERATION_CAP
  let now = input.t0

  const push = (p: PendingEvent, at: SimTime) => {
    const e = { ...p, seq: draft.state.seq + 1, at } as LedgerEvent
    applyToDraft(draft, e)
    events.push(e)
  }

  const runUntil = (until: SimTime) => {
    let used = 0
    runDue(
      draft.state,
      until,
      (item, pending) => {
        used += 1
        for (const p of pending) push(p, item.dueAt)
        return draft.state
      },
      budget,
    )
    budget -= used
  }

  // A calendar stamp re-based onto another T0 can land a little earlier than the entry before
  // it (a stamp in a spring gap, or a second-pass autumn stamp on an ordinary Sunday); times
  // never move backwards, so such an entry happens at the previous entry's time.
  const instant = (at: At): SimTime => {
    const t = instantOfAt(input.t0Date, at, tz)
    return (t > now ? t : now) as SimTime
  }

  let index: number | null = null
  try {
    for (const [i, entry] of input.log.entries()) {
      index = i
      const raw = instantOfAt(input.t0Date, entry.at, tz)
      if (raw < input.t0) return { ok: false, error: { code: 'before-t0', index: i } }
      const at = (raw > now ? raw : now) as SimTime
      runUntil(at)
      now = at
      if (isJumpEntry(entry)) {
        log.push({ at, jump: true })
        continue
      }
      const cmd = decodeCommand(draft.state, input.content, entry)
      if (!cmd.ok) return { ok: false, error: { code: 'undecodable', index: i, error: cmd.error } }
      const decided = decide(draft.state, cmd.value, decideCtx(draft.state.config, at))
      if (!decided.ok) return { ok: false, error: { code: 'refused', index: i, error: decided.error } }
      for (const p of decided.value) push(p, at)
      log.push({ at, actor: entry.actor, cmdId: entry.cmdId, cmd: cmd.value })
    }
    index = null
    const end = instant(input.clock)
    runUntil(end)
    now = end
  } catch (e) {
    if (e instanceof SchedulerCapError) return { ok: false, error: { code: 'scheduler-cap' } }
    return { ok: false, error: { code: 'exception', index } }
  }
  const state = deepFreeze(finishDraft(draft))
  return { ok: true, value: { state, events, log, clock: now } }
}
