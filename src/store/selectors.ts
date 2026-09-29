import { sessionCounterOf } from '@domain/counter'
import { available, balanceOf, feeContextFor, incoming, pendingTxs, quoteWith, selectParty } from '@domain/ledger'
import { asMinor } from '@domain/money'
import type {
  AccountId,
  FeeQuote,
  LedgerState,
  Minor,
  Party,
  PartyId,
  PayChannel,
  PersonaId,
  SimTime,
  Tx,
} from '@domain/types'
import { localDateOf } from '@sim/tz'

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
