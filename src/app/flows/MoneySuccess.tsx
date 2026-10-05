import { formatMinor } from '@domain/money'
import type { LedgerState, PersonaId, Tx } from '@domain/types'
import { counterpartyOf } from '@store/parties'
import { fill, ui } from '../copy'
import { approx, dateTimeText, partyLabel } from '../format'
import { SuccessScreen, type SuccessScreenProps } from '../phone/chrome/SuccessScreen'
import type { FlowCtx } from './types'

/** What the success screen reads: the ledger, the account and the rate. */
export type MoneyCtx = Pick<FlowCtx, 'state' | 'persona' | 'rate'>

// The success screen of a payment the account made (Pay · Paid · money moved): the overline (PAID
// or SENT), a green check, the amount, "to Café Lipa", then Reference, Fee and Time; [Done] returns
// Home. Nothing else is added.

/** Who bears a payment's fee, from one account's point of view: `you`, or the other party's label. */
function feePayerOf(s: LedgerState, tx: Tx, viewer: PersonaId): { you: boolean; name: string } | null {
  if (tx.fee.payer === null) return null
  const account = tx.fee.payer === 'sender' ? tx.from : tx.to
  if (account === viewer) return { you: true, name: '' }
  const party = counterpartyOf(s, account, tx.party)
  return { you: false, name: party ? partyLabel(party) : '' }
}

export function MoneySuccess({
  id,
  overline,
  tx,
  ctx,
  onDone,
  layout: Layout = SuccessScreen,
  doneLabel,
}: {
  id: string
  overline: string
  tx: Tx
  ctx: MoneyCtx
  onDone: () => void
  /** The screen that draws it (the payment page outside the phones has its own). */
  layout?: (p: SuccessScreenProps) => React.JSX.Element
  doneLabel?: string
}) {
  const to = counterpartyOf(ctx.state, tx.to, tx.party)
  const payer = feePayerOf(ctx.state, tx, ctx.persona)
  const fee = formatMinor(tx.fee.fee)
  const feeText =
    tx.fee.rule === 'zero'
      ? ui.fee.chipNone
      : payer?.you
        ? fill(ui.receipt.feeLineYou, { fee })
        : fill(ui.receipt.feeLine, { fee, name: payer?.name ?? '' })
  return (
    <Layout
      id={id}
      variant="money"
      overline={overline}
      amount={{ value: tx.amount }}
      eur={approx(tx.amount, ctx.rate)}
      title={fill(ui.receipt.to, { name: to ? partyLabel(to) : '' })}
      lines={[
        { label: ui.receipt.reference, value: tx.id, mono: true },
        { label: ui.receipt.fee, value: feeText },
        { label: ui.receipt.time, value: dateTimeText(tx.confirmedAt ?? tx.createdAt) },
      ]}
      onDone={onDone}
      {...(doneLabel ? { doneLabel } : {})}
    />
  )
}
