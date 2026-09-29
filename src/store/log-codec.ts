import type { Content } from '@content/schema'
import { entryOf, selectParty } from '@domain/ledger'
import { formatHundredths, parseMinor } from '@domain/money'
import type { LedgerState, Result, SimTime, UserCommand } from '@domain/types'
import { resolveItems } from '@sim/seed'
import { type At, type IsoDate, atOfInstant } from '@sim/tz'
import type { LoggedCommand, NodeLogEntry } from './node'
import type { CommandEntry, LogEntry, Ref, WireCommand } from './record'

// Between the engine's commands and the log's stored form (§3.8): amounts become two-decimal
// strings, items are stored by sku and quantity (names and prices come back from the catalogue),
// and entities are named by the command that created them or by their seed key, never by display
// id, so seed growth between versions cannot break a log (§2.6). Times become calendar stamps.

export type CodecError = 'unknown-ref' | 'unknown-item' | 'bad-amount' | 'unencodable'

const minorString = (n: number): string => formatHundredths(n).replace(/,/g, '')

function refOf(entity: { id: string; cmdId?: string } | undefined): Ref | null {
  if (!entity) return null
  return entity.cmdId !== undefined ? { cmdId: entity.cmdId } : { seedRow: entity.id }
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
        const r = refOf(entryOf(s.requests, c.requestId))
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
        const id = resolveRef(s.requests, w.requestRef)
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
