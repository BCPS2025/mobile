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
  Handle,
  Party,
  PartyId,
  PayChannel,
  PaymentLink,
  PaymentRequest,
  PersonaId,
  SimTime,
  Split,
  Tx,
  TxItem,
} from '@domain/types'
import { localDateOf } from '@sim/tz'
import { withinHours } from './hours'
import { counterpartyOf } from './parties'
import { isSplittable, splitOfTx } from './payitems'
import { refundTxOf } from './sales'

// Pure selectors for useLedger. They return primitives or objects that are stable per state.

export { deltaFor, lastSessionTx, txByCmdId, txsFor } from './txs'
export * from './activity'
export * from './payitems'
export * from './sales'
export * from './wallet'

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

/** A QR the phone can lock onto. */
export type ScanCandidate =
  | {
      /** A merchant's open payment code (the café's Charge screen). */
      kind: 'pos'
      requestId: string
      /** The merchant that shows the code. */
      merchant: PersonaId
      amount: Minor
      items: readonly TxItem[]
      note: string | undefined
      createdAt: SimTime
      /** When the code stops working. */
      expiresAt: SimTime
    }
  | {
      /** A merchant's counter code: always there, the payer enters the amount. */
      kind: 'counter'
      merchant: PersonaId
    }
  | {
      /** A person's "My code" QR that was shown lately: opens Send for them. */
      kind: 'person'
      persona: PersonaId
      handle: Handle
      shownAt: SimTime
    }
  | {
      /** A payment link's QR that was shown lately. */
      kind: 'link'
      linkId: string
      owner: PersonaId
      amount: Minor
      note: string | undefined
      shownAt: SimTime
    }

/** A merchant's open payment code as a candidate. */
export type PosScanCandidate = Extract<ScanCandidate, { kind: 'pos' }>

/**
 * A QR screen an account showed: its "My code" or a payment link. The phone next to it (phone mode: the
 * same phone after switching account) can scan it for ten minutes.
 */
export interface ShownQr {
  persona: PersonaId
  kind: 'code' | 'link'
  linkId?: string
  at: SimTime
}

/** How long a shown QR stays scannable. */
export const SHOWN_QR_WINDOW_MS = 10 * 60_000

/** The shown QRs after one more (`lastShownQr`): the same QR again only refreshes its time; old ones drop out. */
export function noteShownQr(list: readonly ShownQr[], entry: ShownQr): ShownQr[] {
  const same = (x: ShownQr) => x.persona === entry.persona && x.kind === entry.kind && x.linkId === entry.linkId
  return [...list.filter((x) => !same(x) && entry.at - x.at < SHOWN_QR_WINDOW_MS), entry]
}

export interface ScanOptions {
  /** QR screens shown lately (`lastShownQr`). */
  shown?: readonly ShownQr[]
  /** Merchants with a counter code (the café). */
  counterMerchants?: readonly PersonaId[]
}

/** The merchants that have a counter code: those whose home is a till. */
export const counterMerchants = (content: Content): PersonaId[] =>
  content.personas.personas.filter((p) => p.shell === 'pos').map((p) => p.id)

/**
 * What a viewer's Scan can lock onto, never its own code. On the stage, the phone next to it: the open
 * code of the merchant on it, and what a person on it showed lately. In phone mode, where no other
 * phone is visible: every merchant's open code, every QR shown in the last ten minutes, and the counter
 * codes (always there). Open codes first (the visible phone's first), then shown QRs newest first,
 * then counters.
 */
export function scanCandidates(
  s: LedgerState,
  viewer: PersonaId,
  visibleOther: PersonaId | null,
  now: SimTime,
  validityMs: number,
  opts: ScanOptions = {},
): ScanCandidate[] {
  const out: ScanCandidate[] = []
  const code = (merchant: PersonaId): ScanCandidate | undefined => {
    if (merchant === viewer || !isMerchant(s, merchant)) return undefined
    const r = openPosRequest(s, merchant, now, validityMs)
    if (!r || (r.payer !== undefined && r.payer !== viewer)) return undefined
    return {
      kind: 'pos',
      requestId: r.id,
      merchant,
      amount: r.amount,
      items: r.items ?? [],
      note: r.note,
      createdAt: r.createdAt,
      expiresAt: (r.createdAt + validityMs) as SimTime,
    }
  }
  const phoneMode = visibleOther === null
  if (visibleOther !== null) {
    const c = code(visibleOther)
    if (c) out.push(c)
  } else {
    const merchants = Object.keys(s.merchant).filter((id) => isMerchant(s, id))
    for (const m of merchants.sort()) {
      const c = code(m)
      if (c) out.push(c)
    }
  }
  const shown = [...(opts.shown ?? [])].sort((a, b) => b.at - a.at)
  for (const x of shown) {
    if (x.persona === viewer || now - x.at > SHOWN_QR_WINDOW_MS || x.at > now) continue
    if (!phoneMode && x.persona !== visibleOther) continue
    const who = entryOf(s.directory, x.persona)
    if (!who) continue
    if (x.kind === 'code') {
      if (who.kind === 'person') out.push({ kind: 'person', persona: x.persona, handle: who.handle, shownAt: x.at })
      continue
    }
    const link = x.linkId === undefined ? undefined : entryOf(s.links, x.linkId)
    if (link?.owner === x.persona && link.status === 'open') {
      out.push({
        kind: 'link',
        linkId: link.id,
        owner: link.owner,
        amount: link.amount,
        note: link.note,
        shownAt: x.at,
      })
    }
  }
  if (phoneMode) {
    for (const m of opts.counterMerchants ?? [])
      if (m !== viewer && isMerchant(s, m)) out.push({ kind: 'counter', merchant: m })
  }
  return out
}

// ---- The payment detail (History itself is in ./activity)

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
  /** The request a payment paid, the link it paid and the split it is the source of. */
  request: PaymentRequest | undefined
  link: PaymentLink | undefined
  split: Split | undefined
  /** The refund of this payment, and the payment this refund returns. */
  refund: Tx | undefined
  refundOf: Tx | undefined
  /**
   * The viewer's refund action: `refundable` (a named sale it received, not refunded yet), `refunded`
   * (it was) or `no`. Summary rows and payments to someone else never offer it.
   */
  refundState: 'refundable' | 'refunded' | 'no'
  /** The viewer can split this payment (their own outgoing payment, not refunded, not split yet). */
  splittable: boolean
}

/** The payment detail of a transaction, or undefined for an unknown id. */
export function txDetail(s: LedgerState, txId: string, viewer: PersonaId, content: Content): TxDetail | undefined {
  const tx = entryOf(s.txs, txId)
  if (!tx) return undefined
  const role = tx.from === viewer ? 'from' : tx.to === viewer ? 'to' : 'other'
  const country = content.personas.personas.find((p) => p.id === viewer)?.country ?? 'SI'
  const hours = content.config.bankingHours[country]
  const merchantSale = role === 'to' && tx.kind === 'purchase' && isMerchant(s, viewer)
  const split = splitOfTx(s, tx.id)
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
    request: tx.links?.requestId === undefined ? undefined : entryOf(s.requests, tx.links.requestId),
    link: tx.links?.linkId === undefined ? undefined : entryOf(s.links, tx.links.linkId),
    split,
    refund: refundTxOf(s, tx),
    refundOf: tx.links?.refundOf === undefined ? undefined : entryOf(s.txs, tx.links.refundOf),
    refundState:
      role === 'to' &&
      merchantSale &&
      tx.summary === undefined &&
      (tx.from !== 'sys:offstage' || tx.party !== undefined)
        ? tx.refundedBy !== undefined
          ? 'refunded'
          : tx.status === 'confirmed'
            ? 'refundable'
            : 'no'
        : 'no',
    splittable: isSplittable(tx, viewer) && tx.refundedBy === undefined && split === undefined,
  }
}
