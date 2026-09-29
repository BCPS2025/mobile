import type { Handle, LedgerState, PayChannel, PersonaId } from '@domain/types'
import { type At, type IsoDate, LJUBLJANA, compareAt, weekdayOfDate } from '@sim/tz'
import { CMD_ID } from './cmdIds'

// The saved session: one format for the localStorage record, exported state
// files and the shipped starting states. The validator is hand-written (no zod at boot) and treats
// every input as untrusted: size first, then a structural scan (prototype keys, control and format
// characters, nesting, array sizes), then a strict typed parse. Nothing in a record is trusted
// beyond its command log: balances are always re-derived by replay (store/replay).

export const RECORD_FORMAT = 'bcps-state'
export const FORMAT_VERSION = 1

/** One set of limits, shared by live use and import (§2.6). */
export const LIMITS = {
  /** Log entries (commands and jumps). */
  entries: 5000,
  /** Serialised record, in UTF-8 bytes. */
  bytes: 1_000_000,
  note: 40,
  label: 60,
  items: 20,
  shares: 10,
  readIds: 500,
  /** Persisted screens per persona: Home and at most one list (hub) level. */
  navDepth: 2,
  /** Day offsets from T0 a stamp may carry. */
  maxDay: 400,
} as const

/** Share of a limit at which Settings warns (§2.6). */
export const WARN_RATIO = 0.8

// ---- shapes (the JSON form; persona-keyed maps are plain objects here and Maps after parsing)

/** How a log names an entity: the command that created it, or its key in seed.yaml. */
export type Ref = { cmdId: string } | { seedRow: string }

export interface WireItem {
  sku: string
  qty: number
}

/** A user command as the log stores it: amounts as two-decimal strings, items by sku, refs. */
export type WireCommand = {
  type: 'pay'
  to: Handle
  amount: string
  channel: PayChannel
  note?: string
  items?: WireItem[]
  requestRef?: Ref
  linkRef?: Ref
  expect: { senderDebit: string }
}

export type WireCommandType = WireCommand['type']
/** User command types a log may contain (never `sys.*`). Grows with every new command. */
export const USER_COMMAND_TYPES: ReadonlySet<string> = new Set<WireCommandType>(['pay'])

export interface CommandEntry {
  at: At
  actor: PersonaId
  cmdId: string
  cmd: WireCommand
}
export interface JumpEntry {
  at: At
  jump: true
}
export type LogEntry = CommandEntry | JumpEntry
export const isJumpEntry = (e: LogEntry): e is JumpEntry => 'jump' in e

export interface Fingerprint {
  /** Sequence number of the last event of the state the record produced. */
  seq: number
  /** 64-bit FNV-1a over every balance, as 16 hex characters. */
  balancesHash: string
}

export interface Slot {
  persona: PersonaId | null
  remembered: PersonaId | null
}

export interface ReadMarks {
  readUpTo: At | null
  readIds: string[]
}

/** The persisted UI (§2.4, §2.5): which account is on which phone, who is logged in, where each
 *  persona's screen stack stands (Home and one list level) and what they have read. */
export interface UiState {
  phones: { stage: { left: Slot; right: Slot }; phone: Slot }
  sessions: Map<PersonaId, boolean>
  nav: Map<PersonaId, string[]>
  read: Map<PersonaId, ReadMarks>
  /** Logins per persona since Reset (the displayed login code rotates with it, §2.4). */
  logins: Map<PersonaId, number>
}

export interface StateRecord {
  format: typeof RECORD_FORMAT
  formatVersion: typeof FORMAT_VERSION
  stateVersion: number
  build: string
  label?: string
  t0Date: IsoDate
  clock: At
  log: LogEntry[]
  fingerprint: Fingerprint
  writerEpoch: number
  ui: UiState
  startingState?: string
}

/** The fresh-start UI: everyone logged out; left phone remembers Ana, right the café (§2.4). */
export function freshUi(): UiState {
  return {
    phones: {
      stage: { left: { persona: null, remembered: 'ana' }, right: { persona: null, remembered: 'cafe' } },
      phone: { persona: null, remembered: 'ana' },
    },
    sessions: new Map(),
    nav: new Map(),
    read: new Map(),
    logins: new Map(),
  }
}

// ---- fingerprint

/** 64-bit FNV-1a over a string's UTF-16LE bytes, as 16 hex characters (sync; no crypto API). */
export function fnv1a64(text: string): string {
  // The 64-bit state in four 16-bit limbs; offset basis 0xcbf29ce484222325.
  let h0 = 0x2325
  let h1 = 0x8422
  let h2 = 0x9ce4
  let h3 = 0xcbf2
  const mix = (byte: number) => {
    h0 ^= byte
    // h *= 0x100000001b3, i.e. h × 0x1b3 + h × 2⁴⁰ (the limbs above 64 bits drop out).
    const t0 = h0 * 0x1b3
    const t1 = h1 * 0x1b3 + (t0 >>> 16)
    const t2 = h2 * 0x1b3 + h0 * 0x100 + (t1 >>> 16)
    const t3 = h3 * 0x1b3 + h1 * 0x100 + (t2 >>> 16)
    h0 = t0 & 0xffff
    h1 = t1 & 0xffff
    h2 = t2 & 0xffff
    h3 = t3 & 0xffff
  }
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    mix(c & 0xff)
    mix(c >>> 8)
  }
  const hex = (n: number) => n.toString(16).padStart(4, '0')
  return hex(h3) + hex(h2) + hex(h1) + hex(h0)
}

/** What a record claims its log produced: the last event's seq and a hash of every balance. */
export function fingerprintOf(s: LedgerState): Fingerprint {
  const ids = Object.keys(s.balances).sort()
  let text = ''
  for (const id of ids) {
    const b = s.balances[id]
    text += `${id}=${b?.confirmed ?? 0}/${b?.held ?? 0};`
  }
  return { seq: s.seq, balancesHash: fnv1a64(text) }
}

export const sameFingerprint = (a: Fingerprint, b: Fingerprint) => a.seq === b.seq && a.balancesHash === b.balancesHash

// ---- serialising

/** UTF-8 length of a string (the limits count bytes). */
export function utf8Length(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      n += 4
      i += 1
    } else n += 3
  }
  return n
}

const sortedObject = <V>(m: ReadonlyMap<string, V>): Record<string, V> => {
  const out: Record<string, V> = {}
  for (const k of [...m.keys()].sort()) out[k] = m.get(k) as V
  return out
}

/** The JSON form of a record (persona-keyed maps as objects with sorted keys). */
export function recordToJson(r: StateRecord): unknown {
  const read = new Map([...r.ui.read].map(([k, v]) => [k, { readUpTo: v.readUpTo, readIds: [...v.readIds] }]))
  return {
    ...r,
    ui: {
      phones: r.ui.phones,
      sessions: sortedObject(r.ui.sessions),
      nav: sortedObject(r.ui.nav),
      read: sortedObject(read),
      logins: sortedObject(r.ui.logins),
    },
  }
}

/** Deterministic JSON: object keys sorted at every level (byte-stable files). */
export function stableStringify(value: unknown, space?: number): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort)
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(v).sort()) {
        const x = (v as Record<string, unknown>)[k]
        if (x !== undefined) out[k] = sort(x)
      }
      return out
    }
    return v
  }
  return JSON.stringify(sort(value), null, space)
}

export const serializeRecord = (r: StateRecord, space?: number): string => stableStringify(recordToJson(r), space)

// ---- parsing untrusted input

export type RecordProblemCode =
  | 'too-large'
  | 'not-json'
  | 'hostile-key'
  | 'control-character'
  | 'too-deep'
  | 'too-many'
  | 'shape'
  | 'format'
  | 'state-version'
  | 'unknown-command'
  | 'time-order'
  | 'limit'

export interface RecordProblem {
  code: RecordProblemCode
  /** Where in the record, e.g. "log[3].cmd.note". */
  path: string
  /** For state-version: the record's version. */
  stateVersion?: number
}

export interface ParseOptions {
  /** The build's stateVersion. */
  stateVersion: number
  /** Accept an older stateVersion (the caller then replays it on the new seed, §2.6). */
  acceptOlder?: boolean
  /** Weekday T0 falls on (config t0.weekday, 5 = Friday). */
  t0Weekday: number
  /** Persona ids a persona-keyed map may use (the seed's personas and the guest ids). */
  personaIds: ReadonlySet<string>
  /** Time zone of the calendar stamps (Europe/Ljubljana when omitted). */
  tz?: string
}

export type ParseResult =
  | { ok: true; record: StateRecord; olderVersion: boolean }
  | { ok: false; problem: RecordProblem }

class Refusal extends Error {
  constructor(readonly problem: RecordProblem) {
    super(`${problem.code} at ${problem.path}`)
  }
}
const refuse = (code: RecordProblemCode, path: string, extra: Partial<RecordProblem> = {}): never => {
  throw new Refusal({ code, path, ...extra })
}

const HOSTILE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
/** Unicode control (Cc) and format (Cf) characters. */
const CONTROL = /[\p{Cc}\p{Cf}]/u
const CONTROL_ALL = /[\p{Cc}\p{Cf}]/gu
/** Free-text fields: control and format characters are stripped there instead of refused. */
const FREE_TEXT = new Set(['note', 'label'])
const MAX_DEPTH = 12
const MAX_NODES = 250_000
const MAX_STRING = 256

export const stripControl = (s: string): string => s.replace(CONTROL_ALL, '')

/** Structural scan of any parsed JSON value: keys, strings, depth and size. */
function scan(root: unknown): void {
  let nodes = 0
  const stack: { v: unknown; path: string; depth: number; key: string }[] = [{ v: root, path: '$', depth: 0, key: '' }]
  while (stack.length > 0) {
    const { v, path, depth, key } = stack.pop() as (typeof stack)[number]
    if (++nodes > MAX_NODES) refuse('too-many', path)
    if (depth > MAX_DEPTH) refuse('too-deep', path)
    if (typeof v === 'string') {
      if (v.length > MAX_STRING) refuse('limit', path)
      if (!FREE_TEXT.has(key) && CONTROL.test(v)) refuse('control-character', path)
    } else if (Array.isArray(v)) {
      if (v.length > LIMITS.entries) refuse('too-many', path)
      for (let i = 0; i < v.length; i++) stack.push({ v: v[i], path: `${path}[${i}]`, depth: depth + 1, key: '' })
    } else if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) {
        if (HOSTILE_KEYS.has(k)) refuse('hostile-key', `${path}.${k}`)
        if (CONTROL.test(k) || k.length > 64) refuse('control-character', `${path}.${k}`)
        stack.push({ v: (v as Record<string, unknown>)[k], path: `${path}.${k}`, depth: depth + 1, key: k })
      }
    }
  }
}

type Obj = Record<string, unknown>

function obj(v: unknown, path: string, required: readonly string[], optional: readonly string[] = []): Obj {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype) {
    refuse('shape', path)
  }
  const o = v as Obj
  const allowed = new Set([...required, ...optional])
  for (const k of Object.keys(o)) if (!allowed.has(k)) refuse('shape', `${path}.${k}`)
  for (const k of required) if (!Object.hasOwn(o, k)) refuse('shape', `${path}.${k}`)
  return o
}

function str(v: unknown, path: string, re: RegExp): string {
  if (typeof v !== 'string' || !re.test(v)) refuse('shape', path)
  return v as string
}

function int(v: unknown, path: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) refuse('shape', path)
  return v as number
}

function arr(v: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(v)) refuse('shape', path)
  if ((v as unknown[]).length > max) refuse('limit', path)
  return v as unknown[]
}

/** A free-text field: control and format characters stripped, then the length limit. */
function text(v: unknown, path: string, max: number): string {
  if (typeof v !== 'string') refuse('shape', path)
  const s = stripControl(v as string).trim()
  if (s.length === 0 || [...s].length > max) refuse('limit', path)
  return s
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}$/
const PERSONA = /^[a-z][a-z0-9-]{1,31}$/
/** A persona id a record may carry: the id rule, and never an Object.prototype name. */
export const isRecordPersonaId = (v: unknown): v is PersonaId =>
  typeof v === 'string' && PERSONA.test(v) && !(v in Object.prototype)
const HANDLE = /^@[a-z0-9_]{2,30}$/
const AMOUNT = /^(0|[1-9]\d{0,6})\.\d{2}$/
const SKU = /^[a-z0-9-]{1,40}$/
const SEED_KEY = /^[A-Za-z0-9_-]{1,40}$/
const BUILD = /^[A-Za-z0-9._-]{1,40}$/
const STATE_ID = /^[a-z][a-z0-9-]{0,31}$/
const SCREEN = /^[a-z][A-Za-z0-9:._-]{0,63}$/
const READ_ID = /^[A-Za-z0-9:._-]{1,64}$/
const HASH = /^[0-9a-f]{16}$/
const PAY_CHANNELS: ReadonlySet<string> = new Set<PayChannel>(['username', 'qr', 'link', 'web-checkout', 'request'])

function isoDate(v: unknown, path: string): IsoDate {
  const s = str(v, path, DATE)
  const [y, m, d] = s.split('-').map(Number) as [number, number, number]
  const t = Date.UTC(y, m - 1, d)
  if (y < 2020 || y > 2100 || new Date(t).toISOString().slice(0, 10) !== s) refuse('shape', path)
  return s
}

function at(v: unknown, path: string): At {
  const o = obj(v, path, ['day', 'time'], ['fold'])
  const out: At = { day: int(o.day, `${path}.day`, 0, LIMITS.maxDay), time: str(o.time, `${path}.time`, TIME) }
  if (o.fold !== undefined) {
    if (o.fold !== 2) refuse('shape', `${path}.fold`)
    out.fold = 2
  }
  return out
}

function ref(v: unknown, path: string): Ref {
  const o = obj(v, path, [], ['cmdId', 'seedRow'])
  const keys = Object.keys(o)
  if (keys.length !== 1) refuse('shape', path)
  if (o.cmdId !== undefined) return { cmdId: str(o.cmdId, `${path}.cmdId`, CMD_ID) }
  return { seedRow: str(o.seedRow, `${path}.seedRow`, SEED_KEY) }
}

function command(v: unknown, path: string): WireCommand {
  if (!v || typeof v !== 'object' || Array.isArray(v)) refuse('shape', path)
  const type = (v as Obj).type
  if (typeof type !== 'string' || !USER_COMMAND_TYPES.has(type)) refuse('unknown-command', `${path}.type`)
  switch (type as WireCommandType) {
    case 'pay': {
      const o = obj(v, path, ['type', 'to', 'amount', 'channel', 'expect'], ['note', 'items', 'requestRef', 'linkRef'])
      const channel = o.channel
      if (typeof channel !== 'string' || !PAY_CHANNELS.has(channel)) refuse('shape', `${path}.channel`)
      const expect = obj(o.expect, `${path}.expect`, ['senderDebit'])
      const out: WireCommand = {
        type: 'pay',
        to: str(o.to, `${path}.to`, HANDLE) as Handle,
        amount: str(o.amount, `${path}.amount`, AMOUNT),
        channel: channel as PayChannel,
        expect: { senderDebit: str(expect.senderDebit, `${path}.expect.senderDebit`, AMOUNT) },
      }
      if (o.note !== undefined) out.note = text(o.note, `${path}.note`, LIMITS.note)
      if (o.items !== undefined) {
        out.items = arr(o.items, `${path}.items`, LIMITS.items).map((it, i) => {
          const p = `${path}.items[${i}]`
          const io = obj(it, p, ['sku', 'qty'])
          return { sku: str(io.sku, `${p}.sku`, SKU), qty: int(io.qty, `${p}.qty`, 1, 999) }
        })
      }
      if (o.requestRef !== undefined) out.requestRef = ref(o.requestRef, `${path}.requestRef`)
      if (o.linkRef !== undefined) out.linkRef = ref(o.linkRef, `${path}.linkRef`)
      return out
    }
  }
}

function logEntry(v: unknown, path: string): LogEntry {
  if (v && typeof v === 'object' && !Array.isArray(v) && Object.hasOwn(v, 'jump')) {
    const o = obj(v, path, ['at', 'jump'])
    if (o.jump !== true) refuse('shape', `${path}.jump`)
    return { at: at(o.at, `${path}.at`), jump: true }
  }
  const o = obj(v, path, ['at', 'actor', 'cmdId', 'cmd'])
  return {
    at: at(o.at, `${path}.at`),
    actor: recordPersona(o.actor, `${path}.actor`),
    cmdId: str(o.cmdId, `${path}.cmdId`, CMD_ID),
    cmd: command(o.cmd, `${path}.cmd`),
  }
}

function recordPersona(v: unknown, path: string): PersonaId {
  if (!isRecordPersonaId(v)) refuse('shape', path)
  return v as PersonaId
}

function persona(v: unknown, path: string, ids: ReadonlySet<string>): PersonaId {
  const id = recordPersona(v, path)
  if (!ids.has(id)) refuse('shape', path)
  return id
}

function slot(v: unknown, path: string, ids: ReadonlySet<string>): Slot {
  const o = obj(v, path, ['persona', 'remembered'])
  const opt = (x: unknown, p: string) => (x === null ? null : persona(x, p, ids))
  return { persona: opt(o.persona, `${path}.persona`), remembered: opt(o.remembered, `${path}.remembered`) }
}

/** A persona-keyed map: keys from the enumerated set only, parsed into a Map. */
function personaMap<V>(
  v: unknown,
  path: string,
  ids: ReadonlySet<string>,
  value: (x: unknown, p: string) => V,
): Map<PersonaId, V> {
  const o = obj(v, path, [], [...ids])
  const out = new Map<PersonaId, V>()
  for (const k of Object.keys(o).sort()) out.set(k, value(o[k], `${path}.${k}`))
  return out
}

function ui(v: unknown, path: string, ids: ReadonlySet<string>): UiState {
  const o = obj(v, path, ['phones', 'sessions', 'nav', 'read'], ['logins'])
  const phones = obj(o.phones, `${path}.phones`, ['stage', 'phone'])
  const stage = obj(phones.stage, `${path}.phones.stage`, ['left', 'right'])
  return {
    phones: {
      stage: {
        left: slot(stage.left, `${path}.phones.stage.left`, ids),
        right: slot(stage.right, `${path}.phones.stage.right`, ids),
      },
      phone: slot(phones.phone, `${path}.phones.phone`, ids),
    },
    sessions: personaMap(o.sessions, `${path}.sessions`, ids, (x, p) => {
      if (typeof x !== 'boolean') refuse('shape', p)
      return x as boolean
    }),
    nav: personaMap(o.nav, `${path}.nav`, ids, (x, p) =>
      arr(x, p, LIMITS.navDepth).map((s, i) => str(s, `${p}[${i}]`, SCREEN)),
    ),
    read: personaMap(o.read, `${path}.read`, ids, (x, p) => {
      const r = obj(x, p, ['readUpTo', 'readIds'])
      return {
        readUpTo: r.readUpTo === null ? null : at(r.readUpTo, `${p}.readUpTo`),
        readIds: arr(r.readIds, `${p}.readIds`, LIMITS.readIds).map((s, i) => str(s, `${p}.readIds[${i}]`, READ_ID)),
      }
    }),
    logins:
      o.logins === undefined
        ? new Map()
        : personaMap(o.logins, `${path}.logins`, ids, (x, p) => int(x, p, 0, 1_000_000)),
  }
}

/**
 * The UI as a record may carry it (§2.6 caps): persona keys and slots from `personaIds` only,
 * screen stacks cut to Home and one list level, well-formed screen and read ids, the newest 500
 * read ids. The writer applies it before every write, so a UI the parser would refuse can never
 * make the whole record (ledger included) fail to restore.
 */
export function fitRecordUi(u: UiState, personaIds: ReadonlySet<string>): UiState {
  const known = (id: PersonaId | null): PersonaId | null =>
    id !== null && isRecordPersonaId(id) && personaIds.has(id) ? id : null
  const fitSlot = (x: Slot): Slot => ({ persona: known(x.persona), remembered: known(x.remembered) })
  const keep = <V, W>(m: ReadonlyMap<PersonaId, V>, f: (v: V) => W | null): Map<PersonaId, W> => {
    const out = new Map<PersonaId, W>()
    for (const [k, v] of m) {
      if (known(k) === null) continue
      const w = f(v)
      if (w !== null) out.set(k, w)
    }
    return out
  }
  const okAt = (a: At | null): At | null =>
    a !== null && Number.isSafeInteger(a.day) && a.day >= 0 && a.day <= LIMITS.maxDay && TIME.test(a.time)
      ? a.fold === 2
        ? { day: a.day, time: a.time, fold: 2 }
        : { day: a.day, time: a.time }
      : null
  return {
    phones: {
      stage: { left: fitSlot(u.phones.stage.left), right: fitSlot(u.phones.stage.right) },
      phone: fitSlot(u.phones.phone),
    },
    sessions: keep(u.sessions, (v) => (typeof v === 'boolean' ? v : null)),
    nav: keep(u.nav, (stack) => {
      const screens = stack.filter((id) => typeof id === 'string' && SCREEN.test(id)).slice(0, LIMITS.navDepth)
      return screens.length > 0 ? screens : null
    }),
    read: keep(u.read, (r) => ({
      readUpTo: okAt(r.readUpTo),
      readIds: r.readIds.filter((id) => typeof id === 'string' && READ_ID.test(id)).slice(-LIMITS.readIds),
    })),
    logins: keep(u.logins, (n) => (Number.isSafeInteger(n) ? Math.min(Math.max(n, 0), 1_000_000) : null)),
  }
}

/** Whether a command, in its stored form, passes the file rules (so an export always re-imports). */
export function checkWireCommand(cmd: WireCommand): RecordProblem | null {
  try {
    const plain: unknown = JSON.parse(JSON.stringify(cmd))
    scan(plain)
    command(plain, '$.cmd')
    return null
  } catch (e) {
    if (e instanceof Refusal) return e.problem
    throw e
  }
}

/**
 * Parses and validates a record or state file (untrusted). Refuses anything outside the rules
 * of §2.6; strips control and format characters from notes and the label. It does not replay:
 * whether the commands are accepted, and whether the UI fits the replayed state, is checked
 * after replay (store/restore).
 */
export function parseRecord(textIn: string, opts: ParseOptions): ParseResult {
  try {
    if (utf8Length(textIn) > LIMITS.bytes) refuse('too-large', '$')
    let raw: unknown
    try {
      raw = JSON.parse(textIn)
    } catch {
      return { ok: false, problem: { code: 'not-json', path: '$' } }
    }
    scan(raw)
    const o = obj(
      raw,
      '$',
      [
        'format',
        'formatVersion',
        'stateVersion',
        'build',
        't0Date',
        'clock',
        'log',
        'fingerprint',
        'writerEpoch',
        'ui',
      ],
      ['label', 'startingState', 'prefs'],
    )
    if (o.format !== RECORD_FORMAT) refuse('format', '$.format')
    if (o.formatVersion !== FORMAT_VERSION) refuse('format', '$.formatVersion')
    const stateVersion = int(o.stateVersion, '$.stateVersion', 1, 9999)
    const olderVersion = stateVersion < opts.stateVersion
    if (stateVersion > opts.stateVersion || (olderVersion && !opts.acceptOlder)) {
      refuse('state-version', '$.stateVersion', { stateVersion })
    }
    const t0Date = isoDate(o.t0Date, '$.t0Date')
    if (weekdayOfDate(t0Date) !== opts.t0Weekday) refuse('shape', '$.t0Date')
    const log = arr(o.log, '$.log', LIMITS.entries).map((e, i) => logEntry(e, `$.log[${i}]`))
    // Time order, not text order: inside the repeated autumn hour a second-pass stamp can read
    // earlier than a first-pass one.
    const tz = opts.tz ?? LJUBLJANA
    const order = (a: At, b: At) => compareAt(t0Date, a, b, tz)
    for (let i = 1; i < log.length; i++) {
      if (order((log[i - 1] as LogEntry).at, (log[i] as LogEntry).at) > 0) refuse('time-order', `$.log[${i}].at`)
    }
    const clock = at(o.clock, '$.clock')
    const last = log[log.length - 1]
    if (last && order(last.at, clock) > 0) refuse('time-order', '$.clock')
    const fp = obj(o.fingerprint, '$.fingerprint', ['seq', 'balancesHash'])
    const record: StateRecord = {
      format: RECORD_FORMAT,
      formatVersion: FORMAT_VERSION,
      stateVersion,
      build: str(o.build, '$.build', BUILD),
      t0Date,
      clock,
      log,
      fingerprint: {
        seq: int(fp.seq, '$.fingerprint.seq', 0, Number.MAX_SAFE_INTEGER),
        balancesHash: str(fp.balancesHash, '$.fingerprint.balancesHash', HASH),
      },
      writerEpoch: int(o.writerEpoch, '$.writerEpoch', 0, 2 ** 31 - 1),
      ui: ui(o.ui, '$.ui', opts.personaIds),
    }
    if (o.label !== undefined) record.label = text(o.label, '$.label', LIMITS.label)
    if (o.startingState !== undefined) record.startingState = str(o.startingState, '$.startingState', STATE_ID)
    // `prefs` in a file are ignored (presenter preferences never travel, §2.6).
    return { ok: true, record, olderVersion }
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, problem: e.problem }
    throw e
  }
}
