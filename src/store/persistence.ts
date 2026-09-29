import type { Result } from '@domain/types'
import type { Timers } from '@sim/clock'
import { type At, type IsoDate, LJUBLJANA, atOfInstant } from '@sim/tz'
import type { CodecError, LogEncoder } from './log-codec'
import type { LedgerNode } from './node'
import {
  FORMAT_VERSION,
  LIMITS,
  RECORD_FORMAT,
  type StateRecord,
  type UiState,
  WARN_RATIO,
  fingerprintOf,
  serializeRecord,
  utf8Length,
} from './record'

// Browser persistence. Keys carry the `bcps:` prefix only (the github.io origin
// is shared with the organisation's other repositories):
//   bcps:state:v{stateVersion}  the record (command log and UI), written 250 ms after a change
//                               and flushed synchronously on pagehide / visibilitychange hidden
//   bcps:clock:v2               the clock alone ({ t0Date, at, writerEpoch, writer }), every 5 s
//                               while it runs and with every record write, so the record is not
//                               rewritten just because time passes; it also carries the writer
//                               claim (epoch, and a per-tab token that breaks epoch ties)
//   bcps:prefs                  presenter preferences (read and written by the app shell; never
//                               reset, exported or imported)
//   bcps:state:quarantine       a record that could not be restored, kept for "Save the
//                               previous session to a file"
// Writes happen only while this tab is the writer; a stored writer epoch newer than ours means
// another tab took over, and nothing is written. Every storage access is guarded.

export const STATE_KEY_PREFIX = 'bcps:state:v'
export const stateKey = (stateVersion: number): string => `${STATE_KEY_PREFIX}${stateVersion}`
export const CLOCK_KEY = 'bcps:clock:v2'
export const PREFS_KEY = 'bcps:prefs'
export const QUARANTINE_KEY = 'bcps:state:quarantine'
const PROBE_KEY = 'bcps:probe'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  key(index: number): string | null
  readonly length: number
}

/** The storage, if it can be written; null means in-memory mode ("This browser isn't saving changes."). */
export function openStorage(get: () => StorageLike | null | undefined): StorageLike | null {
  try {
    const s = get()
    if (!s) return null
    s.setItem(PROBE_KEY, '1')
    s.removeItem(PROBE_KEY)
    return s
  } catch {
    return null
  }
}

export function safeGet(s: StorageLike, key: string): string | null {
  try {
    return s.getItem(key)
  } catch {
    return null
  }
}

export function safeSet(s: StorageLike, key: string, value: string): boolean {
  try {
    s.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function safeRemove(s: StorageLike, key: string): void {
  try {
    s.removeItem(key)
  } catch {
    // nothing to do: the key stays
  }
}

/** Record keys of every stateVersion present (ours and older ones). */
export function stateKeys(s: StorageLike): string[] {
  const out: string[] = []
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i)
      if (k?.startsWith(STATE_KEY_PREFIX) && /^\d+$/.test(k.slice(STATE_KEY_PREFIX.length))) out.push(k)
    }
  } catch {
    return out
  }
  return out.sort()
}

// ---- the clock key

export interface ClockStamp {
  t0Date: IsoDate
  at: At
  writerEpoch: number
  /** The claiming tab's token (absent in keys written before tokens existed). */
  writer?: string
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}$/
const TOKEN = /^[0-9a-f]{16}$/

/** The stored clock, validated (anything odd reads as absent). */
export function readClockStamp(s: StorageLike): ClockStamp | null {
  const raw = safeGet(s, CLOCK_KEY)
  if (raw === null || raw.length > 256) return null
  try {
    const v = JSON.parse(raw) as {
      t0Date?: unknown
      at?: { day?: unknown; time?: unknown; fold?: unknown }
      writerEpoch?: unknown
      writer?: unknown
    }
    const day = v.at?.day
    const epoch = v.writerEpoch
    if (typeof v.t0Date !== 'string' || !DATE.test(v.t0Date)) return null
    if (typeof day !== 'number' || !Number.isSafeInteger(day) || day < 0 || day > LIMITS.maxDay) return null
    if (typeof v.at?.time !== 'string' || !TIME.test(v.at.time)) return null
    if (typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 0) return null
    const at: At = { day, time: v.at.time }
    if (v.at.fold === 2) at.fold = 2
    const out: ClockStamp = { t0Date: v.t0Date, at, writerEpoch: epoch }
    if (typeof v.writer === 'string' && TOKEN.test(v.writer)) out.writer = v.writer
    return out
  } catch {
    return null
  }
}

/** The newest writer epoch any tab has claimed (0 when none). */
export const storedEpoch = (s: StorageLike | null): number => (s ? (readClockStamp(s)?.writerEpoch ?? 0) : 0)

/** The token of the tab that wrote the stored claim (null when none or unknown). */
export const storedWriter = (s: StorageLike | null): string | null => (s ? (readClockStamp(s)?.writer ?? null) : null)

/**
 * Whether the stored claim belongs to another, newer writer: a higher epoch, or the same epoch
 * claimed by another tab (two tabs that booted together without Web Locks both take epoch 1;
 * the one that writes second sees the other's token and steps down).
 */
export function claimedByOther(
  stored: { epoch: number; writer: string | null },
  mine: { epoch: number; token: string },
): boolean {
  if (stored.epoch !== mine.epoch) return stored.epoch > mine.epoch
  return stored.writer !== null && stored.writer !== mine.token
}

// ---- snapshots

/** What a record carries besides the log and the UI. */
export interface SessionMeta {
  stateVersion: number
  build: string
  t0Date: IsoDate
  label?: string
  startingState?: string
}

/** The record of the node's current session. Call `node.run(now)` first so the state is the
 *  replay of the log up to the clock (a timer that is a few ms late must not show as a
 *  fingerprint mismatch). */
export function snapshotRecord(args: {
  node: LedgerNode
  meta: SessionMeta
  ui: UiState
  writerEpoch: number
  encoder: LogEncoder
  tz?: string
}): Result<StateRecord, CodecError> {
  const { node, meta } = args
  const state = node.getState()
  const log = args.encoder.encode(state, meta.t0Date, node.log())
  if (!log.ok) return log
  const record: StateRecord = {
    format: RECORD_FORMAT,
    formatVersion: FORMAT_VERSION,
    stateVersion: meta.stateVersion,
    build: meta.build,
    t0Date: meta.t0Date,
    clock: atOfInstant(meta.t0Date, node.now(), args.tz ?? LJUBLJANA),
    log: log.value,
    fingerprint: fingerprintOf(state),
    writerEpoch: args.writerEpoch,
    ui: args.ui,
  }
  if (meta.label !== undefined) record.label = meta.label
  if (meta.startingState !== undefined) record.startingState = meta.startingState
  return { ok: true, value: record }
}

// ---- the writer

export type FlushOutcome = 'written' | 'memory' | 'not-writer' | 'stale' | 'failed'

export interface Usage {
  entries: number
  /** Estimated serialised size in UTF-8 bytes. */
  bytes: number
  /** The larger of entries / 5,000 and bytes / 1 MB. */
  ratio: number
  /** `warn` from 80 %; `full`: new commands are refused, so the export always re-imports. */
  level: 'ok' | 'warn' | 'full'
}

/** Headroom for one more entry (a command with 20 items and a 40-character note). */
export const ENTRY_BYTES_MAX = 2048
/** Allowance for everything in a record besides the log (envelope and UI). */
const RECORD_BASE_BYTES = 16_384

export interface PersisterOptions {
  storage: StorageLike | null
  node: LedgerNode
  encoder: LogEncoder
  meta: () => SessionMeta
  ui: () => UiState
  isWriter: () => boolean
  writerEpoch: () => number
  /** This tab's writer token (written with the epoch). */
  writerToken: () => string
  /** A newer writer epoch is in storage: another tab took over. */
  onStale: () => void
  /** A write failed (quota, or storage went away). */
  onWriteFailed?: () => void
  timers: Timers | null
  debounceMs?: number
  clockEveryMs?: number
  tz?: string
}

export interface Persister {
  /** A change happened: write within `debounceMs`. */
  schedule(): void
  /** Writes now, synchronously (pagehide, visibilitychange hidden, explicit saves). */
  flush(): FlushOutcome
  /** Writes the clock key alone. */
  writeClock(): FlushOutcome
  /** Drops pending writes (the tab stopped being the writer). */
  cancel(): void
  usage(): Usage
  /** The serialised record of the current session (export uses the same bytes). */
  serialize(label?: string): Result<string, CodecError>
  dispose(): void
}

export function createPersister(o: PersisterOptions): Persister {
  const debounceMs = o.debounceMs ?? 250
  const clockEveryMs = o.clockEveryMs ?? 5000
  let pending: unknown = null
  let clockTimer: unknown = null
  let flushing = false
  let lastBytes = 0
  let lastEntries = 0
  let lastLog: readonly unknown[] | null = null
  let disposed = false

  const clearPending = () => {
    if (o.timers && pending !== null) o.timers.clear(pending)
    pending = null
  }

  const stale = (): boolean => {
    if (!o.storage) return false
    const stored = readClockStamp(o.storage)
    const claim = { epoch: stored?.writerEpoch ?? 0, writer: stored?.writer ?? null }
    if (claimedByOther(claim, { epoch: o.writerEpoch(), token: o.writerToken() })) {
      clearPending()
      o.onStale()
      return true
    }
    return false
  }

  const build = (label?: string): Result<{ record: StateRecord; text: string }, CodecError> => {
    const meta = o.meta()
    const r = snapshotRecord({
      node: o.node,
      meta: label !== undefined ? { ...meta, label } : meta,
      ui: o.ui(),
      writerEpoch: o.writerEpoch(),
      encoder: o.encoder,
      ...(o.tz !== undefined ? { tz: o.tz } : {}),
    })
    if (!r.ok) return r
    return { ok: true, value: { record: r.value, text: serializeRecord(r.value) } }
  }

  const clockText = (): string => {
    const meta = o.meta()
    return JSON.stringify({
      t0Date: meta.t0Date,
      at: atOfInstant(meta.t0Date, o.node.now(), o.tz ?? LJUBLJANA),
      writerEpoch: o.writerEpoch(),
      writer: o.writerToken(),
    })
  }

  function guard(): FlushOutcome | null {
    if (disposed || !o.storage) return 'memory'
    if (!o.isWriter()) return 'not-writer'
    if (stale()) return 'stale'
    return null
  }

  function flush(): FlushOutcome {
    clearPending()
    const blocked = guard()
    if (blocked) return blocked
    const storage = o.storage as StorageLike
    flushing = true
    try {
      // Bring the state up to the clock first (see snapshotRecord).
      o.node.run(o.node.now(), 'catch-up')
      const built = build()
      if (!built.ok) {
        o.onWriteFailed?.()
        return 'failed'
      }
      const meta = o.meta()
      lastBytes = utf8Length(built.value.text)
      lastEntries = built.value.record.log.length
      lastLog = o.node.log()
      if (
        !safeSet(storage, stateKey(meta.stateVersion), built.value.text) ||
        !safeSet(storage, CLOCK_KEY, clockText())
      ) {
        o.onWriteFailed?.()
        return 'failed'
      }
      return 'written'
    } finally {
      flushing = false
      clearPending()
    }
  }

  function writeClock(): FlushOutcome {
    const blocked = guard()
    if (blocked) return blocked
    return safeSet(o.storage as StorageLike, CLOCK_KEY, clockText()) ? 'written' : 'failed'
  }

  function schedule(): void {
    if (disposed || flushing || !o.timers || pending !== null) return
    pending = o.timers.set(() => {
      pending = null
      flush()
    }, debounceMs)
  }

  // The clock key follows the clock every few seconds while it runs.
  const syncClockTimer = () => {
    if (!o.timers) return
    const running = o.node.clock.isRunning()
    if (running && clockTimer === null) {
      const tick = () => {
        clockTimer = null
        if (disposed) return
        writeClock()
        if (o.node.clock.isRunning()) clockTimer = o.timers?.set(tick, clockEveryMs) ?? null
      }
      clockTimer = o.timers.set(tick, clockEveryMs)
    } else if (!running && clockTimer !== null) {
      o.timers.clear(clockTimer)
      clockTimer = null
      writeClock()
    }
  }
  const offClock = o.node.clock.onChange(syncClockTimer)
  syncClockTimer()

  return {
    schedule,
    flush,
    writeClock,
    cancel: clearPending,
    usage() {
      const log = o.node.log()
      const entries = log.length
      // The last written size plus the entries since (encoded once, then cached by the encoder).
      // After a Reset or a load the log is a new array: measure it from the start.
      const same = log === lastLog
      const from = same ? lastEntries : 0
      let bytes = same ? lastBytes : RECORD_BASE_BYTES
      if (entries > from) {
        const enc = o.encoder.encode(o.node.getState(), o.meta().t0Date, log)
        if (!enc.ok) bytes += (entries - from) * ENTRY_BYTES_MAX
        else for (let i = from; i < entries; i++) bytes += utf8Length(JSON.stringify(enc.value[i])) + 1
      }
      const ratio = Math.max(entries / LIMITS.entries, bytes / LIMITS.bytes)
      const full = entries >= LIMITS.entries || bytes + ENTRY_BYTES_MAX > LIMITS.bytes
      return { entries, bytes, ratio, level: full ? 'full' : ratio >= WARN_RATIO ? 'warn' : 'ok' }
    },
    serialize(label) {
      const built = build(label)
      return built.ok ? { ok: true, value: built.value.text } : built
    },
    dispose() {
      disposed = true
      clearPending()
      if (o.timers && clockTimer !== null) o.timers.clear(clockTimer)
      clockTimer = null
      offClock()
    },
  }
}
