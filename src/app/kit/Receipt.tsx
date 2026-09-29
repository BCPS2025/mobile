import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Minor } from '@domain/types'
import { Amount } from './Amount'

export interface ReceiptLine {
  label: string
  value: ReactNode
  mono?: boolean
}

/** Navy receipt: a 48 px green square with a navy check, the amount, then detail lines. */
export function Receipt({
  title,
  status,
  amount,
  lines,
  footer,
  children,
}: {
  title: string
  status: string
  amount: Minor
  lines: ReceiptLine[]
  footer?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="on-navy anim-fade flex min-h-0 flex-1 flex-col bg-navy-900 text-white">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-6">
        <span aria-hidden="true" className="flex size-12 items-center justify-center bg-green-500 text-navy-900">
          <Check size={28} strokeWidth={2.5} />
        </span>
        <p className="mt-4 font-display text-title">{title}</p>
        <p className="mt-1 font-body text-body-s text-green-500">{status}</p>
        <Amount value={amount} size="l" onNavy eurLine={false} className="mt-4" />
        <dl className="mt-5 border-t border-navy-700">
          {lines.map((l) => (
            <div key={l.label} className="flex items-baseline justify-between gap-4 border-b border-navy-700 py-2.5">
              <dt className="shrink-0 font-body text-body-s text-muted-navy">{l.label}</dt>
              <dd className={`text-right text-body-s tnum ${l.mono ? 'font-mono text-mono' : 'font-body'}`}>
                {l.value}
              </dd>
            </div>
          ))}
        </dl>
        {children}
      </div>
      {footer && <div className="px-6 pt-3 pb-5">{footer}</div>}
    </div>
  )
}
