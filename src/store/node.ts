import { decide, evolve, pendingTxs } from '@domain/ledger'
import type {
  BatchOrigin,
  DomainError,
  LedgerEvent,
  LedgerState,
  PendingEvent,
  PersonaId,
  Result,
  SimTime,
  SysRun,
  UserCommand,
} from '@domain/types'
import { type ClockStore, type Timers, createClock } from '@sim/clock'
import { runDue, timerDelay } from '@sim/scheduler'

// One page, one ledger: every phone is a view over this single node.
// dispatch -> run due work up to the command's time -> decide -> evolve -> notify.
// The node notifies only on events and loads; the time lives in its clock store.
// Screen stacks live in store/nav, persistence in store/persistence.

export type { Timers }

export interface LedgerNodeOptions {
  seed: LedgerState
  t0: SimTime
  /** Wall-clock timers for due work (UI). Omit or null for headless use. */
  timers?: Timers | null
  /** The virtual clock; a manual clock at t0 when omitted. */
  clock?: ClockStore
}

/** An accepted user command, stamped with the virtual clock (the command log). */
export interface LoggedCommand {
  at: SimTime
  actor: PersonaId
  cmdId: string
  cmd: UserCommand
}

/** A Clock jump (presenter tools), logged as its own entry. */
export interface LoggedJump {
  at: SimTime
  jump: true
}

/** The session log: accepted user commands and Clock jumps, in time order. */
export type NodeLogEntry = LoggedCommand | LoggedJump

export const isJump = (e: NodeLogEntry): e is LoggedJump => 'jump' in e

/** Events applied together, with where they came from (effects coalesce by origin). */
export interface AppliedBatch {
  origin: BatchOrigin
  events: readonly LedgerEvent[]
}

/** A session rebuilt elsewhere (store/replay) that the node takes over as it is. */
export interface LoadedSession {
  seed: LedgerState
  t0: SimTime
  state: LedgerState
  events: readonly LedgerEvent[]
  log: readonly NodeLogEntry[]
  clock: SimTime
}

export type JumpRefusal = 'pending' | 'backwards' | 'invalid-time'

export interface LedgerNode {
  getState(): LedgerState
  /** The starting ledger of the current session (changes when Reset recomputes T0). */
  seedState(): LedgerState
  t0(): SimTime
  /** Called after every applied batch and every load (not on clock ticks). */
  subscribe(listener: () => void): () => void
  /** Called once per applied live event, after the state is updated (not for loads). */
  onEvent(listener: (e: LedgerEvent, s: LedgerState) => void): () => void
  /**
   * Called once per applied batch, after its last event. Loads (Reset, Undo, a restored or
   * imported session) arrive as one `replay` batch with every event of the session: derived
   * indexes rebuild from it, and effects ignore it.
   */
  onBatch(listener: (batch: AppliedBatch, s: LedgerState) => void): () => void
  readonly clock: ClockStore
  now(): SimTime
  /** Increments on every reset, undo and load. Timers and animations check it. */
  generation(): number
  events(): readonly LedgerEvent[]
  /** Accepted user commands only. */
  commands(): readonly LoggedCommand[]
  /** Accepted user commands and Clock jumps, in order (what the record stores). */
  log(): readonly NodeLogEntry[]
  /** A user command, or the internal sys.run. Due work up to now runs first (catch-up). */
  dispatch(c: UserCommand | SysRun): Result<LedgerEvent[], DomainError>
  /** Runs every due item up to `until` (never beyond the clock), each at its own time. */
  run(until: SimTime, origin?: BatchOrigin): LedgerEvent[]
  /** Moves the clock forward to t and runs what fell due (forward only; not logged). */
  advanceTo(t: SimTime, origin?: BatchOrigin): LedgerEvent[]
  /**
   * The Clock control's jump: refused while a payment is pending or when t is not after now;
   * otherwise logged as a jump entry and applied as a `jump` batch.
   */
  jump(t: SimTime): Result<LedgerEvent[], JumpRefusal>
  /** Headless: move the clock to each pending transaction's due time and settle it. */
  settleDue(): LedgerEvent[]
  hasPending(): boolean
  /** Back to the starting ledger (optionally a new one, when T0 is recomputed); keeps one Undo. */
  resetToSeed(next?: { seed: LedgerState; t0: SimTime }): void
  /** Takes over a replayed session (boot, import, Start from); `keepUndo` makes it undoable. */
  loadSession(session: LoadedSession, opts?: { keepUndo?: boolean }): void
  /** Restores the session the last reset or load replaced (until the next command or clearUndo). */
  undoReset(): boolean
  canUndoReset(): boolean
  clearUndo(): void
  dispose(): void
}

type Snapshot = LoadedSession

export function createLedgerNode(opts: LedgerNodeOptions): LedgerNode {
  let seed = opts.seed
  let t0 = opts.t0
  const timers = opts.timers ?? null
  const clock = opts.clock ?? createClock({ start: t0 })
  const listeners = new Set<() => void>()
  const eventListeners = new Set<(e: LedgerEvent, s: LedgerState) => void>()
  const batchListeners = new Set<(b: AppliedBatch, s: LedgerState) => void>()

  let state = seed
  let events: LedgerEvent[] = []
  let log: NodeLogEntry[] = []
  let gen = 0
  let undo: Snapshot | null = null
  let timer: unknown = null
  let disposed = false

  const notify = () => {
    for (const l of [...listeners]) l()
  }

  function applyOne(pending: PendingEvent, at: SimTime, out: LedgerEvent[]): void {
    const e = { ...pending, seq: state.seq + 1, at } as LedgerEvent
    state = evolve(state, e)
    events.push(e)
    out.push(e)
    for (const l of [...eventListeners]) l(e, state)
  }

  function emitBatch(origin: BatchOrigin, applied: readonly LedgerEvent[]): void {
    if (applied.length === 0 && origin !== 'replay') return
    const batch: AppliedBatch = { origin, events: applied }
    for (const l of [...batchListeners]) l(batch, state)
  }

  /** The live clock never pauses while a payment is pending. */
  const syncHold = () => clock.setHold(pendingTxs(state).length > 0)

  function runInternal(until: SimTime, origin: BatchOrigin): LedgerEvent[] {
    const applied: LedgerEvent[] = []
    runDue(state, until, (item, pending) => {
      for (const p of pending) applyOne(p, item.dueAt, applied)
      return state
    })
    emitBatch(origin, applied)
    return applied
  }

  function clearTimer(): void {
    if (timers && timer !== null) timers.clear(timer)
    timer = null
  }

  // One timer while the clock can move: delay = min(next due − now, 60 s). A live clock that
  // is paused (hidden, idle) arms nothing; the clock's change event re-arms on resume.
  function armTimer(): void {
    if (!timers || disposed) return
    clearTimer()
    if (clock.mode === 'live' && !clock.isRunning()) return
    const armedAt = clock.now()
    const delay = timerDelay(state, armedAt)
    if (delay === null) return
    const myGen = gen
    timer = timers.set(() => {
      timer = null
      if (myGen !== gen || disposed) return
      // A manual clock follows the wait, never beyond the next due time; a live one moves itself.
      const target = (armedAt + delay) as SimTime
      if (clock.mode === 'manual' && clock.now() < target) clock.jumpTo(target)
      const applied = runInternal(clock.now(), 'timer')
      syncHold()
      armTimer()
      if (applied.length > 0) notify()
    }, delay)
  }

  const offClock = clock.onChange(() => {
    if (clock.mode === 'live') armTimer()
  })

  function afterBatch(applied: readonly LedgerEvent[]): void {
    syncHold()
    armTimer()
    if (applied.length > 0) notify()
  }

  // Due work never runs ahead of the clock: a settle stamped later than `now` would let the next
  // command spend money that replay has not settled yet (live must equal replay).
  function run(until: SimTime, origin: BatchOrigin = 'timer'): LedgerEvent[] {
    const applied = runInternal(Math.min(until, clock.now()) as SimTime, origin)
    afterBatch(applied)
    return applied
  }

  function dispatch(c: UserCommand | SysRun): Result<LedgerEvent[], DomainError> {
    if (c.type === 'sys.run') return { ok: true, value: run(c.until, 'timer') }
    const now = clock.now()
    const caught = runInternal(now, 'catch-up')
    const decided = decide(state, c, { now })
    if (!decided.ok) {
      afterBatch(caught)
      return decided
    }
    const applied: LedgerEvent[] = []
    for (const p of decided.value) applyOne(p, now, applied)
    log.push({ at: now, actor: c.actor, cmdId: c.cmdId, cmd: c })
    emitBatch('user', applied)
    undo = null
    afterBatch(applied)
    return { ok: true, value: applied }
  }

  function advanceTo(t: SimTime, origin: BatchOrigin = 'jump'): LedgerEvent[] {
    if (t < clock.now()) throw new Error('the clock only moves forward')
    clock.jumpTo(t)
    const applied = runInternal(t, origin)
    afterBatch(applied)
    return applied
  }

  function jump(t: SimTime): Result<LedgerEvent[], JumpRefusal> {
    if (!Number.isSafeInteger(t)) return { ok: false, error: 'invalid-time' }
    if (pendingTxs(state).length > 0) return { ok: false, error: 'pending' }
    if (!(t > clock.now())) return { ok: false, error: 'backwards' }
    log.push({ at: t, jump: true })
    undo = null
    return { ok: true, value: advanceTo(t, 'jump') }
  }

  function settleDue(): LedgerEvent[] {
    const out: LedgerEvent[] = []
    for (;;) {
      const pending = pendingTxs(state)
      if (pending.length === 0) break
      const due = Math.min(...pending.map((tx) => tx.dueAt)) as SimTime
      if (clock.now() < due) clock.jumpTo(due)
      const applied = runInternal(clock.now(), 'timer')
      if (applied.length === 0) break
      out.push(...applied)
    }
    afterBatch(out)
    return out
  }

  function load(s: Snapshot): void {
    gen += 1
    clearTimer()
    seed = s.seed
    t0 = s.t0
    state = s.state
    events = [...s.events]
    log = [...s.log]
    clock.set(s.clock)
    emitBatch('replay', events)
    syncHold()
    armTimer()
    notify()
  }

  const snapshot = (): Snapshot => ({ seed, t0, state, events: [...events], log: [...log], clock: clock.now() })

  return {
    getState: () => state,
    seedState: () => seed,
    t0: () => t0,
    subscribe(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    onEvent(l) {
      eventListeners.add(l)
      return () => eventListeners.delete(l)
    },
    onBatch(l) {
      batchListeners.add(l)
      return () => batchListeners.delete(l)
    },
    clock,
    now: () => clock.now(),
    generation: () => gen,
    events: () => events,
    commands: () => log.filter((e): e is LoggedCommand => !isJump(e)),
    log: () => log,
    dispatch,
    run,
    advanceTo,
    jump,
    settleDue,
    hasPending: () => pendingTxs(state).length > 0,
    resetToSeed(next) {
      undo = snapshot()
      const nextSeed = next?.seed ?? seed
      const nextT0 = next?.t0 ?? t0
      load({ seed: nextSeed, t0: nextT0, state: nextSeed, events: [], log: [], clock: nextT0 })
    },
    loadSession(session, o) {
      undo = o?.keepUndo ? snapshot() : null
      load(session)
    },
    undoReset() {
      if (!undo) return false
      const s = undo
      undo = null
      load(s)
      return true
    },
    canUndoReset: () => undo !== null,
    clearUndo() {
      undo = null
    },
    dispose() {
      clearTimer()
      disposed = true
      offClock()
      gen += 1
      listeners.clear()
      eventListeners.clear()
      batchListeners.clear()
    },
  }
}
