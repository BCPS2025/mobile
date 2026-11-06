import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/** An empty list: a grey icon disc, a title, one line of help and, when there is one, the next action. */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  onNavy = false,
  top = false,
}: {
  icon: LucideIcon
  title: string
  body?: string
  action?: ReactNode
  onNavy?: boolean
  /** Sits under the controls above it instead of in the middle of the screen (History, under its chips). */
  top?: boolean
}) {
  return (
    <div
      data-testid="empty-state"
      className={`flex flex-1 flex-col items-center px-8 text-center ${top ? 'justify-start pt-10' : 'justify-center py-10'}`}
    >
      <span
        aria-hidden="true"
        className={`flex size-16 items-center justify-center ${onNavy ? 'bg-navy-800 text-line-300' : 'bg-line-100 text-grey-600'}`}
      >
        <Icon size={28} strokeWidth={1.75} />
      </span>
      <p className={`mt-4 font-display text-title ${onNavy ? 'text-white' : 'text-navy-900'}`}>{title}</p>
      {body && <p className={`mt-2 font-body text-body ${onNavy ? 'text-line-300' : 'text-grey-600'}`}>{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
