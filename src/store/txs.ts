import { asMinor } from '@domain/money'
import type { AccountId, LedgerState, Minor, Tx } from '@domain/types'

// The ledger's payments as an account sees them: the base every other selector builds on.

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
