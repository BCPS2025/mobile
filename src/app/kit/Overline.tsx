import type { ReactNode } from 'react'

/** Letter-spaced overline, optionally over a short green bar. */
export function Overline({
  children,
  bar = false,
  onNavy = false,
  className = '',
}: {
  children: ReactNode
  bar?: boolean
  onNavy?: boolean
  className?: string
}) {
  return (
    <div className={className}>
      {bar && (
        <span aria-hidden="true" className={`mb-2 block h-[3px] w-6 ${onNavy ? 'bg-green-500' : 'bg-green-600'}`} />
      )}
      <p className={`font-body text-overline uppercase ${onNavy ? 'text-muted-navy' : 'text-grey-600'}`}>{children}</p>
    </div>
  )
}

/** Section header over a 24×3 green bar. */
export function SectionTitle({ children, onNavy = false }: { children: ReactNode; onNavy?: boolean }) {
  return (
    <div>
      <span aria-hidden="true" className={`mb-2 block h-[3px] w-6 ${onNavy ? 'bg-green-500' : 'bg-green-600'}`} />
      <h2 className={`font-display text-section uppercase ${onNavy ? 'text-white' : 'text-navy-900'}`}>{children}</h2>
    </div>
  )
}
