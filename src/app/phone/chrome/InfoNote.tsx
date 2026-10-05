import { Info } from 'lucide-react'
import type { ReactNode } from 'react'

/** A line of explanation in a pale green box with an info mark ("Marko pays the 1% fee …"). */
export function InfoNote({ children, testId = 'info-note' }: { children: ReactNode; testId?: string }) {
  return (
    <p
      data-testid={testId}
      className="mt-3 flex items-start gap-2.5 bg-green-50 px-3.5 py-3 font-body text-body text-navy-900"
    >
      <Info size={20} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  )
}
