import type { ReactNode } from 'react'

/** Money sheet: a 4 px green top bar over a white surface. */
export function PaySheet({ title, children, footer }: { title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="anim-sheet flex min-h-0 flex-1 flex-col border-t-4 border-green-600 bg-surface shadow-sheet">
      <div className="px-5 pt-4 pb-2">
        <h2 className="font-display text-title text-navy-900">{title}</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5">{children}</div>
      {footer && <div className="px-5 pt-3 pb-5">{footer}</div>}
    </div>
  )
}
