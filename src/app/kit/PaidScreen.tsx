import type { ReactNode } from 'react'
import type { Minor } from '@domain/types'
import { Amount } from './Amount'

/** Full-screen PAID with a single focal amount (receiver side). */
export function PaidScreen({
  overline,
  amount,
  from,
  spendable,
  children,
}: {
  overline: string
  amount: Minor
  from: string
  spendable: string
  children?: ReactNode
}) {
  return (
    <div className="on-navy anim-fade flex min-h-0 flex-1 flex-col bg-navy-900 px-6 pt-10 pb-6 text-white">
      <div>
        <p className="font-body text-overline uppercase text-green-500">{overline}</p>
        <Amount value={amount} size="xl" onNavy eurLine={false} className="mt-3" />
        <p className="mt-2 font-body text-body text-muted-navy">{from}</p>
        <p className="mt-6 flex items-center gap-2.5 font-display text-title text-green-500">
          <span aria-hidden="true" className="inline-block size-3 bg-green-500" />
          {spendable}
        </p>
      </div>
      {children}
    </div>
  )
}
