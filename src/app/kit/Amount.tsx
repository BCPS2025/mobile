import { formatMinor } from '@domain/money'
import type { Minor, Rate } from '@domain/types'
import { ui } from '../copy'
import { approx } from '../format'

// "247.50" at display size + " BCPS" at about 45 %, weight 500, grey; "≈ €225.00" beneath.

type Size = 'xl' | 'l' | 'm' | 's'
const SIZES: Record<Size, string> = {
  xl: 'text-display-xl',
  l: 'text-display-l',
  m: 'text-display-m',
  s: 'text-title',
}

export function Amount({
  value,
  size = 'l',
  rate,
  onNavy = false,
  eurLine = true,
  className = '',
  testId,
}: {
  value: Minor
  size?: Size
  rate?: Rate
  onNavy?: boolean
  eurLine?: boolean
  className?: string
  testId?: string
}) {
  return (
    <div className={className}>
      <p className={`font-display tnum ${SIZES[size]} ${onNavy ? 'text-white' : 'text-navy-900'}`} data-testid={testId}>
        {formatMinor(value)}
        <span
          className={`ml-[0.25em] text-[0.45em] font-medium tracking-normal ${onNavy ? 'text-muted-navy' : 'text-grey-600'}`}
        >
          {ui.common.bcps}
        </span>
      </p>
      {eurLine && rate && (
        <p className={`mt-1 font-body text-body-s tnum ${onNavy ? 'text-muted-navy' : 'text-grey-600'}`}>
          {approx(value, rate)}
        </p>
      )}
    </div>
  )
}
