import type { Content } from '@content/schema'
import type { DomainError, LedgerEvent, Result, SimTime, UserCommand } from '@domain/types'
import { type ClockMode, type ClockStore, type Timers, createClock } from '@sim/clock'
import { buildSeed } from '@sim/seed'
import { type IsoDate, LJUBLJANA, daysBetween, instantOfAt, localDateOf, localTimeOf } from '@sim/tz'
import { CMD_ID, newFlowInstanceId } from './cmdIds'
import { createLogEncoder, decodeCommand, encodeCommand } from './log-codec'
import { type JumpRefusal, type LedgerNode, type LoadedSession, createLedgerNode } from './node'
import {
  type FlushOutcome,
  type Persister,
  QUARANTINE_KEY,
  type SessionMeta,
  type StorageLike,
  type Usage,
  createPersister,
  readClockStamp,
  safeGet,
  safeRemove,
  safeSet,
  stateKey,
  stateKeys,
  storedEpoch,
  storedWriter,
} from './persistence'
import {
  LIMITS,
  type UiState,
  checkWireCommand,
  fitRecordUi,
  freshUi,
  isRecordPersonaId,
  stableStringify,
  stripControl,
} from './record'
import { type RestoreEnv, type Restored, parseFor, personaIdsOf, restoreRecord, restoreText } from './restore'
import { type LockManagerLike, type WriterLock, createWriterLock } from './writer-lock'

// The headless runtime of one page: the ledger node, its clock, the persisted
// UI, persistence and the writer lock, put together. The phone runtime (A2) builds on it: it
// dispatches through `dispatch`, reads the ledger through the node and the time through the
// clock store, keeps its session and screen reducers in `ui`, and shows `notices()` and the
// writer overlay (`lock.status() === 'waiting'`) in the presenter chrome.

/** One-time presenter-chrome notices (copy keys and texts arrive with the screens in A2). */
export type Notice =
  /** "Your saved session was recalculated with this version." */
  | 'recalculated'
  /** "Couldn't restore your last session. Started fresh." (the old record is quarantined) */
  | 'restore-failed'
  /** "This browser isn't saving changes." */
  | 'storage-unavailable'
  /** A write failed (quota); the session continues in memory until the next write works. */
  | 'write-failed'

/** Refusals that come from the store, not the domain. */
export type StoreRefusal =
  /** The session reached its limit (§2.6): "Your session is getting long. Save it to a file and reset soon." */
  | { code: 'session-full' }
  /** The command could not be saved within the file rules (too many items, a note too long). */
  | { code: 'not-storable' }

export type DispatchResult = Result<LedgerEvent[], DomainError | StoreRefusal>

/**
 * Why the Clock control's jump was refused: the node's reasons, plus the file limits a jump
 * must keep so the session can always be saved and loaded again (§2.6): `session-full` at 100 %
 * usage (as for commands), `too-far` beyond day 400 after T0's date.
 */
export type RuntimeJumpRefusal = JumpRefusal | 'session-full' | 'too-far'

export interface UiStore {
  get(): UiState
  set(next: UiState): void
  subscribe(listener: () => void): () => void
}

export function createUiStore(initial: UiState): UiStore {
  let ui = initial
  const listeners = new Set<() => void>()
  return {
    get: () => ui,
    set(next) {
      ui = next
      for (const l of [...listeners]) l()
    },
    subscribe(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
}

/** A state file that passed every check, ready to open. */
export interface StateFileCandidate {
  label: string | null
  restored: Restored
}

export interface RuntimeDeps {
  content: Content
  /** BUILD_SHA. */
  build: string
  /** From openStorage(); null runs in memory. */
  storage: StorageLike | null
  /** navigator.locks where available. */
  locks?: LockManagerLike | null
  /** Subscribes to the `storage` event (the writer fallback without Web Locks). */
  onStorage?: (listener: () => void) => () => void
  /** Wall-clock timers (setTimeout); null for headless use. */
  timers: Timers | null
  clock: { mode: ClockMode; wallNow?: () => number }
  /** The date a fresh start computes T0 from (resolveEpochDate(search, Date.now())). */
  epochDate: IsoDate
  /** A2's screen registry; unknown screen ids in a restored UI are dropped. */
  isScreen?: (id: string) => boolean
  /** navigator.storage.persist, requested once. */
  requestPersist?: () => unknown
}

export interface PageLike {
  addEventListener(type: string, listener: () => void, options?: { capture?: boolean; passive?: boolean }): void
  removeEventListener(type: string, listener: () => void, options?: { capture?: boolean }): void
}

export interface Runtime {
  readonly node: LedgerNode
  readonly clock: ClockStore
  readonly ui: UiStore
  /** Null in memory mode. */
  readonly lock: WriterLock | null
  meta(): SessionMeta
  notices(): readonly Notice[]
  dismissNotice(n: Notice): void
  subscribeNotices(listener: () => void): () => void
  /** Every user command goes through here (limits and note cleaning first, then the node). */
  dispatch(cmd: UserCommand): DispatchResult
  /** The Clock control's jump (logged). */
  jump(t: SimTime): Result<LedgerEvent[], RuntimeJumpRefusal>
  usage(): Usage
  /** Fresh start with T0 recomputed from `epochDate`; one Undo. `ui` defaults to the fresh UI. */
  reset(opts: { epochDate: IsoDate; ui?: UiState }): void
  undo(): boolean
  canUndo(): boolean
  /** The session as a state file: name and bytes (Blob + <a download> is A2's). */
  exportState(label?: string): Result<{ fileName: string; text: string }, 'unencodable'>
  /** Check `file.size` before reading a chosen file. */
  fileSizeAllowed(bytes: number): boolean
  /** Validates and replays a state file on the current T0 without changing anything. */
  readStateFile(text: string): Result<StateFileCandidate, 'bad-file'>
  /** Opens a checked state file (replaces everything; one Undo). */
  openStateFile(candidate: StateFileCandidate, startingState?: string): void
  /** The quarantined record, for "Save the previous session to a file". */
  quarantined(): string | null
  flush(): FlushOutcome
  /** Wires pagehide, visibility, focus and input to persistence and the clock. */
  attach(win: PageLike, doc: PageLike & { readonly visibilityState: string }): () => void
  dispose(): void
}

interface Loaded {
  restored: Restored | null
  notices: Notice[]
}

export function createRuntime(deps: RuntimeDeps): Runtime {
  const { content, storage } = deps
  const stateVersion = content.config.stateVersion
  const tz = content.config.t0.tz ?? LJUBLJANA
  const env: RestoreEnv = { content, tz, ...(deps.isScreen ? { isScreen: deps.isScreen } : {}) }
  const encoder = createLogEncoder(tz)
  const personaIds = personaIdsOf(content)
  /** This tab's writer token (breaks writer-epoch ties without Web Locks). */
  const writerToken = newFlowInstanceId()
  let quarantine: string | null = storage ? safeGet(storage, QUARANTINE_KEY) : null
  const noticeSet = new Set<Notice>()
  const noticeListeners = new Set<() => void>()
  const notice = (n: Notice) => {
    if (noticeSet.has(n)) return
    noticeSet.add(n)
    for (const l of [...noticeListeners]) l()
  }

  // Storage changes found at boot (quarantine, removing old keys) wait until this tab is the
  // writer, so a second tab never rewrites what the writing tab owns.
  const deferred: ((s: StorageLike) => void)[] = []
  const toQuarantine = (raw: string) => {
    quarantine = raw
    deferred.push((s) => safeSet(s, QUARANTINE_KEY, raw))
  }
  const removeLater = (key: string) => deferred.push((s) => safeRemove(s, key))
  /** The record under this version's key at boot, and whether it failed to restore (its
   *  quarantine then waits in `deferred`). */
  let bootRaw: string | null = null
  let bootBad = false
  const runDeferred = () => {
    if (!storage) return
    for (const op of deferred.splice(0)) op(storage)
    bootBad = false
  }
  /** Quarantines a stored record now (this tab is the writer), before anything overwrites it. */
  const quarantineNow = (raw: string) => {
    quarantine = raw
    if (storage) safeSet(storage, QUARANTINE_KEY, raw)
    notice('restore-failed')
  }

  /** Reads the stored session (§2.6 Load, including the version-mismatch path). */
  function load(): Loaded {
    if (!storage) return { restored: null, notices: ['storage-unavailable'] }
    const key = stateKey(stateVersion)
    const raw = safeGet(storage, key)
    bootRaw = raw
    if (raw !== null) {
      const r = restoreText(raw, env, { acceptOlder: false })
      if (r.ok) return { restored: r.value, notices: r.value.recalculated ? ['recalculated'] : [] }
      bootBad = true
      toQuarantine(raw)
      removeLater(key)
      return { restored: null, notices: ['restore-failed'] }
    }
    // A record from an older version: replay its log on the new seed, else quarantine it.
    const older = stateKeys(storage)
      .map((k) => ({ k, v: Number(k.slice(k.lastIndexOf('v') + 1)) }))
      .filter((x) => x.v < stateVersion)
      .sort((a, b) => b.v - a.v)
    const newest = older[0]
    if (!newest) return { restored: null, notices: [] }
    const oldRaw = safeGet(storage, newest.k) ?? ''
    const r = restoreText(oldRaw, env, { acceptOlder: true })
    for (const x of older) removeLater(x.k)
    if (r.ok) return { restored: r.value, notices: ['recalculated'] }
    toQuarantine(oldRaw)
    return { restored: null, notices: ['restore-failed'] }
  }

  const first = load()
  for (const n of first.notices) notice(n)

  const fresh = buildSeed(content, deps.epochDate)
  let meta: SessionMeta = first.restored
    ? metaOf(first.restored)
    : { stateVersion, build: deps.build, t0Date: fresh.t0Date, startingState: 'fresh' }

  function metaOf(r: Restored): SessionMeta {
    const m: SessionMeta = { stateVersion, build: deps.build, t0Date: r.record.t0Date }
    if (r.record.label !== undefined) m.label = r.record.label
    if (r.record.startingState !== undefined) m.startingState = r.record.startingState
    return m
  }

  const start: LoadedSession = first.restored?.session ?? {
    seed: fresh.state,
    t0: fresh.t0,
    state: fresh.state,
    events: [],
    log: [],
    clock: fresh.t0,
  }
  const clock =
    deps.clock.mode === 'live' && deps.timers && deps.clock.wallNow
      ? createClock({
          mode: 'live',
          start: start.clock,
          wallNow: deps.clock.wallNow,
          timers: deps.timers,
          idleMs: content.config.clock.idlePauseMs,
        })
      : createClock({ start: start.clock })
  const node = createLedgerNode({ seed: start.seed, t0: start.t0, timers: deps.timers, clock })

  const remember = (r: Restored) => {
    r.session.log.forEach((e, i) => {
      const stored = r.stored[i]
      if (stored) encoder.remember(r.record.t0Date, e, stored)
    })
  }
  if (first.restored) {
    node.loadSession(first.restored.session)
    remember(first.restored)
  }

  /** The live clock continues from the stored clock key when it is later than the record. */
  const catchUpToStoredClock = () => {
    if (!storage) return
    const stamp = readClockStamp(storage)
    if (!stamp || stamp.t0Date !== meta.t0Date) return
    const t = instantOfAt(meta.t0Date, stamp.at, tz)
    if (t > node.now()) node.advanceTo(t, 'catch-up')
  }
  catchUpToStoredClock()

  const ui = createUiStore(first.restored?.ui ?? freshUi())

  const lock = storage
    ? createWriterLock({
        locks: deps.locks ?? null,
        readEpoch: () => storedEpoch(storage),
        readWriter: () => storedWriter(storage),
        token: writerToken,
        ...(deps.onStorage ? { onStorage: deps.onStorage } : {}),
      })
    : null

  const persister: Persister = createPersister({
    storage,
    node,
    encoder,
    meta: () => meta,
    ui: () => fitRecordUi(ui.get(), personaIds),
    isWriter: () => lock?.isWriter() ?? false,
    writerEpoch: () => lock?.epoch() ?? 0,
    writerToken: () => writerToken,
    onStale: () => lock?.markStale(),
    onWriteFailed: () => notice('write-failed'),
    timers: deps.timers,
    tz,
  })

  /**
   * Takes over what another tab wrote (queued lock, [Use here]). A stored record that does not
   * restore keeps this tab's session and is quarantined first, so the write that follows never
   * silently replaces it (§2.6).
   */
  function reloadFromStorage(raw: string | null): void {
    if (!storage || raw === null) return
    const r = restoreText(raw, env, { acceptOlder: false })
    if (!r.ok) {
      quarantineNow(raw)
      return
    }
    undoSlot = null
    meta = metaOf(r.value)
    node.loadSession(r.value.session)
    remember(r.value)
    ui.set(r.value.ui)
    catchUpToStoredClock()
  }

  const offs: (() => void)[] = []
  offs.push(node.subscribe(() => persister.schedule()))
  offs.push(ui.subscribe(() => persister.schedule()))
  if (lock) {
    offs.push(
      lock.onAcquired((how) => {
        if (how !== 'initial' && storage) {
          const raw = safeGet(storage, stateKey(stateVersion))
          // Storage moved on since boot: the boot-time work is stale, and what the other tab
          // wrote is authoritative. Unchanged and bad at boot: the deferred quarantine runs below.
          if (raw !== bootRaw) {
            deferred.length = 0
            bootBad = false
          }
          if (!(bootBad && raw === bootRaw)) reloadFromStorage(raw)
        }
        runDeferred()
        persister.flush() // claims the new writer epoch
      }),
    )
    offs.push(
      lock.subscribe(() => {
        if (!lock.isWriter()) persister.cancel()
      }),
    )
  }
  // Without Web Locks the lock is ours at once (before the listener above existed): claim it.
  if (lock?.isWriter()) {
    runDeferred()
    persister.flush()
  }
  if (storage && deps.requestPersist) {
    try {
      deps.requestPersist()
    } catch {
      // not granted: nothing to do
    }
  }

  // ---- Reset, Undo, state files

  interface UndoSlot {
    meta: SessionMeta
    ui: UiState
  }
  let undoSlot: UndoSlot | null = null

  const canUndo = () => {
    if (undoSlot && !node.canUndoReset()) undoSlot = null
    return undoSlot !== null
  }

  function cleanNote(cmd: UserCommand): UserCommand {
    if (cmd.note === undefined) return cmd
    const note = stripControl(cmd.note).trim()
    const { note: _drop, ...rest } = cmd
    return note.length > 0 ? { ...rest, note } : (rest as UserCommand)
  }

  /**
   * Whether a command can be saved and replayed as it is: its stored form passes the file rules
   * and decodes back to the same command (items from the recipient's catalogue at catalogue
   * prices, every item with a sku). A reference to an entity that does not exist, and an amount
   * or debit that is not an integer of hundredths, are left to the node, which refuses them with
   * the domain error (`invalid-amount`, `quote-changed`, `invalid-state`).
   */
  function storable(cmd: UserCommand): boolean {
    if (!Number.isSafeInteger(cmd.amount) || !Number.isSafeInteger(cmd.expect?.senderDebit)) return true
    const s = node.getState()
    const wire = encodeCommand(s, cmd)
    if (!wire.ok) return wire.error === 'unknown-ref'
    if (checkWireCommand(wire.value) !== null) return false
    const back = decodeCommand(s, content, { actor: cmd.actor, cmdId: cmd.cmdId, cmd: wire.value })
    return back.ok && stableStringify(back.value) === stableStringify(cmd)
  }

  const fileName = (): string => {
    const now = node.now()
    const d = localDateOf(now, tz)
    const hm = localTimeOf(now, tz).slice(0, 5).replace(':', '')
    return `bcps-state-${d}-${hm}.json`
  }

  return {
    node,
    clock,
    ui,
    lock,
    meta: () => meta,
    notices: () => [...noticeSet],
    dismissNotice(n) {
      if (noticeSet.delete(n)) for (const l of [...noticeListeners]) l()
    },
    subscribeNotices(l) {
      noticeListeners.add(l)
      return () => noticeListeners.delete(l)
    },
    dispatch(raw) {
      if (persister.usage().level === 'full') return { ok: false, error: { code: 'session-full' } }
      // The log entry must pass the record rules, or the next boot could not load the session.
      if (typeof raw.cmdId !== 'string' || !CMD_ID.test(raw.cmdId) || !isRecordPersonaId(raw.actor)) {
        return { ok: false, error: { code: 'not-storable' } }
      }
      const cmd = cleanNote(raw)
      if (!storable(cmd)) return { ok: false, error: { code: 'not-storable' } }
      const r = node.dispatch(cmd)
      if (r.ok) undoSlot = null
      return r
    },
    jump(t) {
      if (!Number.isSafeInteger(t)) return { ok: false, error: 'invalid-time' }
      if (persister.usage().level === 'full') return { ok: false, error: 'session-full' }
      if (daysBetween(meta.t0Date, localDateOf(t, tz)) > LIMITS.maxDay) return { ok: false, error: 'too-far' }
      const r = node.jump(t)
      if (r.ok) undoSlot = null
      return r
    },
    usage: () => persister.usage(),
    reset({ epochDate, ui: nextUi }) {
      undoSlot = { meta, ui: ui.get() }
      const seed = buildSeed(content, epochDate)
      node.resetToSeed({ seed: seed.state, t0: seed.t0 })
      meta = { stateVersion, build: deps.build, t0Date: seed.t0Date, startingState: 'fresh' }
      ui.set(nextUi ?? freshUi())
    },
    undo() {
      if (!canUndo() || !undoSlot) return false
      const slot = undoSlot
      undoSlot = null
      if (!node.undoReset()) return false
      meta = slot.meta
      ui.set(slot.ui)
      return true
    },
    canUndo,
    exportState(label) {
      node.run(node.now(), 'catch-up')
      const clean = label === undefined ? '' : stripControl(label).trim().slice(0, LIMITS.label).trim()
      const text = persister.serialize(clean.length > 0 ? clean : undefined)
      if (!text.ok) return { ok: false, error: 'unencodable' }
      return { ok: true, value: { fileName: fileName(), text: text.value } }
    },
    fileSizeAllowed: (bytes) => Number.isFinite(bytes) && bytes > 0 && bytes <= LIMITS.bytes,
    readStateFile(text) {
      let parsed: ReturnType<typeof parseFor>
      try {
        parsed = parseFor(content, text, true)
      } catch {
        return { ok: false, error: 'bad-file' }
      }
      if (!parsed.ok) return { ok: false, error: 'bad-file' }
      // Re-based onto this device's T0 by calendar (day offset and local time, §2.6).
      const rebased = { ...parsed.record, t0Date: meta.t0Date }
      const r = restoreRecord(rebased, parsed.olderVersion, env)
      if (!r.ok) return { ok: false, error: 'bad-file' }
      return { ok: true, value: { label: parsed.record.label ?? null, restored: r.value } }
    },
    openStateFile(candidate, startingState) {
      undoSlot = { meta, ui: ui.get() }
      const r = candidate.restored
      node.loadSession(r.session, { keepUndo: true })
      remember(r)
      meta = metaOf(r)
      if (startingState !== undefined) meta = { ...meta, startingState }
      ui.set(r.ui)
      if (r.recalculated) notice('recalculated')
    },
    quarantined: () => quarantine,
    flush: () => persister.flush(),
    attach(win, doc) {
      const flush = () => {
        persister.flush()
      }
      const onVisibility = () => {
        if (doc.visibilityState === 'hidden') {
          clock.setVisible(false)
          persister.flush()
        } else {
          clock.setVisible(true)
          node.run(node.now(), 'catch-up')
        }
      }
      const onFocus = () => {
        node.run(node.now(), 'catch-up')
      }
      const onInput = () => clock.noteInput()
      clock.setVisible(doc.visibilityState !== 'hidden')
      win.addEventListener('pagehide', flush)
      doc.addEventListener('visibilitychange', onVisibility)
      win.addEventListener('focus', onFocus)
      win.addEventListener('pointerdown', onInput, { capture: true, passive: true })
      win.addEventListener('keydown', onInput, { capture: true, passive: true })
      return () => {
        win.removeEventListener('pagehide', flush)
        doc.removeEventListener('visibilitychange', onVisibility)
        win.removeEventListener('focus', onFocus)
        win.removeEventListener('pointerdown', onInput, { capture: true })
        win.removeEventListener('keydown', onInput, { capture: true })
      }
    },
    dispose() {
      for (const off of offs) off()
      persister.dispose()
      lock?.dispose()
      node.dispose()
      clock.dispose()
      noticeListeners.clear()
    },
  }
}
