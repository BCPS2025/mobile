import type { ReactNode } from 'react'
import { formatMinor } from '@domain/money'
import type { Minor } from '@domain/types'
import { ui } from '../../copy'

// The head of a detail: the amount large with BCPS beside it, the note under it in grey and, when
// there is one, a small caption above ("COLLECTED").

export function AmountHead({
  amount,
  note,
  caption,
  children,
}: {
  amount: Minor
  note?: string | undefined
  caption?: string
  children?: ReactNode
}) {
  return (
    <div data-testid="amount-head">
      {caption && (
        <p className="font-body text-caption font-medium uppercase tracking-[0.16em] text-grey-600">{caption}</p>
      )}
      <p className="font-display text-[40px] leading-[44px] font-semibold tracking-[-0.02em] text-navy-900 tnum">
        {formatMinor(amount)}
        <span className="ml-2 text-[18px] leading-none font-medium tracking-normal text-grey-600">
          {ui.common.bcps}
        </span>
      </p>
      {note && <p className="font-body text-body leading-[22px] text-grey-600">{note}</p>}
      {children}
    </div>
  )
}
