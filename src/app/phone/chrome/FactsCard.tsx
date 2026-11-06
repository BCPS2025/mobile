import type { ReactNode } from 'react'
import { ui } from '../../copy'

// A white card of facts: the label at the left in grey, the value at the right (with a grey line
// under it when there is one). `accent` puts the green edge on top (a check before money moves);
// `total` sets the last value large. Used by the check of a request or link, the decline question
// and the detail of a link, a request and a split.

export interface Fact {
  label: string
  value: ReactNode
  /** A grey line under the value ("≈ €12.00"). */
  sub?: ReactNode
  /** The value in the display face, larger (the total). */
  total?: boolean
  mono?: boolean
  testId?: string
  /** An Edit link that opens the step the figure came from (a check before sending). */
  onEdit?: () => void
}

export function FactsCard({ facts, accent = false }: { facts: Fact[]; accent?: boolean }) {
  return (
    <dl
      className={`border border-line-200 bg-surface ${accent ? 'border-t-[3px] border-t-green-600' : ''}`}
      data-testid="facts"
    >
      {facts.map((f) => (
        <div
          key={f.label}
          data-testid={f.testId}
          className={`flex items-center justify-between gap-4 px-3.5 py-1.5 ${
            f.total ? 'min-h-14' : f.sub ? 'min-h-[49px]' : 'min-h-11'
          } border-b border-line-100 last:border-b-0`}
        >
          <dt className="shrink-0 font-body text-body-s text-grey-600">{f.label}</dt>
          <dd className="flex min-w-0 items-center justify-end gap-3">
            <span className="min-w-0 text-right">
              <span
                className={
                  f.total
                    ? 'block font-display text-[22px] leading-7 font-semibold text-navy-900 tnum'
                    : `block font-body text-body font-medium text-navy-900 ${f.mono ? 'font-mono' : ''}`
                }
              >
                {f.value}
              </span>
              {f.sub && <span className="block font-body text-caption text-grey-600 tnum">{f.sub}</span>}
            </span>
            {f.onEdit && (
              <button
                type="button"
                data-testid={`edit-${f.label}`}
                onClick={f.onEdit}
                className="-my-1.5 min-h-11 shrink-0 font-body text-body-s font-semibold text-green-700 underline underline-offset-2"
              >
                {ui.common.edit}
              </button>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}
