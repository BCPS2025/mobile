import { CircleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

/** One line with an alert icon, in the danger colour; `action` is an inline link such as [Top up]. */
export function ErrorLine({
  children,
  action,
  onNavy = false,
  className = '',
}: {
  children: ReactNode
  action?: ReactNode
  onNavy?: boolean
  className?: string
}) {
  return (
    <p
      role="alert"
      data-testid="error-line"
      className={`flex items-start gap-2 font-body text-body-s font-medium ${
        onNavy ? 'text-danger-on-dark' : 'text-danger'
      } ${className}`}
    >
      <CircleAlert size={18} strokeWidth={1.75} aria-hidden="true" className="mt-px shrink-0" />
      <span>
        {children} {action}
      </span>
    </p>
  )
}
