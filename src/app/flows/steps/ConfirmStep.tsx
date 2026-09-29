import type { ReactNode } from 'react'

/**
 * A confirm step for an irreversible or declining action: the question, what it affects
 * (`children`, a card of details) and one line of consequence.
 */
export function ConfirmStep({
  title,
  body,
  onNavy = false,
  children,
}: {
  title: string
  body?: string
  onNavy?: boolean
  children?: ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-5 pt-4">
      <h2 className={`font-display text-display-m ${onNavy ? 'text-white' : 'text-navy-900'}`}>{title}</h2>
      {children}
      {body && <p className={`mt-4 font-body text-body ${onNavy ? 'text-line-300' : 'text-ink'}`}>{body}</p>}
    </div>
  )
}
