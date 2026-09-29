import { formatMinor } from '@domain/money'
import { sessionCounterText } from '@domain/counter'
import type { LedgerState, Tx } from '@domain/types'
import { useLedgerState } from '@store/useLedger'
import { sessionCounter } from '@store/selectors'
import { copy, fill, ui } from '../copy'
import { counterpartyLabel, persona, timeText, txRef } from '../format'

// The stage's bottom strip: the last payments of the session, one line each, newest first
// ("▪ 12:15:32 @ana → Café Lipa · 11.00 BCPS · settled · fee 0.11 · BC-4F7K2Q"), and under it the
// session counter once a merchant payment has settled. Before the first payment the strip says
// what a Reset leaves.

function sessionTxs(s: LedgerState): Tx[] {
  const out: Tx[] = []
  for (let i = s.txOrder.length - 1; i >= 0 && out.length < 3; i--) {
    const tx = s.txs[s.txOrder[i] ?? '']
    if (tx && !tx.seed) out.push(tx)
  }
  return out
}

export function tapeRowText(tx: Tx): string {
  const from = persona(tx.from)
  return fill(copy.tape.row, {
    time: timeText(tx.confirmedAt ?? tx.createdAt, true),
    from: from ? from.handle : '',
    to: counterpartyLabel(tx.to, tx.party) || (persona(tx.to)?.displayName ?? ''),
    amount: formatMinor(tx.amount),
    status: tx.status === 'confirmed' ? copy.tape.status.confirmed : copy.tape.status.pending,
    fee: formatMinor(tx.fee.fee),
    ref: txRef(tx),
  })
}

/** The counter line, or null before the first merchant payment. */
export function counterText(s: LedgerState): string | null {
  const c = sessionCounter(s)
  return c ? sessionCounterText(c, ui.stage.counter) : null
}

export function Tape({ height }: { height: number }) {
  const s = useLedgerState()
  const rows = sessionTxs(s)
  return (
    <div
      data-testid="tape"
      style={{ height }}
      className="on-navy flex shrink-0 items-center gap-8 overflow-hidden border-t border-navy-700 bg-navy-900 px-4 font-mono text-mono whitespace-nowrap text-white tnum"
    >
      {rows.length === 0 && (
        <span className="flex items-center gap-2.5">
          <span aria-hidden="true" className="inline-block size-2.5 bg-green-500" />
          {ui.reset.fresh}
        </span>
      )}
      {rows.map((tx, i) => (
        <span
          key={tx.id}
          data-testid="tape-row"
          className={`flex items-center gap-2.5 ${i > 0 ? 'text-muted-navy' : ''}`}
        >
          <span
            aria-hidden="true"
            className={`inline-block size-2.5 ${tx.status === 'confirmed' ? 'bg-green-500' : 'anim-pending bg-muted-navy'}`}
          />
          {tapeRowText(tx)}
        </span>
      ))}
    </div>
  )
}

export function SessionCounter({ height }: { height: number }) {
  const text = counterText(useLedgerState())
  return (
    <div
      data-testid="session-counter"
      style={{ height }}
      className="on-navy flex shrink-0 items-center overflow-hidden bg-navy-900 px-4 pl-[34px] font-mono text-mono whitespace-nowrap text-muted-navy tnum"
    >
      {text}
    </div>
  )
}
