import { entryOf } from '@domain/ledger'
import { asMinor } from '@domain/money'
import type {
  LedgerState,
  Minor,
  Party,
  PaymentLink,
  PaymentRequest,
  PersonaId,
  SimTime,
  Split,
  Tx,
} from '@domain/types'
import { addDays, localDateOf, resolveLocal } from '@sim/tz'
import { txsFor } from './txs'

// What an account has to pay, what it is waiting for, and how its links, splits and invoices
// stand. Pure over the ledger; the Pay & request hub, the Wallet and the business Pay hub draw them.

const byNewest = <T extends { at: SimTime; id: string }>(a: T, b: T): number =>
  b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)

// ---- invoices

/** An invoice as its payer or issuer lists it. */
export interface InvoiceRow {
  request: PaymentRequest
  /** "PZ-0412". */
  number: string
  description: string
  amount: Minor
  issuer: Party | undefined
  payer: Party | undefined
  issuedAt: SimTime
  dueAt: SimTime
}

/** `overdue` from the end of the due day (in the payer's zone), `due` before. */
export function invoiceTag(request: PaymentRequest, now: SimTime, tz: string): 'due' | 'overdue' {
  const dueAt = request.invoice?.dueAt
  if (dueAt === undefined) return 'due'
  const endOfDay = resolveLocal(addDays(localDateOf(dueAt, tz), 1), '00:00', tz)
  return now >= endOfDay ? 'overdue' : 'due'
}

const invoiceRow = (s: LedgerState, r: PaymentRequest): InvoiceRow => ({
  request: r,
  number: r.invoice?.number ?? r.id,
  description: r.invoice?.description ?? '',
  amount: r.amount,
  issuer: entryOf(s.directory, r.requester),
  payer: r.payer === undefined ? undefined : entryOf(s.directory, r.payer),
  issuedAt: r.createdAt,
  dueAt: r.invoice?.dueAt ?? r.createdAt,
})

/**
 * The invoices of a business: `toPay` are the open ones addressed to it, earliest due first; `sent` are
 * the ones it issued, newest first, whatever their status.
 */
export function invoices(s: LedgerState, persona: PersonaId, which: 'toPay' | 'sent'): InvoiceRow[] {
  const all = (Object.values(s.requests) as PaymentRequest[]).filter((r) => r.channel === 'invoice')
  if (which === 'toPay') {
    return all
      .filter((r) => r.payer === persona && r.status === 'open')
      .map((r) => invoiceRow(s, r))
      .sort((a, b) => a.dueAt - b.dueAt || (a.number < b.number ? -1 : 1))
  }
  return all
    .filter((r) => r.requester === persona)
    .map((r) => invoiceRow(s, r))
    .sort((a, b) => b.issuedAt - a.issuedAt || (a.number < b.number ? 1 : -1))
}

// ---- to pay

/** One thing an account is asked to pay. */
export type PayItem =
  | { kind: 'request'; id: string; at: SimTime; from: Party | undefined; request: PaymentRequest }
  | {
      kind: 'split'
      id: string
      at: SimTime
      from: Party | undefined
      request: PaymentRequest
      split: Split | undefined
    }
  | { kind: 'link'; id: string; at: SimTime; from: Party | undefined; link: PaymentLink }
  | { kind: 'invoice'; id: string; at: SimTime; from: Party | undefined; row: InvoiceRow }

/**
 * Everything an account is asked to pay, newest first: open requests to it, unpaid payment links sent
 * to it, open split shares, and open invoices. This is exactly what the badges count.
 */
export function payItems(s: LedgerState, persona: PersonaId): PayItem[] {
  const out: PayItem[] = []
  for (const r of Object.values(s.requests) as PaymentRequest[]) {
    if (r.payer !== persona || r.status !== 'open') continue
    const from = entryOf(s.directory, r.requester)
    if (r.channel === 'username') out.push({ kind: 'request', id: r.id, at: r.createdAt, from, request: r })
    else if (r.channel === 'split') {
      const split = r.splitId !== undefined ? entryOf(s.splits, r.splitId) : undefined
      out.push({ kind: 'split', id: r.id, at: r.createdAt, from, request: r, split })
    } else if (r.channel === 'invoice') {
      out.push({ kind: 'invoice', id: r.id, at: r.createdAt, from, row: invoiceRow(s, r) })
    }
  }
  for (const l of Object.values(s.links) as PaymentLink[]) {
    const i = l.sharedWith.indexOf(persona)
    if (i < 0 || l.status !== 'open' || l.owner === persona) continue
    out.push({ kind: 'link', id: l.id, at: l.sharedAt[i] ?? l.createdAt, from: entryOf(s.directory, l.owner), link: l })
  }
  return out.sort(byNewest)
}

export interface Badges {
  /** Requests, links and split shares to pay (the Pay & request tile). */
  toPay: number
  /** Invoices to pay (the business Pay tile). */
  invoicesToPay: number
  /** Escrows that wait for the account (arrives with the escrow screens). */
  escrowAction: number
}

/** The numbers on the tiles: `toPay` + `invoicesToPay` = `payItems(s, persona).length`. */
export function badges(s: LedgerState, persona: PersonaId): Badges {
  const items = payItems(s, persona)
  const invoiceCount = items.filter((i) => i.kind === 'invoice').length
  return { toPay: items.length - invoiceCount, invoicesToPay: invoiceCount, escrowAction: 0 }
}

// ---- waiting

/** A request the account made. */
export interface MyRequest {
  request: PaymentRequest
  payer: Party | undefined
  /** The payment that settled it, once paid. */
  tx: Tx | undefined
  /** When it last changed: made, or answered. */
  at: SimTime
}

/** The requests an account made of people, newest change first (open ones and recent outcomes). */
export function myRequests(s: LedgerState, persona: PersonaId): MyRequest[] {
  const out: (MyRequest & { id: string })[] = []
  for (const r of Object.values(s.requests) as PaymentRequest[]) {
    if (r.channel !== 'username' || r.requester !== persona) continue
    out.push({
      id: r.id,
      request: r,
      payer: r.payer === undefined ? undefined : entryOf(s.directory, r.payer),
      tx: r.txId === undefined ? undefined : entryOf(s.txs, r.txId),
      at: r.closedAt ?? r.createdAt,
    })
  }
  return out.sort(byNewest).map(({ id: _id, ...row }) => row)
}

/** A payment link the account made. */
export interface LinkRow {
  link: PaymentLink
  /** The payment that closed it, once paid. */
  payment: Tx | undefined
  /** Who paid it. */
  paidBy: Party | undefined
  sharedWith: Party[]
}

/** The account's payment links, newest first. */
export function linksOf(s: LedgerState, persona: PersonaId): LinkRow[] {
  const out: LinkRow[] = []
  for (const l of (Object.values(s.links) as PaymentLink[]).filter((x) => x.owner === persona)) {
    const payment = l.payments[0] === undefined ? undefined : entryOf(s.txs, l.payments[0])
    out.push({
      link: l,
      payment,
      paidBy: payment ? entryOf(s.directory, payment.from) : undefined,
      sharedWith: l.sharedWith.map((id) => entryOf(s.directory, id)).filter((p): p is Party => p !== undefined),
    })
  }
  return out.sort((a, b) => b.link.createdAt - a.link.createdAt || (a.link.id < b.link.id ? 1 : -1))
}

/** One person's share of a split, and where it stands. */
export interface SplitShareRow {
  /** The person's id (an account, or the handle of an off-stage person). */
  partyId: string
  party: Party | undefined
  amount: Minor
  request: PaymentRequest | undefined
  status: 'open' | 'paid' | 'declined' | 'cancelled'
  /** The payment of a paid share. */
  tx: Tx | undefined
}

export interface SplitProgress {
  split: Split
  /** The payment that was split (none for an entered amount). */
  source: Tx | undefined
  shares: SplitShareRow[]
  /** Shares paid, and shares in all ("0 of 1 paid"). */
  paid: number
  count: number
  /** What has been paid in (the shares paid), and what is still open. */
  collected: Minor
  open: Minor
  /** `complete` once everyone paid; `open` while a share is open; `closed` when none is open and not all paid. */
  status: 'open' | 'complete' | 'closed'
}

/** The account's splits, newest first, each with how far it has got. */
export function splitsOf(s: LedgerState, persona: PersonaId): SplitProgress[] {
  const out: SplitProgress[] = []
  for (const split of (Object.values(s.splits) as Split[]).filter((x) => x.owner === persona)) {
    const shares: SplitShareRow[] = split.shares.map((sh) => {
      const request = entryOf(s.requests, sh.requestId)
      return {
        partyId: sh.party,
        party: entryOf(s.directory, sh.party),
        amount: sh.amount,
        request,
        status: request?.status ?? 'cancelled',
        tx: request?.txId === undefined ? undefined : entryOf(s.txs, request.txId),
      }
    })
    const paid = shares.filter((x) => x.status === 'paid')
    const open = shares.filter((x) => x.status === 'open')
    out.push({
      split,
      source: split.sourceTxId === undefined ? undefined : entryOf(s.txs, split.sourceTxId),
      shares,
      paid: paid.length,
      count: shares.length,
      collected: asMinor(paid.reduce((sum, x) => sum + x.amount, 0)),
      open: asMinor(open.reduce((sum, x) => sum + x.amount, 0)),
      status: paid.length === shares.length ? 'complete' : open.length > 0 ? 'open' : 'closed',
    })
  }
  return out.sort((a, b) => b.split.createdAt - a.split.createdAt || (a.split.id < b.split.id ? 1 : -1))
}

// ---- splitting a payment

/** Payments a bill can be split from: what the account paid for something. */
export function isSplittable(tx: Tx, persona: PersonaId): boolean {
  return tx.from === persona && (tx.kind === 'transfer' || tx.kind === 'purchase' || tx.kind === 'subscription-charge')
}

/** The split made from a payment, if any. */
export function splitOfTx(s: LedgerState, txId: string): Split | undefined {
  return (Object.values(s.splits) as Split[]).find((x) => x.sourceTxId === txId)
}

/**
 * The payments "Split a bill" offers: the account's last outgoing payments (10 at most), newest first,
 * without refunds, conversions, top-ups, payments that were refunded, payments that already have a
 * split and payments of a share of someone else's split.
 */
export function splitCandidates(s: LedgerState, persona: PersonaId, limit = 10): Tx[] {
  const split = new Set((Object.values(s.splits) as Split[]).flatMap((x) => (x.sourceTxId ? [x.sourceTxId] : [])))
  return txsFor(s, persona)
    .filter((tx) => {
      const paid = tx.links?.requestId === undefined ? undefined : entryOf(s.requests, tx.links.requestId)
      return isSplittable(tx, persona) && tx.refundedBy === undefined && !split.has(tx.id) && paid?.channel !== 'split'
    })
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
}
