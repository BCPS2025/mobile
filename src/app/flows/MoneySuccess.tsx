import { formatMinor } from '@domain/money'
import type { Tx } from '@domain/types'
import { counterpartyOf } from '@store/parties'
import { fill, ui } from '../copy'
import { approx, dateTimeText, feePayerOf, partyLabel } from '../format'
import { SuccessScreen } from '../phone/chrome/SuccessScreen'
import type { FlowCtx } from './types'

// The success screen of a payment the account made (Pay · Paid · money moved): the overline (PAID
// or SENT), a green check, the amount, "to Café Lipa", then Reference, Fee and Time; [Done] returns
// Home. Nothing else is added.

export function MoneySuccess({
  id,
  overline,
  tx,
  ctx,
  onDone,
}: {
  id: string
  overline: string
  tx: Tx
  ctx: FlowCtx
  onDone: () => void
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
    <SuccessScreen
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
    />
  )
}
