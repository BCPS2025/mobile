import { formatSignedMinor } from '@domain/money'
import type { Minor } from '@domain/types'

/** Ledger row: label, time line, signed amount (outgoing in ink with a true minus, incoming green). */
export function TxRow({
  label,
  sub,
  delta,
  pending = false,
}: {
  label: string
  sub: string
  delta: Minor
  pending?: boolean
}) {
  return (
    <li className="flex min-h-16 items-center justify-between gap-3 border-b border-line-200 py-2.5">
      <div className="min-w-0">
        <p className="truncate font-body text-body text-ink">{label}</p>
        <p className={`font-body text-body-s text-grey-600 ${pending ? 'anim-pending' : ''}`}>{sub}</p>
      </div>
      <p
        className={`shrink-0 font-display text-body-l font-semibold tnum ${delta > 0 ? 'text-green-700' : 'text-ink'}`}
      >
        {formatSignedMinor(delta)}
      </p>
    </li>
  )
}
