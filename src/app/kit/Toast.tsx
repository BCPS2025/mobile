import type { ReactNode } from 'react'

/** A toast inside its container (never portalled): text plus an optional action. */
export function Toast({
  children,
  action,
  onNavy = true,
  className = '',
}: {
  children: ReactNode
  action?: ReactNode
  onNavy?: boolean
  className?: string
}) {
  return (
    <div
      role="status"
      className={`anim-sheet flex items-center justify-between gap-4 px-4 py-3 font-body text-body ${
        onNavy ? 'on-navy border border-navy-700 bg-navy-800 text-white' : 'border border-line-200 bg-surface text-ink'
      } ${className}`}
    >
      <span>{children}</span>
      {action}
    </div>
  )
}
