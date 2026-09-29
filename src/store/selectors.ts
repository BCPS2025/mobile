import type { Content } from '@content/schema'
import { sessionCounterOf } from '@domain/counter'
import {
  available,
  balanceOf,
  entryOf,
  feeContextFor,
  feeContextOfSnapshot,
  incoming,
  isMerchant,
  pendingTxs,
  quoteWith,
  selectParty,
} from '@domain/ledger'
import { asMinor } from '@domain/money'
import type {
  AccountId,
  FeeQuote,
  LedgerState,
  Minor,
  Party,
  PartyId,
  PayChannel,
  PaymentRequest,
  PersonaId,
  SimTime,
  Tx,
  TxItem,
} from '@domain/types'
import { type IsoDate, addDays, localDateOf } from '@sim/tz'
import { withinHours } from './hours'
import { counterpartyOf } from './parties'

// Pure selectors for useLedger. They return primitives or objects that are stable per state.

export const selectConfirmed =
  (a: AccountId) =>
  (s: LedgerState): Minor =>
    balanceOf(s, a).confirmed
export const selectAvailable =
  (a: AccountId) =>
  (s: LedgerState): Minor =>
    available(s, a)
export const selectIncoming =
  (a: AccountId) =>
  (s: LedgerState): Minor =>
    incoming(s, a)

/** A directory entry by id or @handle (replaces the content-backed persona lookup). */
export const selectPartyOf =
  (idOrHandle: string) =>
  (s: LedgerState): Party | undefined =>
    selectParty(s, idOrHandle)

/** Fees collected since `baseline` (the starting ledger). */
export function feesSince(s: LedgerState, baseline: LedgerState): Minor {
  return asMinor(balanceOf(s, 'sys:fees').confirmed - balanceOf(baseline, 'sys:fees').confirmed)
}

/** Transactions touching an account, newest first (seed rows included). */
export function txsFor(s: LedgerState, a: AccountId): Tx[] {
  const out: Tx[] = []
  for (let i = s.txOrder.length - 1; i >= 0; i--) {
    const tx = s.txs[s.txOrder[i] ?? '']
    if (tx?.postings.some((p) => p.account === a)) out.push(tx)
  }
  return out
}

/** Signed effect of a transaction on one account (its postings to that account). */
export function deltaFor(tx: Tx, a: AccountId): Minor {
  return asMinor(tx.postings.filter((p) => p.account === a).reduce((acc, p) => acc + p.delta, 0))
}

/** The most recent session transaction, if any. */
export function lastSessionTx(s: LedgerState): Tx | undefined {
  for (let i = s.txOrder.length - 1; i >= 0; i--) {
    const tx = s.txs[s.txOrder[i] ?? '']
    if (tx && !tx.seed) return tx
  }
  return undefined
}

/** The transaction a user command created (flows read their phase from the ledger). */
export function txByCmdId(s: LedgerState, cmdId: string): Tx | undefined {
  for (let i = s.txOrder.length - 1; i >= 0; i--) {
    const tx = s.txs[s.txOrder[i] ?? '']
    if (tx?.cmdId === cmdId) return tx
  }
  return undefined
}

/**
 * The fee quote decide() would use for a payment to `to` without a request or link (null if it
 * would be refused). Review steps put its senderDebit into the command's `expect`.
 */
export function quoteFor(s: LedgerState, to: PartyId, channel: PayChannel, amount: Minor): FeeQuote | null {
  const q = quoteWith(s, feeContextFor(s, to, channel), amount)
  return q.ok ? q.value : null
}

/** The pending transaction an account is sending, if any. */
export function pendingFrom(s: LedgerState, a: AccountId): Tx | undefined {
  return pendingTxs(s).find((tx) => tx.from === a)
}

/** The pending transaction an account is receiving, if any. */
export function pendingTo(s: LedgerState, a: AccountId): Tx | undefined {
  return pendingTxs(s).find((tx) => tx.to === a)
}

/**
 * The session counter under the stage: merchant, web-checkout and subscription payments of the
 * session whose card comparison is shown, with their fees (null before the first one).
 */
export function sessionCounter(s: LedgerState): ReturnType<typeof sessionCounterOf> | null {
  const c = sessionCounterOf(s)
  return c.count === 0 ? null : c
}

/**
 * A merchant's sales today: the seeded "Today so far" summary row plus the settled sales of
 * this session dated today (count and gross). Fresh from Reset: 23 payments, 111.38.
 */
export function salesToday(
  s: LedgerState,
  merchant: PersonaId,
  now: SimTime,
  tz: string,
): { count: number; gross: Minor } {
  const today = localDateOf(now, tz)
  let count = 0
  let gross = 0
  for (const id of s.txOrder) {
    const tx = s.txs[id]
    if (!tx || tx.to !== merchant || tx.kind !== 'purchase' || tx.status !== 'confirmed') continue
    if (localDateOf(tx.confirmedAt ?? tx.createdAt, tz) !== today) continue
    if (tx.seed) {
      if (tx.seedMeta?.labelKey !== 'todaySoFar') continue
      count += tx.summary?.count ?? 0
    } else {
      count += 1
    }
    gross += tx.amount
  }
  return { count, gross: asMinor(gross) }
}

// ---- payment codes (the café's POS code) and what the phone next to it can scan

/**
 * Whether a POS code is still good: a request of the POS channel, open, and younger than its
 * validity. A code past its validity is expired by time (its status stays `open`).
 */
export const isPosRequestOpen = (r: PaymentRequest, now: SimTime, validityMs: number): boolean =>
  r.channel === 'pos' && r.status === 'open' && now < r.createdAt + validityMs

/** What a POS code is now: open, or why it can no longer be paid. */
export type PosCodeState = 'open' | 'paid' | 'cancelled' | 'expired'

/** The state of a POS code at `now`, or undefined for an id that is not a POS request. */
export function posCodeState(
  s: LedgerState,
  requestId: string,
  now: SimTime,
  validityMs: number,
): PosCodeState | undefined {
  const r = entryOf(s.requests, requestId)
  if (r?.channel !== 'pos') return undefined
  if (r.status === 'paid') return 'paid'
  if (r.status !== 'open') return 'cancelled'
  return now < r.createdAt + validityMs ? 'open' : 'expired'
}

/** The merchant's open POS code (the newest, if there were ever two), or undefined. */
export function openPosRequest(
  s: LedgerState,
  merchant: PersonaId,
  now: SimTime,
  validityMs: number,
): PaymentRequest | undefined {
  let found: PaymentRequest | undefined
  for (const r of Object.values(s.requests)) {
    if (r.requester !== merchant || !isPosRequestOpen(r, now, validityMs)) continue
    if (!found || r.createdAt > found.createdAt) found = r
  }
  return found
}

/** The merchant's newest POS code in any state (open, ran out, cancelled or paid), or undefined. */
export function latestPosRequest(s: LedgerState, merchant: PersonaId): PaymentRequest | undefined {
  let found: PaymentRequest | undefined
  for (const r of Object.values(s.requests)) {
    if (r.requester !== merchant || r.channel !== 'pos') continue
    if (!found || r.createdAt > found.createdAt || (r.createdAt === found.createdAt && r.id > found.id)) found = r
  }
  return found
}

/**
 * The fee quote a payment against a request would get: the request's snapshot decides who pays
 * and at what policy (null if it would be refused). Review steps put its `senderDebit` into `expect`.
 */
export function quoteForRequest(s: LedgerState, r: PaymentRequest): FeeQuote | null {
  const q = quoteWith(s, feeContextOfSnapshot(s, r), r.amount)
  return q.ok ? q.value : null
}

/** A payment code the phone can lock onto. */
export interface ScanCandidate {
  kind: 'pos'
  requestId: string
  /** The merchant that shows the code. */
  merchant: PersonaId
  amount: Minor
  items: readonly TxItem[]
  createdAt: SimTime
  /** When the code stops working. */
  expiresAt: SimTime
}

/**
 * What a viewer's Scan can lock onto: the open code of the account shown on the other visible
 * phone, when that account is a merchant (never the viewer's own code, and nothing in phone mode
 * where no other phone is visible). More sources (the counter code) join this list later.
 */
export function scanCandidates(
  s: LedgerState,
  viewer: PersonaId,
  visibleOther: PersonaId | null,
  now: SimTime,
  validityMs: number,
): ScanCandidate[] {
  if (visibleOther === null || visibleOther === viewer || !isMerchant(s, visibleOther)) return []
  const r = openPosRequest(s, visibleOther, now, validityMs)
  if (!r || (r.payer !== undefined && r.payer !== viewer)) return []
  return [
    {
      kind: 'pos',
      requestId: r.id,
      merchant: visibleOther,
      amount: r.amount,
      items: r.items ?? [],
      createdAt: r.createdAt,
      expiresAt: (r.createdAt + validityMs) as SimTime,
    },
  ]
}

// ---- History and the payment detail

export interface ActivityRow {
  tx: Tx
  /** The payment amount as this account sees it: minus for money it sent, plus for money it received. */
  signed: Minor
  direction: 'in' | 'out'
  at: SimTime
  pending: boolean
}

export interface ActivityGroup {
  /** `today`, `yesterday` or the ISO date of an older day. */
  key: 'today' | 'yesterday' | IsoDate
  /** The local date of the group. */
  date: IsoDate
  rows: ActivityRow[]
}

/**
 * An account's payments, newest first, grouped by local day: Today, Yesterday, then one group per
 * older day. Seed rows and daily summary rows are included (a business's history shows them).
 */
export function activity(s: LedgerState, persona: PersonaId, now: SimTime, tz: string): ActivityGroup[] {
  const today = localDateOf(now, tz)
  const yesterday = addDays(today, -1)
  const rows: ActivityRow[] = txsFor(s, persona).map((tx) => {
    const out = tx.from === persona
    return {
      tx,
      signed: asMinor(out ? -tx.amount : tx.amount),
      direction: out ? 'out' : 'in',
      at: tx.createdAt,
      pending: tx.status === 'pending',
    }
  })
  rows.sort((a, b) => b.at - a.at)
  const groups: ActivityGroup[] = []
  for (const row of rows) {
    const date = localDateOf(row.at, tz)
    const key = date === today ? 'today' : date === yesterday ? 'yesterday' : date
    const last = groups[groups.length - 1]
    if (last && last.date === date) last.rows.push(row)
    else groups.push({ key, date, rows: [row] })
  }
  return groups
}

/** Everything the payment detail shows, from one account's point of view. */
export interface TxDetail {
  tx: Tx
  /** Whether the viewer paid (`from`), was paid (`to`) or neither. */
  role: 'from' | 'to' | 'other'
  /** The payment amount, minus for money the viewer sent. */
  signed: Minor
  from: Party | undefined
  to: Party | undefined
  /** Who bears the fee (undefined for rows without one). */
  feePaidBy: 'from' | 'to' | null
  /** When it settled (undefined while pending). */
  settledAt: SimTime | undefined
  /** The payment was made outside the banks' opening hours of the viewer's country. */
  outsideBankingHours: boolean
  /** A sale as its merchant sees it (final, no chargebacks, card comparison). */
  merchantSale: boolean
}

/** The payment detail of a transaction, or undefined for an unknown id. */
export function txDetail(s: LedgerState, txId: string, viewer: PersonaId, content: Content): TxDetail | undefined {
  const tx = entryOf(s.txs, txId)
  if (!tx) return undefined
  const role = tx.from === viewer ? 'from' : tx.to === viewer ? 'to' : 'other'
  const country = content.personas.personas.find((p) => p.id === viewer)?.country ?? 'SI'
  const hours = content.config.bankingHours[country]
  const merchantSale = role === 'to' && tx.kind === 'purchase' && isMerchant(s, viewer)
  return {
    tx,
    role,
    signed: asMinor(role === 'from' ? -tx.amount : tx.amount),
    from: counterpartyOf(s, tx.from, tx.party),
    to: counterpartyOf(s, tx.to, tx.party),
    feePaidBy: tx.fee.payer === 'sender' ? 'from' : tx.fee.payer === 'recipient' ? 'to' : null,
    settledAt: tx.confirmedAt,
    outsideBankingHours: !withinHours(tx.createdAt, hours),
    merchantSale,
  }
}
