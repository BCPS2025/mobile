import { Clock, Info } from 'lucide-react'
import type { ReactNode } from 'react'
import { formatMinor } from '@domain/money'
import type { Minor } from '@domain/types'
import { fill, ui } from '../../copy'
import { InfoText, useInfoToggle } from '../../kit/InfoToggle'

// The review step: a white card with a green top edge listing what will happen: rows with Edit
// links, the fee line (a tap opens the explanation in place), the total, then the balance after
// and "Arrives in seconds." under the card.

export interface ReviewRow {
  label: string
  value: ReactNode
  /** A grey line under the value ("≈ €15.00", the recipient's name). */
  sub?: ReactNode
  /** An Edit link that opens the step (its button then reads "Back to review"). */
  onEdit?: () => void
  /** A leading element (an avatar). */
  leading?: ReactNode
}

export function ReviewStep({
  title,
  rows,
  feeLine,
  feeChip,
  total,
  balanceAfter,
  children,
}: {
  title: string
  rows: ReviewRow[]
  /** "Transaction fee 1% · 0.17 BCPS (≈ €0.15) · paid by you"; null on fee-free steps. */
  feeLine: string | null
  /** The FeeChip (merchant payments). */
  feeChip?: ReactNode
  /** The total the payer is debited. */
  total: Minor | null
  balanceAfter: Minor | null
  children?: ReactNode
}) {
  const info = useInfoToggle()
  return (
    <div className="flex min-h-0 flex-1 flex-col px-5">
      <h2 className="pt-4 font-display text-display-m text-navy-900">{title}</h2>
      <div className="pt-3.5">
        <div className="border border-t-[3px] border-line-200 border-t-green-600 bg-surface">
          {rows.map((r) => (
            <div key={r.label} className="flex min-h-[53px] items-center border-b border-line-100 py-2 pr-1 pl-3.5">
              <span className="w-[72px] shrink-0 font-body text-body-s text-grey-600">{r.label}</span>
              {r.leading && <span className="mr-2.5 shrink-0">{r.leading}</span>}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-body text-body font-semibold text-navy-900">{r.value}</span>
                {r.sub && <span className="block truncate font-body text-body-s text-grey-600">{r.sub}</span>}
              </span>
              {r.onEdit && (
                <button
                  type="button"
                  data-testid={`edit-${r.label}`}
                  onClick={r.onEdit}
                  className="min-h-11 px-2.5 font-body text-body-s font-semibold text-green-700 underline underline-offset-2"
                >
                  {ui.common.edit}
                </button>
              )}
            </div>
          ))}
          {feeLine && (
            <div className="border-b border-line-100 py-2.5 pr-3.5 pl-3.5">
              <button
                type="button"
                data-testid="fee-line"
                aria-expanded={info.open}
                aria-controls={info.id}
                onClick={info.toggle}
                className="flex w-full items-start text-left"
              >
                <span className="w-[72px] shrink-0 font-body text-body-s text-grey-600">{ui.steps.fee}</span>
                <span className="min-w-0 flex-1 font-body text-body font-semibold text-navy-900">{feeLine}</span>
                <Info
                  size={16}
                  strokeWidth={1.75}
                  aria-hidden="true"
                  className="mt-0.5 ml-1.5 shrink-0 text-green-700"
                />
              </button>
              <div className="pl-[72px]">
                <InfoText id={info.id} open={info.open}>
                  {ui.fee.feeInfo}
                </InfoText>
              </div>
            </div>
          )}
          {feeChip && <div className="border-b border-line-100 py-2.5 pr-3.5 pl-3.5">{feeChip}</div>}
          {total !== null && (
            <div className="flex min-h-14 items-center pr-3.5 pl-3.5">
              <span className="w-[72px] shrink-0 font-body text-body-s text-grey-600">{ui.steps.total}</span>
              <span data-testid="review-total" className="font-display text-display-m tnum text-navy-900">
                {formatMinor(total)}
                <span className="ml-1.5 text-[13px] font-medium text-grey-600">{ui.common.bcps}</span>
              </span>
            </div>
          )}
        </div>
        {balanceAfter !== null && (
          <p data-testid="balance-after" className="mt-3 font-body text-body-s text-grey-600 tnum">
            {fill(ui.steps.balanceAfter, { amount: formatMinor(balanceAfter) })}
          </p>
        )}
        <p className="mt-2 flex items-center gap-1.5 font-body text-body-s text-grey-600">
          <Clock size={16} strokeWidth={1.75} aria-hidden="true" />
          {ui.steps.arrives}
        </p>
        {children}
      </div>
    </div>
  )
}
