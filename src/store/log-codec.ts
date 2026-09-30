import type { Content } from '@content/schema'
import { entryOf, selectParty } from '@domain/ledger'
import { formatHundredths, parseMinor } from '@domain/money'
import type { LedgerState, Minor, PaymentRequest, Result, SimTime, Tx, UserCommand } from '@domain/types'
import { resolveItems } from '@sim/seed'
import { type At, type IsoDate, atOfInstant } from '@sim/tz'
import type { LoggedCommand, NodeLogEntry } from './node'
import type { CommandEntry, LogEntry, Ref, WireCommand } from './record'

// Between the engine's commands and the log's stored form: amounts become two-decimal
// strings, items are stored by sku and quantity (names and prices come back from the catalogue),
// and entities are named by the command that created them or by their seed key, never by display
// id, so seed growth between versions cannot break a log. Times become calendar stamps.

export type CodecError = 'unknown-ref' | 'unknown-item' | 'bad-amount' | 'unencodable'

const minorString = (n: number): string => formatHundredths(n).replace(/,/g, '')

function refOf(entity: { id: string; cmdId?: string } | undefined): Ref | null {
  if (!entity) return null
  return entity.cmdId !== undefined ? { cmdId: entity.cmdId } : { seedRow: entity.id }
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** The requests one command made, in creation order (a split makes one per share). */
const requestsOfCommand = (s: LedgerState, cmdId: string): PaymentRequest[] =>
  Object.values(s.requests)
    .filter((r) => r.cmdId === cmdId)
    .sort(byId)

/** A request: by the command that made it (and its place among that command's), or its seed key. */
function requestRefOf(s: LedgerState, requestId: string): Ref | null {
  const r = entryOf(s.requests, requestId)
  if (!r) return null
  if (r.cmdId === undefined) return { seedRow: r.id }
  const n = requestsOfCommand(s, r.cmdId).findIndex((x) => x.id === r.id)
  return n > 0 ? { cmdId: r.cmdId, n } : { cmdId: r.cmdId }
}

function resolveRequestRef(s: LedgerState, ref: Ref): string | null {
  if ('seedRow' in ref) return resolveRef(s.requests, ref)
  return requestsOfCommand(s, ref.cmdId)[ref.n ?? 0]?.id ?? null
}

/** A payment: by the command that made it, or the key of the seed row it comes from. */
function txRefOf(s: LedgerState, txId: string): Ref | null {
  const tx = entryOf(s.txs, txId)
  if (!tx) return null
  if (tx.cmdId !== undefined) return { cmdId: tx.cmdId }
  return tx.seed && tx.seedMeta ? { seedRow: tx.seedMeta.key } : null
}

function resolveTxRef(s: LedgerState, ref: Ref): string | null {
  for (let i = s.txOrder.length - 1; i >= 0; i--) {
    const tx: Tx | undefined = s.txs[s.txOrder[i] ?? '']
    if (!tx) continue
    if ('seedRow' in ref ? tx.seed === true && tx.seedMeta?.key === ref.seedRow : tx.cmdId === ref.cmdId) return tx.id
  }
  return null
}

/** The stored form of a user command; refs are resolved against the state it was decided on. */
export function encodeCommand(s: LedgerState, c: UserCommand): Result<WireCommand, CodecError> {
  switch (c.type) {
    case 'pay': {
      const out: WireCommand = {
        type: 'pay',
        to: c.to,
        amount: minorString(c.amount),
        channel: c.channel,
        expect: { senderDebit: minorString(c.expect.senderDebit) },
      }
      if (c.note !== undefined) out.note = c.note
      if (c.items !== undefined) {
        if (!c.items.every((it) => it.sku !== undefined)) return { ok: false, error: 'unencodable' }
        out.items = c.items.map((it) => ({ sku: it.sku as string, qty: it.qty }))
      }
      if (c.requestId !== undefined) {
        const r = requestRefOf(s, c.requestId)
        if (!r) return { ok: false, error: 'unknown-ref' }
        out.requestRef = r
      }
      if (c.linkId !== undefined) {
        const r = refOf(entryOf(s.links, c.linkId))
        if (!r) return { ok: false, error: 'unknown-ref' }
        out.linkRef = r
      }
      return { ok: true, value: out }
    }
    case 'request.create': {
      if (c.channel === 'username') {
        const out: WireCommand = {
          type: 'request.create',
          channel: 'username',
          payer: c.payer,
          amount: minorString(c.amount),
        }
        if (c.note !== undefined) out.note = c.note
        return { ok: true, value: out }
      }
      const out: WireCommand = { type: 'request.create', channel: c.channel, amount: minorString(c.amount) }
      if (c.note !== undefined) out.note = c.note
      if (c.items !== undefined) {
        if (!c.items.every((it) => it.sku !== undefined)) return { ok: false, error: 'unencodable' }
        out.items = c.items.map((it) => ({ sku: it.sku as string, qty: it.qty }))
      }
      return { ok: true, value: out }
    }
    case 'request.cancel': {
      const r = requestRefOf(s, c.requestId)
      if (!r) return { ok: false, error: 'unknown-ref' }
      return { ok: true, value: { type: 'request.cancel', requestRef: r } }
    }
    case 'request.decline': {
      const r = requestRefOf(s, c.requestId)
      if (!r) return { ok: false, error: 'unknown-ref' }
      const out: WireCommand = { type: 'request.decline', requestRef: r }
      if (c.reason !== undefined) out.reason = c.reason
      return { ok: true, value: out }
    }
    case 'link.create': {
      const out: WireCommand = { type: 'link.create', amount: minorString(c.amount) }
      if (c.note !== undefined) out.note = c.note
      return { ok: true, value: out }
    }
    case 'link.share': {
      const r = refOf(entryOf(s.links, c.linkId))
      if (!r) return { ok: false, error: 'unknown-ref' }
      return { ok: true, value: { type: 'link.share', linkRef: r, to: c.to } }
    }
    case 'split.create': {
      const out: WireCommand = {
        type: 'split.create',
        total: minorString(c.total),
        note: c.note,
        shares: c.shares.map((sh) => ({ party: sh.party, amount: minorString(sh.amount) })),
      }
      if (c.sourceTxId !== undefined) {
        const r = txRefOf(s, c.sourceTxId)
        if (!r) return { ok: false, error: 'unknown-ref' }
        out.sourceRef = r
      }
      return { ok: true, value: out }
    }
    case 'split.reask': {
      const r = refOf(entryOf(s.splits, c.splitId))
      if (!r) return { ok: false, error: 'unknown-ref' }
      return { ok: true, value: { type: 'split.reask', splitRef: r, party: c.party } }
    }
    case 'split.cancel': {
      const r = refOf(entryOf(s.splits, c.splitId))
      if (!r) return { ok: false, error: 'unknown-ref' }
      return { ok: true, value: { type: 'split.cancel', splitRef: r } }
    }
  }
}

function resolveRef<T extends { id: string; cmdId?: string }>(all: Record<string, T>, ref: Ref): string | null {
  if ('seedRow' in ref) {
    const e = Object.hasOwn(all, ref.seedRow) ? all[ref.seedRow] : undefined
    return e && e.cmdId === undefined ? e.id : null
  }
  for (const id of Object.keys(all)) if (all[id]?.cmdId === ref.cmdId) return id
  return null
}

/** The engine command for a stored one, against the state it is about to be decided on. */
export function decodeCommand(
  s: LedgerState,
  content: Content,
  e: Pick<CommandEntry, 'actor' | 'cmdId' | 'cmd'>,
): Result<UserCommand, CodecError> {
  const w = e.cmd
  switch (w.type) {
    case 'pay': {
      const amount = parseMinor(w.amount)
      const debit = parseMinor(w.expect.senderDebit)
      if (!amount.ok || !debit.ok) return { ok: false, error: 'bad-amount' }
      const out: UserCommand = {
        type: 'pay',
        actor: e.actor,
        cmdId: e.cmdId,
        to: w.to,
        amount: amount.value,
        channel: w.channel,
        expect: { senderDebit: debit.value },
      }
      if (w.note !== undefined) out.note = w.note
      if (w.items !== undefined) {
        const to = selectParty(s, w.to)
        if (!to) return { ok: false, error: 'unknown-item' }
        try {
          out.items = resolveItems(content, to.id, w.items)
        } catch {
          return { ok: false, error: 'unknown-item' }
        }
      }
      if (w.requestRef !== undefined) {
        const id = resolveRequestRef(s, w.requestRef)
        if (id === null) return { ok: false, error: 'unknown-ref' }
        out.requestId = id
      }
      if (w.linkRef !== undefined) {
        const id = resolveRef(s.links, w.linkRef)
        if (id === null) return { ok: false, error: 'unknown-ref' }
        out.linkId = id
      }
      return { ok: true, value: out }
    }
    case 'request.create': {
      const amount = parseMinor(w.amount)
      if (!amount.ok) return { ok: false, error: 'bad-amount' }
      if (w.channel === 'username') {
        const person: UserCommand = {
          type: 'request.create',
          actor: e.actor,
          cmdId: e.cmdId,
          channel: 'username',
          payer: w.payer,
          amount: amount.value,
        }
        if (w.note !== undefined) person.note = w.note
        return { ok: true, value: person }
      }
      const out: UserCommand = {
        type: 'request.create',
        actor: e.actor,
        cmdId: e.cmdId,
        channel: w.channel,
        amount: amount.value,
      }
      if (w.note !== undefined) out.note = w.note
      if (w.items !== undefined) {
        try {
          out.items = resolveItems(content, e.actor, w.items)
        } catch {
          return { ok: false, error: 'unknown-item' }
        }
      }
      return { ok: true, value: out }
    }
    case 'request.cancel': {
      const id = resolveRequestRef(s, w.requestRef)
      if (id === null) return { ok: false, error: 'unknown-ref' }
      return { ok: true, value: { type: 'request.cancel', actor: e.actor, cmdId: e.cmdId, requestId: id } }
    }
    case 'request.decline': {
      const id = resolveRequestRef(s, w.requestRef)
      if (id === null) return { ok: false, error: 'unknown-ref' }
      const out: UserCommand = { type: 'request.decline', actor: e.actor, cmdId: e.cmdId, requestId: id }
      if (w.reason !== undefined) out.reason = w.reason
      return { ok: true, value: out }
    }
    case 'link.create': {
      const amount = parseMinor(w.amount)
      if (!amount.ok) return { ok: false, error: 'bad-amount' }
      const out: UserCommand = { type: 'link.create', actor: e.actor, cmdId: e.cmdId, amount: amount.value }
      if (w.note !== undefined) out.note = w.note
      return { ok: true, value: out }
    }
    case 'link.share': {
      const id = resolveRef(s.links, w.linkRef)
      if (id === null) return { ok: false, error: 'unknown-ref' }
      return { ok: true, value: { type: 'link.share', actor: e.actor, cmdId: e.cmdId, linkId: id, to: w.to } }
    }
    case 'split.create': {
      const total = parseMinor(w.total)
      if (!total.ok) return { ok: false, error: 'bad-amount' }
      const shares: { party: `@${string}`; amount: Minor }[] = []
      for (const sh of w.shares) {
        const amount = parseMinor(sh.amount)
        if (!amount.ok) return { ok: false, error: 'bad-amount' }
        shares.push({ party: sh.party, amount: amount.value })
      }
      const out: UserCommand = {
        type: 'split.create',
        actor: e.actor,
        cmdId: e.cmdId,
        total: total.value,
        note: w.note,
        shares,
      }
      if (w.sourceRef !== undefined) {
        const id = resolveTxRef(s, w.sourceRef)
        if (id === null) return { ok: false, error: 'unknown-ref' }
        out.sourceTxId = id
      }
      return { ok: true, value: out }
    }
    case 'split.reask': {
      const id = resolveRef(s.splits, w.splitRef)
      if (id === null) return { ok: false, error: 'unknown-ref' }
      return { ok: true, value: { type: 'split.reask', actor: e.actor, cmdId: e.cmdId, splitId: id, party: w.party } }
    }
    case 'split.cancel': {
      const id = resolveRef(s.splits, w.splitRef)
      if (id === null) return { ok: false, error: 'unknown-ref' }
      return { ok: true, value: { type: 'split.cancel', actor: e.actor, cmdId: e.cmdId, splitId: id } }
    }
  }
}

/**
 * Stored log entries for the node's log. Entries are encoded once and remembered (the log only
 * grows), so a flush of a long session does not re-encode it; `remember` seeds the cache with
 * the stored form a session was loaded from, so a reload writes back the same bytes.
 */
export interface LogEncoder {
  encode(s: LedgerState, t0Date: IsoDate, log: readonly NodeLogEntry[]): Result<LogEntry[], CodecError>
  remember(t0Date: IsoDate, entry: NodeLogEntry, stored: LogEntry): void
}

export function createLogEncoder(tz?: string): LogEncoder {
  let cache = new WeakMap<NodeLogEntry, LogEntry>()
  let cachedT0: IsoDate | null = null
  const stamp = (t0Date: IsoDate, t: SimTime): At => atOfInstant(t0Date, t, tz)
  /** Stamps are relative to T0, so a new T0 (Reset) starts a new cache. */
  const forT0 = (t0Date: IsoDate) => {
    if (cachedT0 !== t0Date) {
      cache = new WeakMap()
      cachedT0 = t0Date
    }
  }
  return {
    encode(s, t0Date, log) {
      forT0(t0Date)
      const out: LogEntry[] = []
      for (const e of log) {
        let stored = cache.get(e)
        if (!stored) {
          if ('jump' in e) stored = { at: stamp(t0Date, e.at), jump: true }
          else {
            const c = encodeCommand(s, (e as LoggedCommand).cmd)
            if (!c.ok) return c
            stored = { at: stamp(t0Date, e.at), actor: e.actor, cmdId: e.cmdId, cmd: c.value }
          }
          cache.set(e, stored)
        }
        out.push(stored)
      }
      return { ok: true, value: out }
    },
    remember(t0Date, entry, stored) {
      forT0(t0Date)
      cache.set(entry, stored)
    },
  }
}
