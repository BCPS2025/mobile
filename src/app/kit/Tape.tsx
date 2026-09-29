import { formatMinor } from '@domain/money'
import type { LedgerState, Tx } from '@domain/types'
import { useLedgerState } from '@store/useLedger'
import { copy, fill, ui } from '../copy'
import { counterpartyLabel, persona, timeText } from '../format'

// Bottom tape, one 40 px row: ▪ 12:15:32 @ana → Café Lipa · 11.00 BCPS · settled · fee 0.11

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
  })
}

export function Tape({ className = '' }: { className?: string }) {
  const s = useLedgerState()
  const rows = sessionTxs(s)
  return (
    <div
      data-testid="tape"
      className={`on-navy flex h-10 shrink-0 items-center gap-8 overflow-hidden border-t border-navy-700 bg-navy-900 px-5 font-body text-body-s whitespace-nowrap text-white tnum ${className}`}
    >
      {rows.length === 0 && <span className="text-muted-navy">{ui.tape.empty}</span>}
      {rows.map((tx, i) => (
        <span key={tx.id} className={`flex items-center gap-2.5 ${i > 0 ? 'text-muted-navy' : ''}`}>
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
